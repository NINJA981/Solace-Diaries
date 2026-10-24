/**
 * Life chapters: named eras detected from entry summaries by ONE batch-model call in a
 * background job. The model's output is validated strictly; on anything wrong the previous
 * chapters are left untouched. Reading never calls the model.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate, type Chapter, type ChapterList } from '@solace/shared';
import { AiBadOutputError, AiUnavailableError } from '../ai/errors';
import { aiConfigured, assertAiNotPaused, generateJson, type AiOptions } from '../ai/gemini';
import { DATA_POLICY, dataBlock } from '../ai/untrusted';
import { db } from '../db/client';
import { chapters, entries } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { JOB } from '../jobs/types';
import { excerptOf } from './entry-dto';

export const CHAPTERS_MIN_ENTRIES = 15;
/** Entries added or edited since the last build that make a rebuild worthwhile. */
export const CHAPTERS_STALE_AFTER = 5;
export const MAX_CHAPTERS = 8;
export const MAX_CHAPTER_ENTRIES = 150;
/** A build younger than this and not stale is not repeated, even when asked. */
const REBUILD_COOLDOWN_MS = 24 * 3_600_000;

export const CHAPTER_COLORS = ['mood-1', 'mood-2', 'mood-3', 'mood-4', 'mood-5', 'accent', 'ai'] as const;

type ChapterRow = typeof chapters.$inferSelect;

const toChapter = (r: ChapterRow): Chapter => ({
  id: r.id,
  title: r.title,
  summary: r.summary,
  from: r.fromDate,
  to: r.toDate,
  color: r.color,
  cast: r.cast,
  keyEntryIds: r.keyEntryIds,
});

// ───────────────────────── reading ─────────────────────────

async function snapshot(userId: string) {
  const [e] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entries)
    .where(eq(entries.userId, userId));
  const [c] = await db
    .select({
      count: sql<number>`count(*)::int`,
      watermark: sql<string | null>`max(${chapters.sourceWatermark})::text`,
      generatedAt: sql<Date | null>`max(${chapters.createdAt})`,
    })
    .from(chapters)
    .where(eq(chapters.userId, userId));
  let changed = 0;
  if (c?.count && c.watermark) {
    const [n] = await db
      .select({
        n: sql<number>`count(*) filter (where ${entries.updatedAt} > ${c.watermark}::timestamptz)::int`,
      })
      .from(entries)
      .where(eq(entries.userId, userId));
    changed = n?.n ?? 0;
  }
  return {
    entryCount: e?.count ?? 0,
    built: (c?.count ?? 0) > 0,
    changed,
    generatedAt: c?.generatedAt ? new Date(c.generatedAt) : null,
  };
}

export async function listChapters(userId: string): Promise<ChapterList> {
  const rows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.userId, userId))
    .orderBy(asc(chapters.fromDate), asc(chapters.createdAt));
  const s = await snapshot(userId);
  const stale =
    s.entryCount >= CHAPTERS_MIN_ENTRIES && (!s.built || s.changed >= CHAPTERS_STALE_AFTER);
  return {
    items: rows.map(toChapter),
    generatedAt: s.generatedAt ? s.generatedAt.toISOString() : null,
    stale,
    minEntries: CHAPTERS_MIN_ENTRIES,
  };
}

/** Queue ONE (deduped) build and return the list as it is right now. */
export async function refreshChapters(userId: string): Promise<ChapterList> {
  const list = await listChapters(userId);
  const [e] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entries)
    .where(eq(entries.userId, userId));
  if ((e?.count ?? 0) >= CHAPTERS_MIN_ENTRIES) {
    await enqueue(db, JOB.buildChapters, { userId }, { dedupeKey: `chapters:${userId}` });
  }
  return list;
}

// ───────────────────────── model output ─────────────────────────

const modelChapter = z.object({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(420),
  from: isoDate,
  /** Null only for the chapter the person is in now (the last one). */
  to: isoDate.nullable(),
  color: z.enum(CHAPTER_COLORS),
  cast: z.array(z.string().trim().min(1).max(40)).max(6),
  keyEntryIds: z.array(z.string()).max(5),
});
export const chaptersOutput = z.object({ chapters: z.array(modelChapter).min(1).max(MAX_CHAPTERS) });
type ModelChapter = z.infer<typeof modelChapter>;

export type ChapterSource = {
  handle: string;
  id: string;
  date: string;
  /** Everything the model was shown for this entry, to check cast names against. */
  text: string;
};

/**
 * Strict checks the schema can't express. Returns normalised chapters (real entry ids) or
 * throws AiBadOutputError naming the first problem.
 */
