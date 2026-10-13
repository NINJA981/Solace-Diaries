import { eq, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  isValidTimezone,
  type Profile,
  type UpdateProfileInput,
} from '@solace/shared';
import { authUserExists } from '../auth/supabase-admin';
import { config, isTest } from '../config';
import { db } from '../db/client';
import { profiles } from '../db/schema';
import { badRequest, HttpError, notFound, unauthorized } from '../http/errors';
import { logger } from '../logger';

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

export type AuthUserLookup = (userId: string) => Promise<boolean>;

let lookupOverride: AuthUserLookup | undefined;

/** Test seam: replace the Supabase "does this auth user exist?" check (undefined restores it). */
export function setAuthUserLookup(fn?: AuthUserLookup): void {
  lookupOverride = fn;
}

async function authUserStillExists(userId: string): Promise<boolean> {
  // Tests have no Supabase; local dev without a service key can't ask (prod requires one).
  if (!lookupOverride && (isTest || !config.SUPABASE_SERVICE_ROLE_KEY)) return true;
  try {
    return await (lookupOverride ?? authUserExists)(userId);
  } catch (err) {
    logger.error({ err }, 'could not confirm the auth user exists');
    throw new HttpError(
      503,
      'Sign-in is temporarily unavailable. Try again shortly.',
      ERROR_CODES.internal,
    );
  }
}

/**
 * Make sure the caller has a profile row (created on first API call) and that its email
 * follows the auth user's current email. Cached so steady-state requests skip the DB.
 *
 * Creating a row needs one more check: an access token stays valid for up to an hour after
 * its account is deleted, and must not bring the account back. So before inserting, ask
 * Supabase whether the auth user still exists (only on this rare path: a brand-new user or
 * a deleted one). Gone → 401; can't tell → 503.
 */
export async function ensureProfile(userId: string, email: string): Promise<void> {
  if (known.get(userId) === email) {
    known.delete(userId);
    known.set(userId, email);
    return;
  }
  const [existing] = await db
    .select({ email: profiles.email })
    .from(profiles)
    .where(eq(profiles.id, userId));
  if (existing) {
    if (email && existing.email !== email) {
      await db.update(profiles).set({ email }).where(eq(profiles.id, userId));
    }
  } else {
    if (!(await authUserStillExists(userId))) throw unauthorized();
    await db
      .insert(profiles)
      .values({ id: userId, email })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { email },
        setWhere: sql`${profiles.email} is distinct from ${email} and ${email} <> ''`,
      });
  }
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
