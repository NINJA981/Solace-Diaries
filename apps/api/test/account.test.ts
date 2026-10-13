import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { chatMessages, chatThreads, memories, memorySources } from '../src/db/schema';
import { forgetProfile, setAuthUserLookup } from '../src/services/profiles';
import { listObjects } from '../src/storage';
import { createTestUser, pngBytes, resetDb, testApi, type TestUser } from './helpers';

const api = testApi();

beforeEach(resetDb);

async function seedJournal(user: TestUser) {
  const older = await api.post('/api/entries').set(user.headers).send({
    title: 'First steps',
    body: 'Started journaling.',
    entryDate: '2026-01-01',
    mood: 'hopeful',
  });
  const newer = await api
    .post('/api/entries')
    .set(user.headers)
    .send({
      title: 'Later',
      body: 'A **good** day.',
      entryDate: '2026-02-01',
      tags: ['walk', 'sun'],
    });
  await api
    .post(`/api/entries/${newer.body.id}/attachments`)
    .set(user.headers)
    .attach('file', await pngBytes(), { filename: 'p.png', contentType: 'image/png' });
  const [memory] = await db
    .insert(memories)
    .values({ userId: user.id, kind: 'habit', content: 'Walks most mornings' })
    .returning();
  await db.insert(memorySources).values({ memoryId: memory!.id, entryId: newer.body.id });
  const [thread] = await db
    .insert(chatThreads)
    .values({ userId: user.id, title: 'On walking' })
    .returning();
  await db.insert(chatMessages).values([
    { threadId: thread!.id, userId: user.id, role: 'user', content: 'Why do I walk?' },
    {
      threadId: thread!.id,
      userId: user.id,
      role: 'assistant',
      content: 'You said it clears your head.',
    },
  ]);
  return {
    olderId: older.body.id as string,
    newerId: newer.body.id as string,
    memoryId: memory!.id,
  };
}

describe('profile', () => {
  it('updates profile fields and validates the timezone', async () => {
    const user = await createTestUser();
    const ok = await api.patch('/api/me').set(user.headers).send({
      displayName: '  Ada ',
      timezone: 'Asia/Kolkata',
      onboardingDone: true,
      reminderHour: 21,
      aiStyle: 'curious',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      displayName: 'Ada',
      timezone: 'Asia/Kolkata',
      onboardingDone: true,
      reminderHour: 21,
      aiStyle: 'curious',
    });

    const bad = await api
      .patch('/api/me')
      .set(user.headers)
      .send({ timezone: 'Mars/Olympus_Mons' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toHaveProperty('timezone');
  });
});

describe('export', () => {
  it('exports everything as a JSON download', async () => {
    const user = await createTestUser();
    const { olderId, newerId, memoryId } = await seedJournal(user);
    const other = await createTestUser();
    await api.post('/api/entries').set(other.headers).send({ body: 'not yours' });

    const res = await api.get('/api/me/export?format=json').set(user.headers).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="solace-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const data = JSON.parse(res.text);
    expect(data.profile.id).toBe(user.id);
    expect(data.entries.map((e: { id: string }) => e.id)).toEqual([newerId, olderId]);
    expect(data.entries[0]).toMatchObject({ tags: ['walk', 'sun'], body: 'A **good** day.' });
    expect(data.entries[0].attachments[0]).toMatchObject({
      mime: 'image/webp',
      url: expect.stringContaining('storage.test'),
    });
    expect(data.entries[1]).toMatchObject({ mood: 'hopeful', entryDate: '2026-01-01' });
    expect(data.memories).toEqual([
      expect.objectContaining({
        id: memoryId,
        content: 'Walks most mornings',
        sourceEntryIds: [newerId],
      }),
    ]);
    expect(data.threads[0].messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(res.text).not.toContain('not yours');
  });

  it('exports entries as Markdown, newest first', async () => {
    const user = await createTestUser();
    await seedJournal(user);
    const res = await api.get('/api/me/export?format=markdown').set(user.headers).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.headers['content-disposition']).toMatch(/\.md"$/);
    expect(res.text.indexOf('## Later')).toBeGreaterThan(-1);
    expect(res.text.indexOf('## Later')).toBeLessThan(res.text.indexOf('## First steps'));
    expect(res.text).toContain('**Date:** 2026-01-01 · **Mood:** hopeful');
    expect(res.text).toContain('**Tags:** walk, sun');
    expect(res.text).toContain('Started journaling.');
  });

  it('rejects an unknown format', async () => {
    const user = await createTestUser();
    expect((await api.get('/api/me/export?format=pdf').set(user.headers)).status).toBe(400);
  });
});

describe('delete account', () => {
  it('requires the account email to confirm', async () => {
    const user = await createTestUser('Me@Example.test');
    await seedJournal(user);
    const res = await api
      .delete('/api/me')
      .set(user.headers)
      .send({ confirmEmail: 'someone@else.test' });
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('confirmEmail');
    expect((await api.get('/api/entries').set(user.headers)).body.items).toHaveLength(2);
  });

  it('deletes every row and stored photo of the user, and only theirs', async () => {
    const user = await createTestUser('Me@Example.test');
    await seedJournal(user);
    const other = await createTestUser();
    await seedJournal(other);

    const res = await api
      .delete('/api/me')
      .set(user.headers)
      .send({ confirmEmail: 'me@example.TEST' });
    expect(res.status).toBe(204);

    const tables = [
      'profiles',
      'entries',
      'attachments',
      'memories',
      'chat_threads',
      'chat_messages',
    ];
    for (const table of tables) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const [mine] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${user.id}`,
      );
      expect(mine!.n, table).toBe(0);
      const [theirs] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${other.id}`,
      );
      expect(theirs!.n, table).toBeGreaterThan(0);
    }
    const [jobsLeft] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from jobs where payload->>'userId' = ${user.id}`,
    );
    expect(jobsLeft!.n).toBe(0);
    expect(await listObjects(`${user.id}/`)).toHaveLength(0);
    expect(await listObjects(`${other.id}/`)).toHaveLength(1);
  });
});

describe('deleted accounts stay deleted', () => {
  afterEach(() => setAuthUserLookup());

  it('an access token issued before deletion gets 401 and never recreates the profile', async () => {
    const user = await createTestUser();
    await seedJournal(user);
    // Supabase's view of the world: once deleted, the auth user is gone.
    const deleted = new Set<string>();
    setAuthUserLookup(async (id) => !deleted.has(id));

    const res = await api.delete('/api/me').set(user.headers).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    deleted.add(user.id);

    // The same (still unexpired) token, on any route.
    for (const path of ['/api/me', '/api/entries']) {
      const again = await api.get(path).set(user.headers);
      expect(again.status, path).toBe(401);
      expect(again.body.code).toBe('unauthorized');
    }
    const write = await api.post('/api/entries').set(user.headers).send({ body: 'back?' });
    expect(write.status).toBe(401);
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from profiles where id = ${user.id}`,
    );
    expect(row!.n).toBe(0);
  });

  it('answers 503 when the auth admin API is unreachable for a new user', async () => {
    const user = await createTestUser();
    setAuthUserLookup(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await api.get('/api/me').set(user.headers);
    expect(res.status).toBe(503);
    // Existing profiles never need the lookup.
    setAuthUserLookup();
    expect((await api.get('/api/me').set(user.headers)).status).toBe(200);
    setAuthUserLookup(async () => {
      throw new Error('ECONNREFUSED');
    });
    forgetProfile(user.id);
    expect((await api.get('/api/me').set(user.headers)).status).toBe(200);
  });
});
