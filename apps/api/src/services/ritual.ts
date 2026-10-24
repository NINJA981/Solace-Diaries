/**
 * Weekly ritual: one "Weekly review" journal entry per Monday-week, built from highs, lows
 * and an optional intention for next week. Repeating the ritual in the same week updates
 * the same entry instead of adding another.
 */
import { and, arrayContains, eq, gte, lte, sql } from 'drizzle-orm';
import {
  addDays,
  localDate,
  weekStart,
  type Entry,
  type Intention,
  type WeeklyRitualInput,
} from '@solace/shared';
import { db } from '../db/client';
import { entries, intentions } from '../db/schema';
import { badRequest } from '../http/errors';
import { createEntry, updateEntry } from './entries';
import { getIntention, insertIntention, toIntention } from './intentions';
import { resolveTimezone } from './stats';

export const WEEKLY_TAG = 'weekly-review';
export const WEEKLY_TITLE = 'Weekly review';

export function ritualBody(input: WeeklyRitualInput): string {
  const sections: string[] = [];
  if (input.highs) sections.push(`Highs\n${input.highs}`);
  if (input.lows) sections.push(`Lows\n${input.lows}`);
  if (input.intention) sections.push(`Next week\n${input.intention.title}`);
  return sections.join('\n\n');
}

export async function weeklyRitual(
  userId: string,
  input: WeeklyRitualInput,
): Promise<{ entry: Entry; intention: Intention | null }> {
  if (!input.highs && !input.lows && !input.intention)
    throw badRequest('Add a high, a low or an intention for next week.', {
      highs: 'Write at least one of highs, lows or an intention',
    });

  const tz = await resolveTimezone(userId, input.tz);
  const today = localDate(new Date(), tz);
  const monday = weekStart(today);
  const body = ritualBody(input);

  // Serialise per user and week: a double-tap or a retry after a timeout must find the first
  // request's entry and intention, not add a second pair.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ritual:${userId}:${monday}`}))`);
    const [existing] = await db
      .select({ id: entries.id, version: entries.version })
      .from(entries)
      .where(
        and(
          eq(entries.userId, userId),
          arrayContains(entries.tags, [WEEKLY_TAG]),
          gte(entries.entryDate, monday),
          lte(entries.entryDate, addDays(monday, 6)),
        ),
      )
      .orderBy(entries.createdAt)
      .limit(1);

    const entry = existing
      ? await updateEntry(userId, existing.id, existing.version, { title: WEEKLY_TITLE, body })
      : (
          await createEntry(userId, {
            title: WEEKLY_TITLE,
            body,
            entryDate: today,
            tags: [WEEKLY_TAG],
          })
        ).entry;

    let intention: Intention | null = null;
    if (input.intention) {
      // Redoing the ritual with the same words must not pile up duplicate intentions.
      const [dup] = await db
        .select()
        .from(intentions)
        .where(
          and(
            eq(intentions.userId, userId),
            eq(intentions.status, 'active'),
            sql`lower(${intentions.title}) = lower(${input.intention.title})`,
          ),
        )
        .limit(1);
      intention = dup
        ? await getIntention(userId, dup.id)
        : toIntention(await insertIntention(userId, input.intention), []);
    }
    return { entry, intention };
  });
}
