/** Direct-to-database fixtures for the intelligence tests. */
import { randomUUID } from 'node:crypto';
import { countWords } from '@solace/shared';
import { db } from '../../src/db/client';
import { entries, profiles } from '../../src/db/schema';
import { enrichEntry } from '../../src/services/enrichment';
import { createTestUser, type TestUser } from '../helpers';

export async function seedUser(
  opts: { timezone?: string; aiStyle?: 'gentle' | 'direct' | 'curious' | 'stoic' } = {},
): Promise<TestUser> {
  const user = await createTestUser();
  await db.insert(profiles).values({
    id: user.id,
    email: user.email,
    timezone: opts.timezone ?? 'UTC',
    aiStyle: opts.aiStyle,
  });
  return user;
}

export type SeedEntry = {
  title?: string;
  body?: string;
  entryDate?: string;
  mood?: string | null;
  moodSource?: 'ai' | 'user' | null;
  tags?: string[];
  updatedAt?: Date;
};

export async function seedEntry(userId: string, e: SeedEntry = {}) {
  const [row] = await db
    .insert(entries)
    .values({
      id: randomUUID(),
      userId,
      title: e.title ?? '',
      body: e.body ?? '',
      entryDate: e.entryDate ?? new Date().toISOString().slice(0, 10),
      mood: e.mood ?? null,
      moodSource: e.moodSource ?? (e.mood ? 'user' : null),
      tags: e.tags ?? [],
      wordCount: countWords(e.body ?? ''),
      ...(e.updatedAt ? { updatedAt: e.updatedAt, createdAt: e.updatedAt } : {}),
    })
    .returning();
  return row!;
}

/** Seed and run enrichment synchronously (fake AI must be installed). */
export async function seedEnriched(userId: string, e: SeedEntry = {}) {
  const row = await seedEntry(userId, e);
  await enrichEntry({ entryId: row.id, userId, version: row.version });
  return row;
}
