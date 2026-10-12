import { eq, sql } from 'drizzle-orm';
import { isValidTimezone, type Profile, type UpdateProfileInput } from '@solace/shared';
import { db } from '../db/client';
import { profiles } from '../db/schema';
import { badRequest, notFound } from '../http/errors';

type ProfileRow = typeof profiles.$inferSelect;

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    timezone: row.timezone,
    onboardingDone: row.onboardingDone,
    aiStyle: row.aiStyle,
    reminderHour: row.reminderHour,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── lazy profile creation ──────────────────────────────────────────────

/** userId → email of profiles known to exist, most recently used last. */
const known = new Map<string, string>();
const KNOWN_MAX = 10_000;

/**
 * Make sure the caller has a profile row (created on first API call) and that its email
 * follows the auth user's current email. Cached so steady-state requests skip the DB.
 */
export async function ensureProfile(userId: string, email: string): Promise<void> {
  if (known.get(userId) === email) {
    known.delete(userId);
    known.set(userId, email);
    return;
  }
  await db
    .insert(profiles)
    .values({ id: userId, email })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { email },
      setWhere: sql`${profiles.email} is distinct from ${email} and ${email} <> ''`,
    });
  known.set(userId, email);
  if (known.size > KNOWN_MAX) known.delete(known.keys().next().value!);
}

/** Drop a user from the cache (account deleted, or tests truncating tables). */
export function forgetProfile(userId?: string): void {
  if (userId) known.delete(userId);
  else known.clear();
}

// ── reads & writes ─────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<ProfileRow> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId));
  if (!row) throw notFound('Profile not found');
  return row;
}

export async function getTimezone(userId: string): Promise<string> {
  const [row] = await db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row?.tz ?? 'UTC';
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<ProfileRow> {
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    throw badRequest('Unknown timezone.', { timezone: 'Unknown timezone' });
  }
  if (Object.keys(input).length === 0) return getProfile(userId);
  const [row] = await db.update(profiles).set(input).where(eq(profiles.id, userId)).returning();
  if (!row) throw notFound('Profile not found');
  return row;
}
