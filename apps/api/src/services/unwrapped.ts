/**
 * Solace Unwrapped: a month or year in review. Everything is SQL aggregation over the user's
 * entries; `entry_date` is already the local calendar date, and the hour of day is taken from
 * `created_at` converted into the user's timezone.
 */
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import {
  MOOD_SCORE,
  MOODS,
  addDays,
  daysBetween,
  localDate,
  type EntrySummary,
  type Mood,
  type Unwrapped,
  type UnwrappedSlide,
} from '@solace/shared';
import { db } from '../db/client';
import { attachments, entries, profiles } from '../db/schema';
import { badRequest } from '../http/errors';
import { toEntrySummary } from './entry-dto';
import { derivePersona, type PersonaStats } from './persona';
import { computeStreaks } from './stats';

export const UNWRAPPED_MIN_ENTRIES = 5;
const TOP_TAGS = 5;
const TOP_PEOPLE = 5;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const isMood = (m: string): m is Mood => (MOODS as readonly string[]).includes(m);

type EntryRow = typeof entries.$inferSelect;

/** Years the SQL date range and the calendar maths handle without surprises. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

function checkYear(year: number): void {
  if (year < MIN_YEAR || year > MAX_YEAR)
    throw badRequest(`Pick a year between ${MIN_YEAR} and ${MAX_YEAR}.`, { at: 'Year out of range' });
}

/** Resolve `at` for the period into local from/to dates and a label; 400 when it doesn't fit. */
export function periodRange(period: 'month' | 'year', at: string) {
  if (period === 'year') {
    if (!/^\d{4}$/.test(at)) throw badRequest('For a year, use YYYY.', { at: 'Expected YYYY' });
    checkYear(Number(at));
    return { from: `${at}-01-01`, to: `${at}-12-31`, label: at };
  }
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(at);
  if (!m) throw badRequest('For a month, use YYYY-MM.', { at: 'Expected YYYY-MM' });
  const year = Number(m[1]);
  checkYear(year);
  const month = Number(m[2]);
  const next = month === 12 ? `${year + 1}-01-01` : `${m[1]}-${String(month + 1).padStart(2, '0')}-01`;
  return { from: `${at}-01`, to: addDays(next, -1), label: `${MONTH_NAMES[month - 1]} ${year}` };
}

/** Strongest mood first (|valence|), then the longest entry, then the earliest. */
async function highlightRow(where: SQL | undefined): Promise<EntryRow | undefined> {
  const strength = sql`case ${entries.mood} ${sql.join(
    MOODS.map((m) => sql`when ${m} then ${Math.abs(MOOD_SCORE[m])}`),
    sql` `,
  )} else -1 end`;
  const [row] = await db
    .select()
    .from(entries)
    .where(where)
    .orderBy(desc(strength), desc(entries.wordCount), asc(entries.entryDate), asc(entries.id))
    .limit(1);
  return row;
}

