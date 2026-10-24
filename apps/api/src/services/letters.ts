/**
 * Letters from your past self: once a month, one batch-model call turns a handful of older
 * entries into a short letter in the person's own earlier voice. Cached forever (one row per
 * user and month), never regenerated on view, and the reply is an ordinary entry.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import {
  MOOD_SCORE,
  addDays,
  MOODS,
  type Mood,
  localDate,
  type AiStyle,
  type Citation,
  type Entry,
  type PastLetter,
  type PastLetterList,
} from '@solace/shared';
import { AiUnavailableError } from '../ai/errors';
import { aiConfigured, assertAiNotPaused, generateText, type AiOptions } from '../ai/gemini';
import { DATA_POLICY, dataBlock } from '../ai/untrusted';
import { db, type DbOrTx } from '../db/client';
import { entries, pastLetters, profiles } from '../db/schema';
import { conflict, notFound } from '../http/errors';
import { createEntry, getEntry, updateEntry } from './entries';
import { excerptOf } from './entry-dto';
import { cleanLetter } from './insights';
import { consumeAiQuota, refundAiQuota } from './quota';

export const LETTER_MIN_ENTRIES = 6;
/** Only entries at least this old are "your past self". */
export const LETTER_MIN_AGE_DAYS = 60;
export const LETTER_MAX_SOURCES = 5;
const isMood = (m: string): m is Mood => (MOODS as readonly string[]).includes(m);
const MIN_BODY_CHARS = 20;
const PER_ENTRY_CHARS = 1_200;
export const REPLY_TITLE = 'Reply to past me';

type LetterRow = typeof pastLetters.$inferSelect;

export const toPastLetter = (r: LetterRow): PastLetter => ({
  id: r.id,
  month: r.month,
  content: r.content,
  citations: r.citations,
  replyEntryId: r.replyEntryId,
  createdAt: r.createdAt.toISOString(),
});

export const monthOf = (tz: string, now = new Date()): string => localDate(now, tz).slice(0, 7);

// ───────────────────────── citations ─────────────────────────

const MARKS = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Keep only [n] markers that name a supplied source (a marker group like [1, 9] keeps the
 * valid numbers) and return the sources actually referenced, in order of number.
 */
export function filterCitations(
  text: string,
  sources: Citation[],
): { text: string; citations: Citation[] } {
  const valid = new Set(sources.map((s) => s.n));
  const used = new Set<number>();
  const out = text.replace(MARKS, (_m, group: string) => {
    const keep = group
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => valid.has(n));
    for (const n of keep) used.add(n);
    return keep.length ? `[${keep.join('][')}]` : '';
  });
  const tidy = out
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text: tidy, citations: sources.filter((s) => used.has(s.n)) };
}

// ───────────────────────── selection ─────────────────────────

export type Candidate = {
  id: string;
  title: string;
  body: string;
  entryDate: string;
  mood: string | null;
  wordCount: number;
};

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 3-5 entries spread over time: the (date-ordered) candidates are cut into equal slices and
 * each slice contributes its most salient entry (strong mood, real substance). A hash of
 * user + month breaks ties, so the choice is stable within a month and varies between months.
 */
export function pickLetterSources(userId: string, month: string, rows: Candidate[]): Candidate[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort(
    (a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id),
  );
  const k = Math.min(LETTER_MAX_SOURCES, Math.max(3, Math.floor(sorted.length / 2)), sorted.length);
  const score = (e: Candidate) =>
    (e.mood && isMood(e.mood) ? Math.abs(MOOD_SCORE[e.mood]) : 0) * 2 +
    Math.min(e.wordCount, 300) / 150 +
    fnv1a(`${userId}:${month}:${e.id}`) / 0xffffffff;
  const picked: Candidate[] = [];
  for (let i = 0; i < k; i++) {
    const slice = sorted.slice(Math.floor((i * sorted.length) / k), Math.floor(((i + 1) * sorted.length) / k));
    const best = slice.reduce((a, b) => (score(b) > score(a) ? b : a));
    picked.push(best);
  }
  return picked;
}

const eligible = (userId: string, cutoff: string) =>
  and(
    eq(entries.userId, userId),
    lte(entries.entryDate, cutoff),
    sql`char_length(btrim(${entries.body})) >= ${MIN_BODY_CHARS}`,
  );

async function eligibleCount(userId: string, cutoff: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entries)
    .where(eligible(userId, cutoff));
  return row?.n ?? 0;
}

// ───────────────────────── listing ─────────────────────────

export async function listLetters(userId: string, tz: string): Promise<PastLetterList> {
  const rows = await db
    .select()
    .from(pastLetters)
    .where(eq(pastLetters.userId, userId))
    .orderBy(desc(pastLetters.month));
  const month = monthOf(tz);
  const has = rows.some((r) => r.month === month);
  const cutoff = addDays(localDate(new Date(), tz), -LETTER_MIN_AGE_DAYS);
  const enough = !has && (await eligibleCount(userId, cutoff)) >= LETTER_MIN_ENTRIES;
  return { items: rows.map(toPastLetter), canWrite: enough, minEntries: LETTER_MIN_ENTRIES };
}

// ───────────────────────── writing ─────────────────────────

