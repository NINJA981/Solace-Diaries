/**
 * Shared API test helpers (used by the platform and intelligence test suites).
 * Tests run against a real Postgres; point TEST_DATABASE_URL at a database you can wipe.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import supertest from 'supertest';
import { createApp, type AppOptions } from '../src/app';
import { db } from '../src/db/client';
import { forgetProfile } from '../src/services/profiles';

export type TokenOptions = {
  /** Seconds until expiry (negative = already expired). Default 1 hour. */
  expiresInSec?: number;
  audience?: string;
  role?: string;
  /** Sign with a different HS256 secret (forged token). */
  secret?: string;
};

/** A Supabase-shaped HS256 access token, signed with the test JWT secret. */
export async function tokenFor(
  userId: string,
  email = emailFor(userId),
  opts: TokenOptions = {},
): Promise<string> {
  const secret = opts.secret ?? process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set for tests');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email,
    role: opts.role ?? 'authenticated',
    aal: 'aal1',
    session_id: randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setAudience(opts.audience ?? 'authenticated')
    .setIssuer('http://127.0.0.1:55321/auth/v1')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresInSec ?? 3600))
    .sign(new TextEncoder().encode(secret));
}

const emailFor = (userId: string) => `user-${userId.slice(0, 8)}@example.test`;

export type TestUser = {
  id: string;
  email: string;
  token: string;
  /** Spread into supertest's `.set(...)`. */
  headers: { Authorization: string };
};

export async function createTestUser(email?: string): Promise<TestUser> {
  const id = randomUUID();
  const mail = email ?? emailFor(id);
  const token = await tokenFor(id, mail);
  return { id, email: mail, token, headers: { Authorization: `Bearer ${token}` } };
}

/** Wipe every table. Refuses to run outside NODE_ENV=test. */
export async function resetDb(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') throw new Error('resetDb() only runs with NODE_ENV=test');
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length) {
    await db.execute(sql.raw(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} cascade`));
  }
  forgetProfile();
}

/** supertest bound to a fresh app instance (fresh rate-limit counters). */
export function testApi(opts?: AppOptions) {
  return supertest(createApp(opts));
}

/** A small real PNG (solid color) for upload tests. */
export function pngBytes(width = 32, height = 24): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } } })
    .png()
    .toBuffer();
}
