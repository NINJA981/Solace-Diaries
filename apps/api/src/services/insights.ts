/**
 * The weekly letter: a short, warm reflection on the current week (Monday-start in the
 * user's timezone), generated from that week's entries only and cached per week.
 */
import { and, asc, between, eq, sql } from 'drizzle-orm';
import {
  addDays,
  localDate,
  weekStart,
  type AiStyle,
  type WeeklyLetter,
  type WeeklyLetterResponse,
} from '@solace/shared';
import { generateText, type AiOptions } from '../ai/gemini';
import { DATA_POLICY, dataBlock } from '../ai/untrusted';
import { db } from '../db/client';
import { entries, insightReports, profiles } from '../db/schema';
import { consumeAiQuota } from './quota';

export const MIN_WEEKLY_ENTRIES = 2;
const MAX_ENTRIES = 14;
const PER_ENTRY_CHARS = 700;
const TOTAL_CHARS = 9_000;

type ReportRow = typeof insightReports.$inferSelect;

export function weekWindow(tz: string, now = new Date()): { start: string; end: string } {
  const start = weekStart(localDate(now, tz));
  return { start, end: addDays(start, 6) };
}

/** Count of the week's entries and the exact (µs) latest updated_at, as Postgres text. */
async function weekSnapshot(userId: string, start: string, end: string) {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      watermark: sql<string | null>`max(${entries.updatedAt})::text`,
    })
    .from(entries)
    .where(and(eq(entries.userId, userId), between(entries.entryDate, start, end)));
  return { count: row?.count ?? 0, watermark: row?.watermark ?? null };
}

/** Stale when the week's entries were added, deleted or edited after the letter was generated. */
async function isStale(userId: string, report: ReportRow, end: string): Promise<boolean> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      changed: sql<boolean>`coalesce(bool_or(${insightReports.sourceWatermark} is null or ${entries.updatedAt} > ${insightReports.sourceWatermark}), false)`,
    })
    .from(entries)
    .innerJoin(
      insightReports,
      and(eq(insightReports.userId, userId), eq(insightReports.weekStart, report.weekStart)),
    )
    .where(and(eq(entries.userId, userId), between(entries.entryDate, report.weekStart, end)));
  return (row?.count ?? 0) !== report.entryCount || Boolean(row?.changed);
}

function toLetter(r: ReportRow, stale: boolean): WeeklyLetter {
  return {
    weekStart: r.weekStart,
    content: r.content,
    entryCount: r.entryCount,
    generatedAt: r.generatedAt.toISOString(),
    stale,
  };
}

/** Keep the letter inside what SafeMarkdown should render: no images, links, HTML or deep headings. */
export function cleanLetter(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/^#{1,6}[ \t]+/gm, '### ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function system(style: AiStyle): string {
  return `You are Solace, writing a short "weekly letter" to the user about their week, based only on their journal entries from this week.
- Warm, specific and grounded: mention concrete moments from the entries, gently notice patterns or shifts in mood, and acknowledge effort. Never invent events.
- Voice: ${style}. Speak to the user as "you".
- Markdown, at most 250 words. Short paragraphs; optional short sections with "###" headings (never deeper) and a few bullets. No images, links, tables or HTML.
- End with one gentle intention or question for the week ahead.
- No diagnosis or clinical labels. If an entry suggests the user may be in crisis or unsafe, kindly encourage them to reach out to someone they trust or a local crisis line.
${DATA_POLICY}`;
}

async function generate(
  userId: string,
  start: string,
  end: string,
  ai: AiOptions,
): Promise<WeeklyLetter> {
  await consumeAiQuota(userId, { usingOwnKey: Boolean(ai.apiKey) });
  const [profile] = await db
    .select({ aiStyle: profiles.aiStyle })
    .from(profiles)
    .where(eq(profiles.id, userId));
  // Taken before reading the entries, so an edit racing this generation still marks it stale.
  const { watermark } = await weekSnapshot(userId, start, end);
  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), between(entries.entryDate, start, end)))
    .orderBy(asc(entries.entryDate), asc(entries.createdAt));

  let budget = TOTAL_CHARS;
  const blocks: string[] = [];
  for (const e of rows.slice(0, MAX_ENTRIES)) {
    if (budget <= 0) break;
    const text = [e.summary && `Summary: ${e.summary}`, e.body].filter(Boolean).join('\n');
    const take = Math.min(PER_ENTRY_CHARS, budget);
    blocks.push(
      dataBlock(
        'entry',
        { date: e.entryDate, title: e.title || 'Untitled', mood: e.mood ?? 'unknown' },
        text,
        take,
      ),
    );
    budget -= take;
  }
  const sourceWatermark = watermark === null ? null : sql`${watermark}::timestamptz`;

  const content = cleanLetter(
    await generateText(
      {
        system: system(profile?.aiStyle ?? 'gentle'),
        temperature: 0.7,
        maxOutputTokens: 700,
        user: `This week runs from ${start} to ${end}. The user's entries:\n\n${blocks.join('\n')}`,
      },
      { ...ai, userId },
    ),
  );

  const [row] = await db
    .insert(insightReports)
    .values({ userId, weekStart: start, content, entryCount: rows.length, sourceWatermark })
    .onConflictDoUpdate({
      target: [insightReports.userId, insightReports.weekStart],
      set: { content, entryCount: rows.length, sourceWatermark, generatedAt: sql`now()` },
    })
    .returning();
  return toLetter(row!, false);
}

/**
 * The cached letter for the current week. When there is none yet and the week has enough
 * entries, it is generated on first view, so `letter: null` always means "too few entries".
 */
export async function getWeeklyLetter(
  userId: string,
  tz: string,
  ai: AiOptions = {},
): Promise<WeeklyLetterResponse> {
  const { start, end } = weekWindow(tz);
  const [report] = await db
    .select()
    .from(insightReports)
    .where(and(eq(insightReports.userId, userId), eq(insightReports.weekStart, start)));
  if (report)
    return {
      letter: toLetter(report, await isStale(userId, report, end)),
      minEntries: MIN_WEEKLY_ENTRIES,
    };
  const snap = await weekSnapshot(userId, start, end);
  if (snap.count < MIN_WEEKLY_ENTRIES) return { letter: null, minEntries: MIN_WEEKLY_ENTRIES };
  return { letter: await generate(userId, start, end, ai), minEntries: MIN_WEEKLY_ENTRIES };
}

export async function refreshWeeklyLetter(
  userId: string,
  tz: string,
  ai: AiOptions = {},
): Promise<WeeklyLetterResponse> {
  const { start, end } = weekWindow(tz);
  const snap = await weekSnapshot(userId, start, end);
  if (snap.count < MIN_WEEKLY_ENTRIES) return { letter: null, minEntries: MIN_WEEKLY_ENTRIES };
  return { letter: await generate(userId, start, end, ai), minEntries: MIN_WEEKLY_ENTRIES };
}