export async function getUnwrapped(
  userId: string,
  period: 'month' | 'year',
  at: string,
  tz: string,
  now = new Date(),
): Promise<Unwrapped> {
  const { from, to, label } = periodRange(period, at);
  const today = localDate(now, tz);
  const inPeriod = and(
    eq(entries.userId, userId),
    gte(entries.entryDate, from),
    lte(entries.entryDate, to),
  );

  const [profile] = await db
    .select({ mode: profiles.mode })
    .from(profiles)
    .where(eq(profiles.id, userId));

  const [totalsR, moodsR, tagsR, daysR, hoursR, weekdaysR, distinctR] = await Promise.all([
    db.execute<{ entries: number; words: number; days: number }>(sql`
      select count(*)::int as entries, coalesce(sum(word_count), 0)::int as words,
             count(distinct entry_date)::int as days
      from entries where ${inPeriod}`),
    db.execute<{ mood: string; count: number }>(sql`
      select mood, count(*)::int as count from entries
      where ${inPeriod} and mood is not null group by mood`),
    db.execute<{ tag: string; count: number }>(sql`
      select tag, count(*)::int as count from entries, unnest(tags) as tag
      where ${inPeriod} group by tag order by count desc, tag asc limit ${TOP_TAGS}`),
    db.execute<{ date: string }>(sql`
      select distinct entry_date::text as date from entries where ${inPeriod}`),
    db.execute<{ hour: number; count: number }>(sql`
      select extract(hour from created_at at time zone ${tz}::text)::int as hour, count(*)::int as count
      from entries where ${inPeriod} group by 1`),
    db.execute<{ dow: number; count: number }>(sql`
      select extract(isodow from entry_date)::int as dow, count(*)::int as count
      from entries where ${inPeriod} group by 1`),
    db.execute<{ n: number }>(sql`
      select count(distinct tag)::int as n from entries, unnest(tags) as tag where ${inPeriod}`),
  ]);

  const totals = totalsR[0] ?? { entries: 0, words: 0, days: 0 };
  const moodCounts: Record<string, number> = {};
  for (const r of moodsR) if (isMood(r.mood)) moodCounts[r.mood] = r.count;
  let topMood: Mood | null = null;
  for (const m of MOODS) {
    const c = moodCounts[m] ?? 0;
    if (c > 0 && (topMood === null || c > (moodCounts[topMood] ?? 0))) topMood = m;
  }

  const byHour = Array<number>(24).fill(0);
  for (const r of hoursR) byHour[r.hour] = r.count;
  const byWeekday = Array<number>(7).fill(0);
  for (const r of weekdaysR) byWeekday[r.dow - 1] = r.count;
  let peakHour: number | null = null;
  for (let h = 0; h < 24; h++) {
    if (byHour[h]! > 0 && (peakHour === null || byHour[h]! > byHour[peakHour]!)) peakHour = h;
  }

  // A streak is "current" if it runs up to the end of the period (or up to today, if sooner).
  const refDay = to < today ? to : today;
  const streaks = computeStreaks(
    daysR.map((d) => d.date),
    refDay,
  );

  const [firstRow] = await db
    .select()
    .from(entries)
    .where(inPeriod)
    .orderBy(asc(entries.entryDate), asc(entries.createdAt), asc(entries.id))
    .limit(1);
  const [lastRow] = await db
    .select()
    .from(entries)
    .where(inPeriod)
    .orderBy(desc(entries.entryDate), desc(entries.createdAt), desc(entries.id))
    .limit(1);
  const strongestRow = await highlightRow(inPeriod);

  const summaryOf = async (row: EntryRow | undefined): Promise<EntrySummary | null> => {
    if (!row) return null;
    const [c] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(attachments)
      .where(and(eq(attachments.userId, userId), eq(attachments.entryId, row.id)));
    return toEntrySummary(row, c?.n ?? 0);
  };

  const slides: UnwrappedSlide[] = [
    { kind: 'totals', entries: totals.entries, words: totals.words, days: totals.days },
    { kind: 'moods', counts: moodCounts, top: topMood },
    { kind: 'tags', top: tagsR.map((t) => ({ tag: t.tag, count: t.count })) },
    { kind: 'streak', longest: streaks.longest, current: streaks.current },
    { kind: 'rhythm', byHour, byWeekday, peakHour },
    { kind: 'bookends', first: await summaryOf(firstRow), last: await summaryOf(lastRow) },
  ];

  // People come from the memory graph; teen accounts never get this slide.
  if (profile?.mode !== 'teen') {
    const people = await db.execute<{ name: string; count: number }>(sql`
      select n.name as name, count(distinct e.id)::int as count
      from graph_nodes n
      join graph_node_sources s on s.node_id = n.id
      join entries e on e.id = s.entry_id and e.user_id = n.user_id
      where n.user_id = ${userId} and n.kind = 'person'
        and e.entry_date between ${from} and ${to}
      group by n.id, n.name order by count desc, n.name asc limit ${TOP_PEOPLE}`);
    slides.push({ kind: 'people', top: people.map((p) => ({ name: p.name, count: p.count })) });
  }

  if (strongestRow) {
    const entry = (await summaryOf(strongestRow))!;
    const m = strongestRow.mood && isMood(strongestRow.mood) ? strongestRow.mood : null;
    const reason =
      m && Math.abs(MOOD_SCORE[m]) === 2
        ? MOOD_SCORE[m] > 0
          ? 'The brightest day you wrote about'
          : 'The heaviest day you wrote about, and you still showed up'
        : 'Your longest entry of the period';
    slides.push({ kind: 'highlight', entry, reason });
  }

  let persona: Unwrapped['persona'] = null;
  if (totals.entries >= UNWRAPPED_MIN_ENTRIES) {
    const lastDay = refDay < from ? from : refDay;
    const stats: PersonaStats = {
      entries: totals.entries,
      activeDays: totals.days,
      elapsedDays: Math.max(daysBetween(from, lastDay) + 1, 1),
      avgWords: totals.words / totals.entries,
      byHour,
      byWeekday,
      moodScores: Object.entries(moodCounts).flatMap(([m, c]) =>
        Array<number>(c).fill(MOOD_SCORE[m as Mood]),
      ),
      distinctMoods: Object.keys(moodCounts).length,
      distinctTags: distinctR[0]?.n ?? 0,
    };
    persona = derivePersona(stats);
  }

  return { period, label, from, to, slides, persona, minEntries: UNWRAPPED_MIN_ENTRIES };
}
