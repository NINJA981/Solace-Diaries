/**
 * Growth notes: at most one gentle, cited observation of change per user per Monday-week
 * ("In March you wrote ...; lately ..."), written by ONE batch call in a background job.
 * Reading only lists notes; it queues the job when a note is due and never calls the model.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  addDays,
  daysBetween,
  localDate,
  weekStart,
  type Citation,
  type GrowthNote,
} from '@solace/shared';
import { AiBadOutputError, AiUnavailableError } from '../ai/errors';
import { aiConfigured, assertAiNotPaused, generateText, type AiOptions } from '../ai/gemini';
import { DATA_POLICY, dataBlock } from '../ai/untrusted';
import { db } from '../db/client';
import { entries, growthNotes, jobs, profiles } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { JOB } from '../jobs/types';
import { excerptOf } from './entry-dto';
import { cleanLetter } from './insights';
import { filterCitations } from './letters';
import { resolveTimezone } from './stats';

export const GROWTH_MIN_ENTRIES = 10;
export const GROWTH_MIN_SPAN_DAYS = 42;
/** "Lately" is the last three weeks; "before" is everything older. */
const RECENT_DAYS = 21;
const OLDER_SAMPLE = 6;
const RECENT_SAMPLE = 4;
const MIN_PER_WINDOW = 2;
/** After a job died on unusable output, wait this long before queueing another. */
const FAILURE_COOLDOWN_HOURS = 6;

type NoteRow = typeof growthNotes.$inferSelect;

const toNote = (r: NoteRow): GrowthNote => ({
  id: r.id,
  text: r.text,
  citations: r.citations,
  weekStart: r.weekStart,
  createdAt: r.createdAt.toISOString(),
});

async function hasNoteFor(userId: string, week: string): Promise<boolean> {
  const [row] = await db
    .select({ id: growthNotes.id })
    .from(growthNotes)
    .where(and(eq(growthNotes.userId, userId), eq(growthNotes.weekStart, week)))
    .limit(1);
  return Boolean(row);
}

async function shape(userId: string) {
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      first: sql<string | null>`min(${entries.entryDate})::text`,
      last: sql<string | null>`max(${entries.entryDate})::text`,
    })
    .from(entries)
    .where(eq(entries.userId, userId));
  return { count: row?.n ?? 0, first: row?.first ?? null, last: row?.last ?? null };
}

/** True when the journal is big and old enough for a note and this week has none yet. */
async function noteIsDue(userId: string, week: string): Promise<boolean> {
  const s = await shape(userId);
  if (s.count < GROWTH_MIN_ENTRIES || !s.first || !s.last) return false;
  if (daysBetween(s.first, s.last) < GROWTH_MIN_SPAN_DAYS) return false;
  return !(await hasNoteFor(userId, week));
}

export async function listGrowthNotes(userId: string): Promise<GrowthNote[]> {
  const rows = await db
    .select()
    .from(growthNotes)
    .where(eq(growthNotes.userId, userId))
    .orderBy(desc(growthNotes.weekStart), desc(growthNotes.createdAt))
    .limit(20);
  return rows.map(toNote);
}

/** Notes so far; queues (at most) one build when this week's note is due. */
export async function getGrowthNotes(userId: string): Promise<GrowthNote[]> {
  const items = await listGrowthNotes(userId);
  const tz = await resolveTimezone(userId);
  const week = weekStart(localDate(new Date(), tz));
  if (items.some((n) => n.weekStart === week) || !(await noteIsDue(userId, week))) return items;

  // A build that just died on unusable output is not retried on every page view.
  const [failed] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, JOB.buildGrowth),
        eq(jobs.dedupeKey, `growth:${userId}:${week}`),
        inArray(jobs.status, ['dead', 'failed']),
        gt(jobs.updatedAt, sql`now() - ${FAILURE_COOLDOWN_HOURS} * interval '1 hour'`),
      ),
    )
    .limit(1);
  if (!failed) {
    await enqueue(db, JOB.buildGrowth, { userId }, { dedupeKey: `growth:${userId}:${week}` });
  }
  return items;
}

