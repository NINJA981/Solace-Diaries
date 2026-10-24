/**
 * The companion and its milestones, computed from data on every read (nothing is stored).
 * XP only ever grows with writing, so a stage never shrinks and nothing is lost for quiet
 * days; mood just describes how recently the person wrote, in a kind way.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  daysBetween,
  localDate,
  weekStart,
  type CompanionState,
  type Milestone,
} from '@solace/shared';
import { db } from '../db/client';
import { attachments, entries, intentionCheckins } from '../db/schema';
import { resolveTimezone } from './stats';

export const XP_PER_ENTRY = 10;
export const WORDS_PER_XP = 50;
export const XP_PER_CHECKIN = 5;
/** Minimum xp for stages 1..7 (index 0 = stage 1). */
export const STAGE_THRESHOLDS = [0, 30, 100, 250, 500, 1000, 2000] as const;
/** A milestone reached within this many hours makes the companion "proud". */
export const PROUD_HOURS = 48;

type Counted = { createdAt: Date; entryDate: string; words: number };

export function stageFor(xp: number): { stage: number; nextStageAt: number | null } {
  let stage = 1;
  STAGE_THRESHOLDS.forEach((min, i) => {
    if (xp >= min) stage = i + 1;
  });
  return { stage, nextStageAt: STAGE_THRESHOLDS[stage] ?? null };
}

export function computeXp(entryCount: number, words: number, checkins: number): number {
  return (
    entryCount * XP_PER_ENTRY +
    Math.floor(words / WORDS_PER_XP) +
    checkins * XP_PER_CHECKIN
  );
}

const MILESTONE_COPY: Record<string, [string, string]> = {
  first_entry: ['First words', 'You wrote your very first entry. Everything starts here.'],
  entries_7: ['Seven entries', 'Seven entries in. A little habit of noticing is taking root.'],
  entries_30: ['Thirty entries', 'Thirty entries. Your journal is becoming a real companion.'],
  entries_100: ['One hundred entries', 'A hundred entries. That is a lot of days held with care.'],
  first_photo: ['A picture added', 'You added your first photo to a memory.'],
  words_1000: ['A thousand words', 'You have written 1,000 words so far.'],
  words_10000: ['Ten thousand words', '10,000 words. A whole small book of your own life.'],
  first_checkin: ['First check-in', 'You checked in on something that matters to you.'],
  first_full_week: [
    'A full week of writing',
    'You wrote on three or more days of one week. Lovely rhythm.',
  ],
};
const MILESTONE_ORDER = Object.keys(MILESTONE_COPY);

/** When the n-th item (1-based) was reached in a created-at ordered list. */
const nth = (rows: Counted[], n: number): Date | null => rows[n - 1]?.createdAt ?? null;

function wordsReachedAt(rows: Counted[], target: number): Date | null {
  let sum = 0;
  for (const r of rows) {
    sum += r.words;
    if (sum >= target) return r.createdAt;
  }
  return null;
}

/** Earliest moment any Monday-week reached its third entry. */
function firstFullWeek(rows: Counted[]): Date | null {
  const perWeek = new Map<string, number>();
  let best: Date | null = null;
  for (const r of rows) {
    const wk = weekStart(r.entryDate);
    const n = (perWeek.get(wk) ?? 0) + 1;
    perWeek.set(wk, n);
    if (n === 3 && (best === null || r.createdAt < best)) best = r.createdAt;
  }
  return best;
}

export async function getCompanion(
  userId: string,
  tzParam?: string,
  now = new Date(),
): Promise<{ companion: CompanionState; milestones: Milestone[] }> {
  const tz = await resolveTimezone(userId, tzParam);

  // A blank autosaved draft is not "writing": count entries with a title, words or a wordless doodle.
  const rows: Counted[] = (
    await db
      .select({ createdAt: entries.createdAt, entryDate: entries.entryDate, words: entries.wordCount })
      .from(entries)
      .where(
        and(
          eq(entries.userId, userId),
          sql`(${entries.wordCount} > 0 or ${entries.title} <> '' or ${entries.wordless} is not null)`,
        ),
      )
      .orderBy(asc(entries.createdAt), asc(entries.id))
  ).map((r) => ({ createdAt: r.createdAt, entryDate: r.entryDate, words: r.words }));

  const checkinTimes = await db
    .select({ createdAt: intentionCheckins.createdAt })
    .from(intentionCheckins)
    .where(eq(intentionCheckins.userId, userId))
    .orderBy(asc(intentionCheckins.createdAt));

  const [photo] = await db
    .select({ at: sql<Date | null>`min(${attachments.createdAt})` })
    .from(attachments)
    .where(eq(attachments.userId, userId));
  const firstPhoto = photo?.at ? new Date(photo.at) : null;

  const words = rows.reduce((s, r) => s + r.words, 0);
  const xp = computeXp(rows.length, words, checkinTimes.length);
  const { stage, nextStageAt } = stageFor(xp);

  const achieved: Record<string, Date | null> = {
    first_entry: nth(rows, 1),
    entries_7: nth(rows, 7),
    entries_30: nth(rows, 30),
    entries_100: nth(rows, 100),
    first_photo: firstPhoto,
    words_1000: wordsReachedAt(rows, 1_000),
    words_10000: wordsReachedAt(rows, 10_000),
    first_checkin: checkinTimes[0]?.createdAt ?? null,
    first_full_week: firstFullWeek(rows),
  };
  const milestones: Milestone[] = MILESTONE_ORDER.map((key) => ({
    key,
    title: MILESTONE_COPY[key]![0],
    description: MILESTONE_COPY[key]![1],
    achievedAt: achieved[key]?.toISOString() ?? null,
  }));

  const last = rows.length ? rows[rows.length - 1]!.createdAt : null;
  const proudSince = now.getTime() - PROUD_HOURS * 3_600_000;
  const recentMilestone = Object.values(achieved).some(
    (d) => d !== null && d.getTime() >= proudSince && d.getTime() <= now.getTime(),
  );
  let mood: CompanionState['mood'] = 'sleepy';
  if (last) {
    const ago = daysBetween(localDate(last, tz), localDate(now, tz));
    if (recentMilestone) mood = 'proud';
    else if (ago <= 0) mood = 'glowing';
    else if (ago <= 2) mood = 'content';
  } else if (recentMilestone) mood = 'proud';

  return {
    companion: { stage, xp, nextStageAt, mood, lastWroteAt: last?.toISOString() ?? null },
    milestones,
  };
}
