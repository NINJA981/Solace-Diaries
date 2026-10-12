import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { entryPage, entry as entrySchema, localDate } from '@solace/shared';
import { db } from '../src/db/client';
import { entries, jobs, prompts } from '../src/db/schema';
import { JOB } from '../src/jobs/types';
import { createTestUser, resetDb, testApi, type TestUser } from './helpers';

const api = testApi();

beforeEach(resetDb);

async function create(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await api.post('/api/entries').set(user.headers).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return entrySchema.parse(res.body);
}

const enrichJobs = (entryId: string) =>
  db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, JOB.enrichEntry), eq(jobs.dedupeKey, `enrich:${entryId}`)));

describe('create', () => {
  it('creates an entry with defaults, word count and an enrichment job', async () => {
    const user = await createTestUser();
    const e = await create(user, {
      title: 'Morning',
      body: 'Walked  by the river\ntoday.',
      tags: ['Walk', 'walk'],
    });
    expect(e).toMatchObject({
      title: 'Morning',
      wordCount: 5,
      version: 1,
      enrichmentStatus: 'pending',
      tags: ['walk'],
      mood: null,
      attachments: [],
      entryDate: localDate(new Date(), 'UTC'),
    });
    const queued = await enrichJobs(e.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({ entryId: e.id, userId: user.id, version: 1 });
  });

  it('uses the profile timezone for the default entry date', async () => {
    const user = await createTestUser();
    await api.patch('/api/me').set(user.headers).send({ timezone: 'Pacific/Kiritimati' });
    const e = await create(user, { body: 'hello' });
    expect(e.entryDate).toBe(localDate(new Date(), 'Pacific/Kiritimati'));
  });

  it('does not enqueue enrichment for an empty draft', async () => {
    const user = await createTestUser();
    const e = await create(user, {});
    expect(e.enrichmentStatus).toBe('ready');
    expect(await enrichJobs(e.id)).toHaveLength(0);
  });

  it('is idempotent on a client-supplied id', async () => {
    const user = await createTestUser();
    const id = randomUUID();
    const first = await create(user, { id, body: 'offline draft' });
    const retry = await api
      .post('/api/entries')
      .set(user.headers)
      .send({ id, body: 'offline draft' });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.id);
    expect(await enrichJobs(id)).toHaveLength(1);
    const count = await db.select().from(entries).where(eq(entries.id, id));
    expect(count).toHaveLength(1);

    const intruder = await createTestUser();
    const stolen = await api
      .post('/api/entries')
      .set(intruder.headers)
      .send({ id, body: 'mine now' });
    expect(stolen.status).toBe(409);
  });

  it('marks an owned prompt answered and ignores a foreign prompt', async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await api.get('/api/me').set(user.headers);
    await api.get('/api/me').set(other.headers);
    const [mine] = await db
      .insert(prompts)
      .values({
        userId: user.id,
        text: 'What made you smile?',
        source: 'curated',
        forDate: '2026-10-13',
      })
      .returning();
    const [theirs] = await db
      .insert(prompts)
      .values({ userId: other.id, text: 'Theirs', source: 'curated', forDate: '2026-10-13' })
      .returning();

    const e = await create(user, { body: 'The dog', promptId: mine!.id });
    const [p] = await db.select().from(prompts).where(eq(prompts.id, mine!.id));
    expect(p).toMatchObject({ status: 'answered', entryId: e.id });

    await create(user, { body: 'sneaky', promptId: theirs!.id });
    const [t] = await db.select().from(prompts).where(eq(prompts.id, theirs!.id));
    expect(t).toMatchObject({ status: 'pending', entryId: null });
  });
});

describe('patch (optimistic concurrency)', () => {
  it('requires If-Match', async () => {
    const user = await createTestUser();
    const e = await create(user, { body: 'one' });
    const res = await api.patch(`/api/entries/${e.id}`).set(user.headers).send({ body: 'two' });
    expect(res.status).toBe(428);
    const bad = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', 'abc')
      .send({ body: 'two' });
    expect(bad.status).toBe(400);
  });

  it('bumps the version on content change and coalesces enrichment jobs', async () => {
    const user = await createTestUser();
    const e = await create(user, { body: 'one' });
    const r1 = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '1')
      .send({ body: 'one two' });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({
      version: 2,
      wordCount: 2,
      enrichmentStatus: 'pending',
      body: 'one two',
    });
    expect(r1.headers.etag).toBe('"2"');

    const r2 = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '"2"')
      .send({ body: 'one two three' });
    expect(r2.body.version).toBe(3);

    const queued = await enrichJobs(e.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toMatchObject({ version: 3 });
    // Debounced: autosave bursts push the run time out.
    expect(queued[0]!.runAfter.getTime()).toBeGreaterThan(Date.now() + 10_000);
  });

  it('rejects a stale version with 409 and the current version', async () => {
    const user = await createTestUser();
    const e = await create(user, { body: 'one' });
    await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '1')
      .send({ body: 'tab A' });
    const stale = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '1')
      .send({ body: 'tab B' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'version_conflict', fields: { version: '2' } });
    const current = await api.get(`/api/entries/${e.id}`).set(user.headers);
    expect(current.body.body).toBe('tab A');
  });

  it('treats an identical autosave as a no-op for the version', async () => {
    const user = await createTestUser();
    const e = await create(user, { title: 'T', body: 'same' });
    const res = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '1')
      .send({ title: 'T', body: 'same' });
    expect(res.body.version).toBe(1);
  });

  it('mood, tags and date changes do not bump the version or re-enrich', async () => {
    const user = await createTestUser();
    const e = await create(user, {});
    const res = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '1')
      .send({ mood: 'calm', tags: ['rest'], entryDate: '2026-01-02' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: 1,
      mood: 'calm',
      moodSource: 'user',
      tags: ['rest'],
      entryDate: '2026-01-02',
    });
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(new Date(e.updatedAt).getTime());
    expect(await enrichJobs(e.id)).toHaveLength(0);

    const cleared = await api
      .patch(`/api/entries/${e.id}`)
      .set(user.headers)
      .set('If-Match', '1')
      .send({ mood: null });
    expect(cleared.body).toMatchObject({ mood: null, moodSource: null });
  });
});

