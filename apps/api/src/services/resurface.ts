/**
 * Memory resurfacing: up to three older entries worth revisiting today. No AI calls, and the
 * choice is deterministic for a given user + local date (a hash picks among the candidates),
 * so refreshing the page never reshuffles the cards.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  MOOD_SCORE,
  MOODS,
  addDays,
  localDate,
  type EntrySummary,
  type ResurfaceItem,
} from '@solace/shared';
import { db } from '../db/client';
import { attachments, entries } from '../db/schema';
import { toEntrySummary } from './entry-dto';

export const ECHO_MIN_AGE_DAYS = 60;
export const UNFINISHED_MIN_AGE_DAYS = 14;
export const RESURFACE_MAX = 3;

const STRONG_MOODS = MOODS.filter((m) => Math.abs(MOOD_SCORE[m]) === 2);
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Candidate = { id: string; entryDate: string };

/** Stable pick: sort candidates, hash (user, date, kind) to an index. */
export function pick<T extends Candidate>(
  candidates: T[],
  userId: string,
  today: string,
  kind: string,
): T | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) =>
    a.entryDate === b.entryDate ? (a.id < b.id ? -1 : 1) : a.entryDate < b.entryDate ? -1 : 1,
  );
  const h = createHash('sha256').update(`${userId}|${today}|${kind}`).digest().readUInt32BE(0);
  return sorted[h % sorted.length]!;
}

export function onThisDayReason(years: number): string {
  return years === 1 ? 'One year ago today' : `${years} years ago today`;
}

export function echoReason(entryDate: string, today: string): string {
  const [y, m] = entryDate.split('-').map(Number) as [number, number];
  const month = MONTHS[m - 1]!;
  return String(y) === today.slice(0, 4) ? `A strong day from ${month}` : `A strong day from ${month} ${y}`;
}

export function unfinishedReason(content: string): string {
  const text = content.trim().replace(/[.!\s]+$/u, '');
  return `You mentioned "${text}" and haven't written about it since`;
}

async function summaries(userId: string, ids: string[]): Promise<Map<string, EntrySummary>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), inArray(entries.id, ids)));
  const counts = await db
    .select({ entryId: attachments.entryId, n: sql<number>`count(*)::int` })
    .from(attachments)
    .where(and(eq(attachments.userId, userId), inArray(attachments.entryId, ids)))
    .groupBy(attachments.entryId);
  const byId = new Map(counts.map((c) => [c.entryId, c.n]));
  return new Map(rows.map((r) => [r.id, toEntrySummary(r, byId.get(r.id) ?? 0)]));
}

export async function getResurface(
  userId: string,
  tz: string,
  now = new Date(),
): Promise<{ items: ResurfaceItem[] }> {
  const today = localDate(now, tz);
  const chosen: { kind: ResurfaceItem['kind']; id: string; reason: string }[] = [];
  const used = new Set<string>();

  // (a) Same month and day in an earlier year.
  const monthDay = today.slice(5);
  const sameDay = await db
    .select({ id: entries.id, entryDate: sql<string>`${entries.entryDate}::text` })
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        sql`to_char(${entries.entryDate}, 'MM-DD') = ${monthDay}`,
        sql`${entries.entryDate} < ${today}::date`,
      ),
    );
  const day = pick(sameDay, userId, today, 'on_this_day');
  if (day) {
    used.add(day.id);
    chosen.push({
      kind: 'on_this_day',
      id: day.id,
      reason: onThisDayReason(Number(today.slice(0, 4)) - Number(day.entryDate.slice(0, 4))),
    });
  }

  // (b) An older, emotionally strong entry.
  const echoCutoff = addDays(today, -ECHO_MIN_AGE_DAYS);
  const strong = await db
    .select({ id: entries.id, entryDate: sql<string>`${entries.entryDate}::text` })
    .from(entries)
    .where(
      and(eq(entries.userId, userId), inArray(entries.mood, STRONG_MOODS), lte(entries.entryDate, echoCutoff)),
    );
  const echo = pick(
    strong.filter((e) => !used.has(e.id)),
    userId,
    today,
    'echo',
  );
  if (echo) {
    used.add(echo.id);
    chosen.push({ kind: 'echo', id: echo.id, reason: echoReason(echo.entryDate, today) });
  }

  // (c) The source of an active goal/habit memory that has gone quiet.
  const quietBefore = new Date(now.getTime() - UNFINISHED_MIN_AGE_DAYS * 86_400_000);
  const quiet = await db.execute<{ id: string; entryDate: string; content: string }>(sql`
    select distinct on (m.id) e.id as id, e.entry_date::text as "entryDate", m.content as content
    from memories m
    join memory_sources ms on ms.memory_id = m.id
    join entries e on e.id = ms.entry_id and e.user_id = m.user_id
    where m.user_id = ${userId} and m.status = 'active' and m.kind in ('goal', 'habit')
      and m.last_seen <= ${quietBefore.toISOString()}::timestamptz
    order by m.id, e.entry_date desc, e.id`);
  const open = pick(
    quiet.filter((q) => !used.has(q.id)),
    userId,
    today,
    'unfinished',
  );
  if (open) chosen.push({ kind: 'unfinished', id: open.id, reason: unfinishedReason(open.content) });

  const sums = await summaries(
    userId,
    chosen.map((c) => c.id),
  );
  const items: ResurfaceItem[] = [];
  for (const c of chosen) {
    const entry = sums.get(c.id);
    if (entry) items.push({ kind: c.kind, entry, reason: c.reason });
  }
  return { items: items.slice(0, RESURFACE_MAX) };
}
