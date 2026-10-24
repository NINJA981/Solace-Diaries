/** Time capsules: letters to future you. The body never leaves the server while sealed. */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { CAPSULE_LIMITS, type Capsule, type CapsuleStatus, type CreateCapsuleInput } from '@solace/shared';
import { db } from '../db/client';
import { capsules } from '../db/schema';
import { badRequest, HttpError, notFound } from '../http/errors';

export const CAPSULE_SEALED = 'capsule_sealed';

type Row = typeof capsules.$inferSelect;

export function capsuleStatus(row: Pick<Row, 'unlockAt' | 'openedAt'>, now: Date): CapsuleStatus {
  if (row.openedAt) return 'opened';
  return now.getTime() >= row.unlockAt.getTime() ? 'ready' : 'sealed';
}

/** Body is exposed only once the capsule has been opened; ready-but-unopened stays hidden too. */
export function toCapsule(row: Row, now = new Date()): Capsule {
  const status = capsuleStatus(row, now);
  return {
    id: row.id,
    title: row.title,
    body: status === 'opened' ? row.body : null,
    unlockAt: row.unlockAt.toISOString(),
    status,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCapsules(userId: string, now = new Date()): Promise<Capsule[]> {
  const rows = await db
    .select()
    .from(capsules)
    .where(eq(capsules.userId, userId))
    .orderBy(desc(capsules.createdAt), desc(capsules.id));
  return rows.map((r) => toCapsule(r, now));
}

export async function createCapsule(
  userId: string,
  input: CreateCapsuleInput,
  now = new Date(),
): Promise<Capsule> {
  const unlockAt = new Date(input.unlockAt);
  const earliest = now.getTime() + CAPSULE_LIMITS.minLeadHours * 3_600_000;
  if (unlockAt.getTime() < earliest)
    throw badRequest(`Pick a date at least ${CAPSULE_LIMITS.minLeadHours} hours from now.`, {
      unlockAt: `Must be at least ${CAPSULE_LIMITS.minLeadHours} hours ahead`,
    });
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + CAPSULE_LIMITS.maxYears);
  if (unlockAt.getTime() > latest.getTime())
    throw badRequest(`Pick a date within ${CAPSULE_LIMITS.maxYears} years.`, {
      unlockAt: `Must be within ${CAPSULE_LIMITS.maxYears} years`,
    });
  const [row] = await db
    .insert(capsules)
    .values({ userId, title: input.title, body: input.body, unlockAt })
    .returning();
  return toCapsule(row!, now);
}

export async function openCapsule(userId: string, id: string, now = new Date()): Promise<Capsule> {
  const [row] = await db
    .select()
    .from(capsules)
    .where(and(eq(capsules.id, id), eq(capsules.userId, userId)));
  if (!row) throw notFound('Capsule not found');
  if (now.getTime() < row.unlockAt.getTime())
    throw new HttpError(409, 'This capsule is still sealed.', CAPSULE_SEALED);
  if (row.openedAt) return toCapsule(row, now);
  // Only the first open sets openedAt; a concurrent second open re-reads the winner's row.
  const [updated] = await db
    .update(capsules)
    .set({ openedAt: now })
    .where(and(eq(capsules.id, id), eq(capsules.userId, userId), isNull(capsules.openedAt)))
    .returning();
  if (updated) return toCapsule(updated, now);
  const [again] = await db.select().from(capsules).where(eq(capsules.id, id));
  return toCapsule(again!, now);
}

export async function deleteCapsule(userId: string, id: string): Promise<void> {
  await db.delete(capsules).where(and(eq(capsules.id, id), eq(capsules.userId, userId)));
}