describe('isolation', () => {
  it("hides another user's entry from get, patch, delete, enrich and attachments", async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const e = await create(owner, { body: 'private' });
    const path = `/api/entries/${e.id}`;
    expect((await api.get(path).set(intruder.headers)).status).toBe(404);
    expect(
      (await api.patch(path).set(intruder.headers).set('If-Match', '1').send({ body: 'x' })).status,
    ).toBe(404);
    expect((await api.delete(path).set(intruder.headers)).status).toBe(404);
    expect((await api.post(`${path}/enrich`).set(intruder.headers)).status).toBe(404);
    expect(
      (
        await api
          .post(`${path}/attachments`)
          .set(intruder.headers)
          .attach('file', Buffer.from('x'), 'a.png')
      ).status,
    ).toBe(404);
    expect(
      (await api.delete(`${path}/attachments/${randomUUID()}`).set(intruder.headers)).status,
    ).toBe(404);
    const list = await api.get('/api/entries').set(intruder.headers);
    expect(list.body.items).toHaveLength(0);
    // Still intact for the owner.
    expect((await api.get(path).set(owner.headers)).body.body).toBe('private');
  });

  it('treats malformed ids as not found', async () => {
    const user = await createTestUser();
    expect((await api.get('/api/entries/not-a-uuid').set(user.headers)).status).toBe(404);
  });
});

describe('list', () => {
  it('paginates newest first with a stable cursor', async () => {
    const user = await createTestUser();
    const dates = ['2026-03-01', '2026-03-03', '2026-03-02', '2026-03-03', '2026-03-03'];
    const made = [];
    for (const [i, d] of dates.entries())
      made.push(await create(user, { title: `e${i}`, entryDate: d }));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await api
        .get('/api/entries')
        .set(user.headers)
        .query({ limit: 2, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      const page = entryPage.parse(res.body);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.title));
      cursor = page.nextCursor;
    } while (cursor);

    // Same date → newer created_at first.
    expect(seen).toEqual(['e4', 'e3', 'e1', 'e2', 'e0']);
  });

  it('filters by date range, mood and tag and reports attachment counts', async () => {
    const user = await createTestUser();
    await create(user, { title: 'a', entryDate: '2026-01-10', mood: 'calm', tags: ['work'] });
    await create(user, {
      title: 'b',
      entryDate: '2026-02-10',
      mood: 'sad',
      tags: ['family', 'work'],
    });
    await create(user, { title: 'c', entryDate: '2026-03-10', mood: 'calm' });
    const titles = async (query: Record<string, string>) =>
      (await api.get('/api/entries').set(user.headers).query(query)).body.items.map(
        (i: { title: string }) => i.title,
      );

    expect(await titles({ from: '2026-02-01' })).toEqual(['c', 'b']);
    expect(await titles({ from: '2026-01-01', to: '2026-02-10' })).toEqual(['b', 'a']);
    expect(await titles({ mood: 'calm' })).toEqual(['c', 'a']);
    expect(await titles({ tag: 'Work' })).toEqual(['b', 'a']);

    const res = await api.get('/api/entries').set(user.headers);
    expect(res.body.items[0]).toMatchObject({ attachmentCount: 0, excerpt: '' });
    expect(res.body.items[0].body).toBeUndefined();
  });

  it('rejects bad cursors and limits', async () => {
    const user = await createTestUser();
    expect((await api.get('/api/entries?cursor=garbage').set(user.headers)).status).toBe(400);
    const forged = Buffer.from(JSON.stringify(['2026-01-01', 'drop table', randomUUID()])).toString(
      'base64url',
    );
    expect((await api.get(`/api/entries?cursor=${forged}`).set(user.headers)).status).toBe(400);
    expect((await api.get('/api/entries?limit=500').set(user.headers)).status).toBe(400);
  });
});

describe('delete and retry', () => {
  it('deletes an entry and its queued jobs', async () => {
    const user = await createTestUser();
    const e = await create(user, { body: 'bye' });
    expect((await api.delete(`/api/entries/${e.id}`).set(user.headers)).status).toBe(204);
    expect((await api.get(`/api/entries/${e.id}`).set(user.headers)).status).toBe(404);
    expect(await enrichJobs(e.id)).toHaveLength(0);
  });

  it('re-queues enrichment only for failed entries', async () => {
    const user = await createTestUser();
    const e = await create(user, { body: 'words' });
    await db.delete(jobs);
    const notFailed = await api.post(`/api/entries/${e.id}/enrich`).set(user.headers);
    expect(notFailed.status).toBe(200);
    expect(await enrichJobs(e.id)).toHaveLength(0);

    await db.update(entries).set({ enrichmentStatus: 'failed' }).where(eq(entries.id, e.id));
    const retried = await api.post(`/api/entries/${e.id}/enrich`).set(user.headers);
    expect(retried.body.enrichmentStatus).toBe('pending');
    expect(await enrichJobs(e.id)).toHaveLength(1);
  });
});