// ───────────────────────── the job ─────────────────────────

function system(): string {
  return `You are Solace. Compare two groups of a person's journal entries (older entries, then recent ones) and write ONE short observation of how they have changed or grown.
- Gentle, specific and kind. Format like: "In March you wrote about ...; lately you ...". At most 80 words, plain text, no headings, lists, images or links.
- Cite the entries you rely on by number in square brackets right after the claim, like [1] or [5]. Cite at least one older and one recent entry. Only use numbers you were given.
- Never diagnose, label conditions, shame, compare the person to others or call anything a problem. If a change is hard, name it with compassion. Never invent events.
${DATA_POLICY}`;
}

async function pickAndRead(userId: string, today: string) {
  const cutoff = addDays(today, -RECENT_DAYS);
  const rows = await db
    .select({
      id: entries.id,
      title: entries.title,
      body: entries.body,
      summary: entries.summary,
      entryDate: entries.entryDate,
    })
    .from(entries)
    .where(and(eq(entries.userId, userId), sql`char_length(btrim(${entries.body})) >= 20`))
    .orderBy(entries.entryDate, entries.id);
  const older = rows.filter((r) => r.entryDate <= cutoff);
  const recent = rows.filter((r) => r.entryDate > cutoff);
  const spread = <T>(xs: T[], k: number) =>
    xs.length <= k
      ? xs
      : Array.from({ length: k }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (k - 1))]!);
  return { older: spread(older, OLDER_SAMPLE), recent: spread(recent, RECENT_SAMPLE) };
}

export async function buildGrowthNote(
  payload: Record<string, unknown>,
  ai: AiOptions = {},
): Promise<void> {
  const userId = String(payload.userId ?? '');
  if (!userId) return;
  const tz = await resolveTimezone(userId);
  const today = localDate(new Date(), tz);
  const week = weekStart(today);
  if (!(await noteIsDue(userId, week))) return;

  const { older, recent } = await pickAndRead(userId, today);
  if (older.length < MIN_PER_WINDOW || recent.length < MIN_PER_WINDOW) return;

  if (!aiConfigured(ai.apiKey)) throw new AiUnavailableError('No Gemini API key is configured.');
  assertAiNotPaused(['batch'], ai.apiKey);

  const [profile] = await db
    .select({ aiStyle: profiles.aiStyle })
    .from(profiles)
    .where(eq(profiles.id, userId));
  const all = [...older, ...recent];
  const sources: Citation[] = all.map((e, i) => ({
    n: i + 1,
    entryId: e.id,
    title: e.title || 'Untitled',
    entryDate: e.entryDate,
    snippet: excerptOf(e.body, 200),
  }));
  const block = (e: (typeof all)[number], i: number) =>
    dataBlock(
      'entry',
      { n: i + 1, date: e.entryDate, title: e.title || 'Untitled' },
      e.summary?.trim() ? `${e.summary}\n${e.body}` : e.body,
      700,
    );
  const raw = await generateText(
    {
      task: 'batch',
      system: `${system()}\nVoice: ${profile?.aiStyle ?? 'gentle'}.`,
      temperature: 0.6,
      maxOutputTokens: 400,
      user: `Today is ${today}.\n\nOlder entries:\n${older.map((e, i) => block(e, i)).join('\n')}\n\nRecent entries:\n${recent.map((e, i) => block(e, older.length + i)).join('\n')}`,
    },
    { ...ai, userId },
  );
  const { text, citations } = filterCitations(cleanLetter(raw), sources);
  // An uncited observation is not trustworthy enough to show.
  if (!text || citations.length === 0)
    throw new AiBadOutputError('The growth note cited no entries.');

  await db.transaction(async (tx) => {
    // One note per user per week, even if two builds race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`growth:${userId}:${week}`}))`);
    const [dup] = await tx
      .select({ id: growthNotes.id })
      .from(growthNotes)
      .where(and(eq(growthNotes.userId, userId), eq(growthNotes.weekStart, week)))
      .limit(1);
    if (dup) return;
    await tx.insert(growthNotes).values({ userId, weekStart: week, text, citations });
  });
}
