/**
 * Insights statistics. Entry dates are stored as the user's local calendar dates, so all
 * calendar math happens on YYYY-MM-DD strings (DST- and timezone-proof); the timezone is
 * only used to decide what "today" is.
 */
import { eq, sql } from 'drizzle-orm';
import {
  MOOD_SCORE,
  MOODS,
  addDays,
  daysBetween,
  isValidTimezone,
  localDate,
  weekStart,
  type DayStat,
  type Mood,
  type Stats,
  type WeekMood,
} from '@solace/shared';
import { db } from '../db/client';
import { profiles } from '../db/schema';
import { badRequest } from '../http/errors';

export const HEATMAP_DAYS = 365;
export const TREND_WEEKS = 26;
export const TOP_TAGS = 8;

const isMood = (m: string): m is Mood => (MOODS as readonly string[]).includes(m);

/** The tz query param if given (must be a real IANA zone), else the profile's, else UTC. */
export async function resolveTimezone(userId: string, tz?: string): Promise<string> {
  if (tz !== undefined) {
    if (!isValidTimezone(tz))
      throw badRequest('Unknown timezone.', { tz: 'Unknown IANA timezone' });
    return tz;
  }
  const [p] = await db
    .select({ timezone: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return p && isValidTimezone(p.timezone) ? p.timezone : 'UTC';
}

// ───────────────────────── pure math ─────────────────────────

/** Average valence of the moods, rounded to 2 decimals; null when there are none. */
export function moodScore(moods: string[]): number | null {
  const valid = moods.filter(isMood);
  if (valid.length === 0) return null;
  const avg = valid.reduce((s, m) => s + MOOD_SCORE[m], 0) / valid.length;
  return Math.round(avg * 100) / 100;
}

/** Most frequent mood; ties go to the mood listed first in MOODS (stable output). */
export function dominantMood(moods: string[]): Mood | null {
  const counts = new Map<Mood, number>();
  for (const m of moods) if (isMood(m)) counts.set(m, (counts.get(m) ?? 0) + 1);
  let best: Mood | null = null;
  for (const m of MOODS) {
    const n = counts.get(m) ?? 0;
    if (n > 0 && (best === null || n > counts.get(best)!)) best = m;
  }
  return best;
}

export type DayRow = { date: string; count: number; words: number; moods: string[] };

export function buildDays(rows: DayRow[]): DayStat[] {
  return [...rows]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      date: r.date,
      count: r.count,
      words: r.words,
      moodScore: moodScore(r.moods),
      mood: dominantMood(r.moods),
    }));
}

/**
 * Streaks over distinct local dates. The current streak is still alive if the latest entry
 * is today or yesterday (today isn't over yet). Dates after `today` are ignored.
 */
export function computeStreaks(
  dates: string[],
  today: string,
): { current: number; longest: number } {
  const days = [...new Set(dates)].filter((d) => d <= today).sort();
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && daysBetween(days[i - 1]!, days[i]!) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const last = days[days.length - 1];
  const alive = last !== undefined && daysBetween(last, today) <= 1;
  return { current: alive ? run : 0, longest };
}

export type MoodRow = { date: string; mood: string; count: number };

/** The last `weeks` Monday-start weeks ending with the current one, oldest first. */
export function buildMoodTrend(rows: MoodRow[], today: string, weeks = TREND_WEEKS): WeekMood[] {
  const current = weekStart(today);
  const out: WeekMood[] = [];
  const index = new Map<string, WeekMood>();
  for (let i = weeks - 1; i >= 0; i--) {
    const w: WeekMood = { weekStart: addDays(current, -7 * i), avgScore: null, counts: {} };
    out.push(w);
    index.set(w.weekStart, w);
  }
  const sums = new Map<string, { score: number; n: number }>();
  for (const r of rows) {
    if (!isMood(r.mood)) continue;
    const w = index.get(weekStart(r.date));
    if (!w) continue;
    w.counts[r.mood] = (w.counts[r.mood] ?? 0) + r.count;
    const s = sums.get(w.weekStart) ?? { score: 0, n: 0 };
    s.score += MOOD_SCORE[r.mood] * r.count;
    s.n += r.count;
    sums.set(w.weekStart, s);
  }
  for (const w of out) {
    const s = sums.get(w.weekStart);
    if (s) w.avgScore = Math.round((s.score / s.n) * 100) / 100;
  }
  return out;
}

// ───────────────────────── queries ─────────────────────────

export async function getStats(userId: string, tz: string, now = new Date()): Promise<Stats> {
  const today = localDate(now, tz);
  const from = addDays(today, -(HEATMAP_DAYS - 1));
  const trendFrom = addDays(weekStart(today), -7 * (TREND_WEEKS - 1));

  const [days, dates, totals, moods, tags] = await Promise.all([
    db.execute<{ date: string; count: number; words: number; moods: string[] }>(sql`
      select entry_date::text as date, count(*)::int as count, coalesce(sum(word_count), 0)::int as words,
             array_remove(array_agg(mood), null) as moods
      from entries where user_id = ${userId} and entry_date between ${from} and ${today}
      group by entry_date`),
    db.execute<{ date: string }>(sql`
      select distinct entry_date::text as date from entries
      where user_id = ${userId} and entry_date <= ${today}`),
    db.execute<{ entries: number; words: number }>(sql`
      select count(*)::int as entries, coalesce(sum(word_count), 0)::int as words
      from entries where user_id = ${userId}`),
    db.execute<{ date: string; mood: string; count: number }>(sql`
      select entry_date::text as date, mood, count(*)::int as count from entries
      where user_id = ${userId} and mood is not null and entry_date between ${trendFrom} and ${today}
      group by entry_date, mood`),
    db.execute<{ tag: string; count: number }>(sql`
      select tag, count(*)::int as count from entries, unnest(tags) as tag
      where user_id = ${userId}
      group by tag order by count desc, tag asc limit ${TOP_TAGS}`),
  ]);

  const streaks = computeStreaks(
    dates.map((d) => d.date),
    today,
  );
  return {
    today,
    days: buildDays([...days]),
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    totalEntries: totals[0]?.entries ?? 0,
    totalWords: totals[0]?.words ?? 0,
    moodTrend: buildMoodTrend([...moods], today),
    topTags: tags.map((t) => ({ tag: t.tag, count: t.count })),
  };
}