export function validateChapters(
  out: z.infer<typeof chaptersOutput>,
  sources: ChapterSource[],
): Array<Omit<Chapter, 'id'>> {
  const bad = (why: string): never => {
    throw new AiBadOutputError(`Chapters rejected: ${why}`);
  };
  const byHandle = new Map(sources.map((s) => [s.handle, s]));
  const min = sources.reduce((m, s) => (s.date < m ? s.date : m), sources[0]!.date);
  const max = sources.reduce((m, s) => (s.date > m ? s.date : m), sources[0]!.date);
  const haystack = sources.map((s) => s.text).join('\n').toLowerCase();

  const list = out.chapters;
  const result: Array<Omit<Chapter, 'id'>> = [];
  list.forEach((c: ModelChapter, i) => {
    const last = i === list.length - 1;
    if (c.from < min || c.from > max) bad(`chapter ${i + 1} starts outside the journal's dates`);
    if (c.to === null && !last) bad(`only the last chapter may be open-ended`);
    if (c.to !== null) {
      if (c.to < c.from) bad(`chapter ${i + 1} ends before it starts`);
      if (c.to > max || c.to < min) bad(`chapter ${i + 1} ends outside the journal's dates`);
    }
    const prev = list[i - 1];
    if (prev) {
      if (c.from <= prev.from) bad('chapters are not in order');
      if (prev.to !== null && c.from <= prev.to) bad('chapters overlap');
    }
    const keys: string[] = [];
    for (const h of c.keyEntryIds) {
      const src = byHandle.get(h);
      if (!src) bad(`unknown entry "${h}"`);
      else if (!keys.includes(src.id)) keys.push(src.id);
    }
    const cast = [...new Set(c.cast)];
    for (const name of cast) {
      if (!haystack.includes(name.toLowerCase())) bad(`"${name}" never appears in the entries`);
    }
    result.push({
      title: c.title,
      summary: c.summary,
      from: c.from,
      to: c.to,
      color: c.color,
      cast,
      keyEntryIds: keys,
    });
  });
  return result;
}

/** At most `max` items, evenly spread across the (date-ordered) list, always keeping both ends. */
export function evenSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]!);
  return out;
}

function system(): string {
  return `You divide a person's journal into "life chapters": named eras of their life, based only on the entry notes provided.
- Each entry note has a handle like e12, a date, a mood, tags and a one-line summary.
- Produce between 2 and ${MAX_CHAPTERS} chapters (fewer when the journal is short), in date order, never overlapping. Every chapter has: title (a short evocative name, for example "The harbour flat"), summary (2 sentences, warm and factual), from and to as YYYY-MM-DD dates taken from the entry dates (the last chapter, the one the person is in now, has "to": null), color (one of mood-1 mood-2 mood-3 mood-4 mood-5 accent ai; mood-1 for the heaviest eras up to mood-5 for the brightest, accent or ai when mixed), cast (names of important people who appear in the notes, copied exactly as written; empty if none), keyEntryIds (up to 5 handles of the most representative entries of that chapter).
- Never invent people, places, events or dates, and use only the handles provided. No diagnosis or clinical labels.
- Reply with JSON only.
${DATA_POLICY}`;
}

// ───────────────────────── the job ─────────────────────────

export async function buildChapters(
  payload: Record<string, unknown>,
  ai: AiOptions = {},
): Promise<void> {
  const userId = String(payload.userId ?? '');
  if (!userId) return;
  const snap = await snapshot(userId);
  if (snap.entryCount < CHAPTERS_MIN_ENTRIES) return;
  const fresh =
    snap.built &&
    snap.changed < CHAPTERS_STALE_AFTER &&
    snap.generatedAt !== null &&
    Date.now() - snap.generatedAt.getTime() < REBUILD_COOLDOWN_MS;
  if (fresh) return;

  if (!aiConfigured(ai.apiKey)) throw new AiUnavailableError('No Gemini API key is configured.');
  // A paused model throws a 429 here, which the job runner turns into a deferral.
  assertAiNotPaused(['batch'], ai.apiKey);

  // Taken before reading the entries, so an edit racing this build still marks it stale.
  const [wm] = await db
    .select({ watermark: sql<string | null>`max(${entries.updatedAt})::text` })
    .from(entries)
    .where(eq(entries.userId, userId));
  const rows = await db
    .select({
      id: entries.id,
      title: entries.title,
      body: entries.body,
      summary: entries.summary,
      entryDate: entries.entryDate,
      mood: entries.mood,
      tags: entries.tags,
    })
    .from(entries)
    .where(eq(entries.userId, userId))
    .orderBy(asc(entries.entryDate), asc(entries.createdAt), asc(entries.id));
  const sampled = evenSample(rows, MAX_CHAPTER_ENTRIES);

  const sources: ChapterSource[] = [];
  const blocks: string[] = [];
  sampled.forEach((e, i) => {
    const handle = `e${i + 1}`;
    const line = e.summary?.trim() || excerptOf(e.body, 160);
    const text = [e.title, e.tags.join(', '), line].filter(Boolean).join('\n');
    sources.push({ handle, id: e.id, date: e.entryDate, text });
    blocks.push(
      dataBlock('entry', { id: handle, date: e.entryDate, mood: e.mood ?? 'unknown' }, text, 400),
    );
  });

  const out = await generateJson(
    chaptersOutput,
    {
      task: 'batch',
      system: system(),
      temperature: 0.5,
      maxOutputTokens: 2_000,
      user: `The journal runs from ${sources[0]!.date} to ${sources.at(-1)!.date} (${rows.length} entries; ${sources.length} shown).\n\n${blocks.join('\n')}`,
    },
    { ...ai, userId },
  );
  const valid = validateChapters(out, sources);

  await db.transaction(async (tx) => {
    await tx.delete(chapters).where(eq(chapters.userId, userId));
    await tx.insert(chapters).values(
      valid.map((c) => ({
        userId,
        title: c.title,
        summary: c.summary,
        fromDate: c.from,
        toDate: c.to,
        color: c.color,
        cast: c.cast,
        keyEntryIds: c.keyEntryIds,
        sourceWatermark: wm?.watermark ? sql`${wm.watermark}::timestamptz` : null,
      })),
    );
  });
}
