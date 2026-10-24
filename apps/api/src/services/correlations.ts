/**
 * Mood vs. tag correlations over the last 180 days. Descriptive only: the average mood on
 * days with a tag against the average of every scored entry. Never a claim about cause.
 */
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { addDays, localDate, MOOD_SCORE, type Correlation, type Mood } from '@solace/shared';
import { db } from '../db/client';
import { entries } from '../db/schema';
import { resolveTimezone } from './stats';

export const CORRELATION_DAYS = 180;
export const CORRELATION_MIN_ENTRIES = 14;
export const CORRELATION_MIN_TAG_ENTRIES = 3;
export const CORRELATION_TOP = 8;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure maths on (mood, tags) pairs, exported for tests. */
export function computeCorrelations(
  rows: { mood: string | null; tags: string[] }[],
): Correlation[] {
  const scored = rows.flatMap((r) =>
    r.mood && r.mood in MOOD_SCORE ? [{ score: MOOD_SCORE[r.mood as Mood], tags: r.tags }] : [],
  );
  if (scored.length < CORRELATION_MIN_ENTRIES) return [];
  const baseline = scored.reduce((s, r) => s + r.score, 0) / scored.length;

  const byTag = new Map<string, number[]>();
  for (const r of scored)
    for (const tag of new Set(r.tags)) byTag.set(tag, [...(byTag.get(tag) ?? []), r.score]);

  return [...byTag.entries()]
    .filter(([, scores]) => scores.length >= CORRELATION_MIN_TAG_ENTRIES)
    .map(([tag, scores]) => {
      const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
      return {
        tag,
        entries: scores.length,
        avgMood: round2(avg),
        baseline: round2(baseline),
        delta: round2(avg - baseline),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.tag.localeCompare(b.tag))
    .slice(0, CORRELATION_TOP);
}

export async function getCorrelations(userId: string, tzParam?: string) {
  const tz = await resolveTimezone(userId, tzParam);
  const since = addDays(localDate(new Date(), tz), -(CORRELATION_DAYS - 1));
  const rows = await db
    .select({ mood: entries.mood, tags: entries.tags })
    .from(entries)
    .where(and(eq(entries.userId, userId), gte(entries.entryDate, since), isNotNull(entries.mood)));
  return { items: computeCorrelations(rows), minEntries: CORRELATION_MIN_ENTRIES };
}
