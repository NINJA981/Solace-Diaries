/**
 * Intentions (habits and goals) and their check-ins. Everything is scoped by user id; a
 * foreign id is a 404. There are no "missed" counts anywhere: a check-in is only ever a
 * thing that happened.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  addDays,
  isoDate,
  localDate,
  type CreateIntentionInput,
  type Intention,
  type UpdateIntentionInput,
} from '@solace/shared';
import { db } from '../db/client';
import { intentionCheckins, intentions, memories } from '../db/schema';
import { badRequest, notFound } from '../http/errors';
import { getTimezone } from './profiles';

export const CHECKIN_WINDOW_DAYS = 90;
/** A check-in may be recorded for today or up to this many days back. */
export const CHECKIN_BACKFILL_DAYS = 7;
export const SUGGESTION_LIMIT = 5;
export const SUGGESTION_TITLE_MAX = 120;

export type IntentionRow = typeof intentions.$inferSelect;

const notFoundErr = () => notFound('Intention not found');

export function toIntention(
  row: IntentionRow,
  checkins: { date: string; note: string | null }[],
): Intention {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    cadence: row.cadence,
    status: row.status,
    source: row.source,
    memoryId: row.memoryId,
    checkins,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function checkinsFor(userId: string, ids: string[], tz: string) {
  const byId = new Map<string, { date: string; note: string | null }[]>();
  if (ids.length === 0) return byId;
  const since = addDays(localDate(new Date(), tz), -(CHECKIN_WINDOW_DAYS - 1));
  const rows = await db
    .select()
    .from(intentionCheckins)
    .where(
      and(
        eq(intentionCheckins.userId, userId),
        inArray(intentionCheckins.intentionId, ids),
        gte(intentionCheckins.date, since),
      ),
    )
    .orderBy(desc(intentionCheckins.date));
  for (const r of rows) {
    const list = byId.get(r.intentionId) ?? [];
    list.push({ date: r.date, note: r.note });
    byId.set(r.intentionId, list);
  }
  return byId;
}

async function hydrate(userId: string, rows: IntentionRow[]): Promise<Intention[]> {
  const tz = await getTimezone(userId);
  const byId = await checkinsFor(
    userId,
    rows.map((r) => r.id),
    tz,
  );
  return rows.map((r) => toIntention(r, byId.get(r.id) ?? []));
}

export async function listIntentions(userId: string): Promise<Intention[]> {
  const rows = await db
    .select()
    .from(intentions)
    .where(eq(intentions.userId, userId))
    .orderBy(sql`(${intentions.status} = 'done')`, desc(intentions.createdAt), intentions.id);
  return hydrate(userId, rows);
}

async function ownRow(userId: string, id: string): Promise<IntentionRow> {
  const [row] = await db
    .select()
    .from(intentions)
    .where(and(eq(intentions.id, id), eq(intentions.userId, userId)));
  if (!row) throw notFoundErr();
  return row;
}

export async function getIntention(userId: string, id: string): Promise<Intention> {
  const [i] = await hydrate(userId, [await ownRow(userId, id)]);
  return i!;
}

export async function listSuggestions(userId: string) {
  const rows = await db
    .select({ id: memories.id, kind: memories.kind, content: memories.content })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.status, 'active'),
        inArray(memories.kind, ['goal', 'habit']),
        sql`not exists (select 1 from ${intentions} where ${intentions.memoryId} = ${memories.id} and ${intentions.userId} = ${userId})`,
      ),
    )
    .orderBy(desc(memories.salience), desc(memories.lastSeen), memories.id)
    .limit(SUGGESTION_LIMIT);
  return rows.map((r) => ({
    memoryId: r.id,
    title: r.content.trim().slice(0, SUGGESTION_TITLE_MAX).trim(),
    kind: r.kind as 'goal' | 'habit',
  }));
}

/** Insert an intention; `memoryId` must be the caller's own active goal/habit memory. */
export async function insertIntention(
  userId: string,
  input: CreateIntentionInput,
): Promise<IntentionRow> {
  if (input.memoryId) {
    const [m] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(
        and(
          eq(memories.id, input.memoryId),
          eq(memories.userId, userId),
          eq(memories.status, 'active'),
          inArray(memories.kind, ['goal', 'habit']),
        ),
      );
    if (!m) throw badRequest('That suggestion is no longer available.', { memoryId: 'Unknown' });
    const [taken] = await db
      .select({ id: intentions.id })
      .from(intentions)
      .where(and(eq(intentions.userId, userId), eq(intentions.memoryId, input.memoryId)));
    if (taken) throw badRequest('You already adopted that one.', { memoryId: 'Already adopted' });
  }
  const [row] = await db
    .insert(intentions)
    .values({
      userId,
      title: input.title,
      kind: input.kind,
      cadence: input.cadence,
      source: input.memoryId ? 'detected' : 'user',
      memoryId: input.memoryId ?? null,
    })
    .returning();
  return row!;
}

export async function createIntention(
  userId: string,
  input: CreateIntentionInput,
): Promise<Intention> {
  return toIntention(await insertIntention(userId, input), []);
}

export async function updateIntention(
  userId: string,
  id: string,
  input: UpdateIntentionInput,
): Promise<Intention> {
  await ownRow(userId, id);
  const set: Partial<typeof intentions.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) set.title = input.title;
  if (input.cadence !== undefined) set.cadence = input.cadence;
  if (input.status !== undefined) set.status = input.status;
  await db
    .update(intentions)
    .set(set)
    .where(and(eq(intentions.id, id), eq(intentions.userId, userId)));
  return getIntention(userId, id);
}

export async function deleteIntention(userId: string, id: string): Promise<void> {
  await ownRow(userId, id);
  await db.delete(intentions).where(and(eq(intentions.id, id), eq(intentions.userId, userId)));
}

export async function checkIn(
  userId: string,
  id: string,
  input: { date: string; note?: string | undefined },
): Promise<Intention> {
  await ownRow(userId, id);
  const today = localDate(new Date(), await getTimezone(userId));
  if (input.date > today)
    throw badRequest('That date is in the future.', { date: 'Cannot be in the future' });
  if (input.date < addDays(today, -CHECKIN_BACKFILL_DAYS))
    throw badRequest(`Check-ins can go back ${CHECKIN_BACKFILL_DAYS} days.`, {
      date: 'Too far back',
    });
  const note = input.note?.trim() ? input.note.trim() : null;
  await db
    .insert(intentionCheckins)
    .values({ intentionId: id, userId, date: input.date, note })
    .onConflictDoUpdate({
      target: [intentionCheckins.intentionId, intentionCheckins.date],
      set: { note },
    });
  return getIntention(userId, id);
}

export async function undoCheckIn(userId: string, id: string, date: string): Promise<Intention> {
  await ownRow(userId, id);
  if (!isoDate.safeParse(date).success) throw badRequest('Invalid date.', { date: 'Invalid' });
  await db
    .delete(intentionCheckins)
    .where(
      and(
        eq(intentionCheckins.intentionId, id),
        eq(intentionCheckins.userId, userId),
        eq(intentionCheckins.date, date),
      ),
    );
  return getIntention(userId, id);
}