function system(style: AiStyle, teen = false): string {
  return `You are helping a person hear from their own past. Write a short letter FROM their past self TO who they are today, using only the journal entries provided.
- Write in the first person, as the person's earlier self ("I remember...", "back then I..."), speaking to "you" (the person today). Warm, honest and concrete.
- Mention real moments from the entries and refer to them by their number in square brackets right after the sentence they support, like [1] or [2]. Only use numbers you were given. Never invent events, people or feelings.
- Voice flavour: ${style}.${teen ? `
- The writer is a teenager: do not name other people (say "a friend" or "someone close" instead); only speak about the writer themself.` : ''}
- Markdown, at most 250 words, short paragraphs. No images, links, tables or HTML. No headings.
- End by asking exactly one question that invites the reader to reflect on how they have changed.
- No diagnosis or clinical labels. If an entry suggests the person was unsafe, be gentle and encourage reaching out to someone they trust or a local crisis line.
${DATA_POLICY}`;
}

async function existing(
  userId: string,
  month: string,
  q: DbOrTx = db,
): Promise<LetterRow | undefined> {
  const [row] = await q
    .select()
    .from(pastLetters)
    .where(and(eq(pastLetters.userId, userId), eq(pastLetters.month, month)));
  return row;
}

/**
 * This month's letter. Idempotent: if it exists it is returned without any AI call. Errors
 * from the model (budget spent, rate limit, outage) are thrown as they are, so the page can
 * say honestly why no letter was written.
 */
export async function writeLetter(
  userId: string,
  tz: string,
  ai: AiOptions = {},
): Promise<PastLetter> {
  const month = monthOf(tz);
  const have = await existing(userId, month);
  if (have) return toPastLetter(have);

  // One writer per user and month: a second request (double click, two tabs) waits here, then
  // finds the first one's letter instead of spending another model call and quota unit.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`letter:${userId}:${month}`}))`);
    const raced = await existing(userId, month, tx);
    if (raced) return toPastLetter(raced);

    const cutoff = addDays(localDate(new Date(), tz), -LETTER_MIN_AGE_DAYS);
    const rows = await db
      .select({
        id: entries.id,
        title: entries.title,
        body: entries.body,
        entryDate: entries.entryDate,
        mood: entries.mood,
        wordCount: entries.wordCount,
      })
      .from(entries)
      .where(eligible(userId, cutoff));
    if (rows.length < LETTER_MIN_ENTRIES) {
      throw conflict('Letters from your past self need a few older entries first.', 'not_enough_entries');
    }

    // Requests known to fail are refused before they spend the person's budget.
    if (!aiConfigured(ai.apiKey)) throw new AiUnavailableError('No Gemini API key is configured.');
    assertAiNotPaused(['batch'], ai.apiKey);
    await consumeAiQuota(userId, { usingOwnKey: Boolean(ai.apiKey) });

    const sources = pickLetterSources(userId, month, rows);
    const [profile] = await db
      .select({ aiStyle: profiles.aiStyle, mode: profiles.mode })
      .from(profiles)
      .where(eq(profiles.id, userId));
    const sourceCitations: Citation[] = sources.map((e, i) => ({
      n: i + 1,
      entryId: e.id,
      title: e.title || 'Untitled',
      entryDate: e.entryDate,
      snippet: excerptOf(e.body, 200),
    }));
    const blocks = sources.map((e, i) =>
      dataBlock(
        'entry',
        { n: i + 1, date: e.entryDate, title: e.title || 'Untitled', mood: e.mood ?? 'unknown' },
        e.body,
        PER_ENTRY_CHARS,
      ),
    );

    let raw: string;
    try {
      raw = await generateText(
      {
        task: 'batch',
        system: system(profile?.aiStyle ?? 'gentle', profile?.mode === 'teen'),
        temperature: 0.8,
        maxOutputTokens: 700,
        user: `Today is ${localDate(new Date(), tz)}. The entries your past self wrote:\n\n${blocks.join('\n')}`,
      },
      { ...ai, userId },
      );
    } catch (err) {
      // Nothing was written, so the person keeps their unit of today's budget.
      await refundAiQuota(userId);
      throw err;
    }
    const { text, citations } = filterCitations(cleanLetter(raw), sourceCitations);

    const [inserted] = await db
      .insert(pastLetters)
      .values({ userId, month, content: text, citations })
      .onConflictDoNothing({ target: [pastLetters.userId, pastLetters.month] })
      .returning();
    // A concurrent request won the race: serve its letter.
    return toPastLetter(inserted ?? (await existing(userId, month, tx))!);
  });
}

// ───────────────────────── reply ─────────────────────────

/** A stable entry id per letter, so a repeated reply can never create a second entry. */
export function replyEntryIdFor(letterId: string): string {
  const h = createHash('sha256').update(`letter-reply:${letterId}`).digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Turn the person's reply into a normal entry (so it is enriched like any other) and link it. */
export async function replyToLetter(
  userId: string,
  letterId: string,
  body: string,
  tz: string,
): Promise<Entry> {
  const [letter] = await db
    .select()
    .from(pastLetters)
    .where(and(eq(pastLetters.id, letterId), eq(pastLetters.userId, userId)));
  if (!letter) throw notFound('Letter not found.');

  const id = replyEntryIdFor(letter.id);
  const { entry, created } = await createEntry(userId, {
    id,
    title: REPLY_TITLE,
    body,
    entryDate: localDate(new Date(), tz),
    tags: [],
  });
  let result = entry;
  if (!created && entry.body !== body) {
    result = await updateEntry(userId, id, entry.version, { body });
  }
  if (letter.replyEntryId !== id) {
    await db
      .update(pastLetters)
      .set({ replyEntryId: id })
      .where(and(eq(pastLetters.id, letter.id), eq(pastLetters.userId, userId)));
  }
  return result.id === id ? result : await getEntry(userId, id);
}
