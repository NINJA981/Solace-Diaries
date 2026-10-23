import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { entryPage, entry as entrySchema, localDate } from '@solace/shared';
import { config } from '../src/config';
import { db } from '../src/db/client';
import {
  entries,
  graphEdges,
  graphNodeSources,
  graphNodes,
  jobs,
  memories,
  memorySources,
  prompts,
} from '../src/db/schema';
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
    // The first autosave is usually a few words: wait for a pause in writing, like edits do.
    expect(queued[0]!.runAfter.getTime()).toBeGreaterThan(Date.now() + 10_000);
  });

  it('waits ENRICH_DEBOUNCE_MS before enriching, on create and on update (0 = at once)', async () => {
    const saved = config.ENRICH_DEBOUNCE_MS;
    try {
      const user = await createTestUser();
      (config as { ENRICH_DEBOUNCE_MS: number }).ENRICH_DEBOUNCE_MS = 45_000;
      const e = await create(user, { body: 'one two three' });
      const wait = async () => (await enrichJobs(e.id))[0]!.runAfter.getTime() - Date.now();
      expect(await wait()).toBeGreaterThan(44_000);
      expect(await wait()).toBeLessThanOrEqual(45_000);

      await db.delete(jobs).where(eq(jobs.dedupeKey, `enrich:${e.id}`));
      (config as { ENRICH_DEBOUNCE_MS: number }).ENRICH_DEBOUNCE_MS = 0;
      await api
        .patch(`/api/entries/${e.id}`)
        .set(user.headers)
        .set('If-Match', '1')
        .send({ body: 'one two three four' })
        .expect(200);
      expect(Math.abs(await wait())).toBeLessThan(2_000);
    } finally {
      (config as { ENRICH_DEBOUNCE_MS: number }).ENRICH_DEBOUNCE_MS = saved;
    }
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

  it('signals a fresh create vs an existing row (201/200 and X-Entry-Created)', async () => {
    const user = await createTestUser();
    const id = randomUUID();
    const fresh = await api.post('/api/entries').set(user.headers).send({ id, body: 'first' });
    expect(fresh.status).toBe(201);
    expect(fresh.headers['x-entry-created']).toBe('true');

    // A retry with different text gets the stored row back, flagged as not created.
    const retry = await api.post('/api/entries').set(user.headers).send({ id, body: 'second' });
    expect(retry.status).toBe(200);
    expect(retry.headers['x-entry-created']).toBe('false');
    expect(retry.body.body).toBe('first');
  });

  it('rejects impossible dates with 400, not a database error', async () => {
    const user = await createTestUser();
    for (const entryDate of ['2024-02-31', '2024-13-01']) {
      const res = await api.post('/api/entries').set(user.headers).send({ entryDate, body: 'x' });
      expect(res.status, entryDate).toBe(400);
      expect(res.body.fields).toHaveProperty('entryDate');
    }
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
    // Deletes are idempotent and never reveal whether the id exists (see 'delete' below).
    expect((await api.delete(path).set(intruder.headers)).status).toBe(204);
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
    // Well-formed but impossible dates/times must be a 400 too, not a Postgres error.
    const cursor = (c: unknown[]) => Buffer.from(JSON.stringify(c)).toString('base64url');
    for (const bad of [
      ['2024-02-31', '2024-01-01 10:00:00.123456+00', randomUUID()],
      ['2024-01-01', '2024-13-45 10:00:00+00', randomUUID()],
      ['2024-01-01', '2024-01-01 25:61:00+00', randomUUID()],
    ]) {
      const res = await api.get(`/api/entries?cursor=${cursor(bad)}`).set(user.headers);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = ['2024-01-01', '2024-01-01 10:00:00.123456+05:30', randomUUID()];
    expect((await api.get(`/api/entries?cursor=${cursor(ok)}`).set(user.headers)).status).toBe(200);
    expect((await api.get('/api/entries?from=2024-02-31').set(user.headers)).status).toBe(400);
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

  it('is idempotent: a missing, already deleted or foreign id answers 204', async () => {
    const user = await createTestUser();
    const e = await create(user, { body: 'twice' });
    expect((await api.delete(`/api/entries/${e.id}`).set(user.headers)).status).toBe(204);
    expect((await api.delete(`/api/entries/${e.id}`).set(user.headers)).status).toBe(204);
    expect((await api.delete(`/api/entries/${randomUUID()}`).set(user.headers)).status).toBe(204);

    const other = await createTestUser();
    const theirs = await create(other, { body: 'not yours' });
    expect((await api.delete(`/api/entries/${theirs.id}`).set(user.headers)).status).toBe(204);
    expect((await api.get(`/api/entries/${theirs.id}`).set(other.headers)).status).toBe(200);
  });

  it('forgets memories and graph nodes that only this entry supported', async () => {
    const user = await createTestUser();
    const gone = await create(user, { body: 'the entry being deleted' });
    const kept = await create(user, { body: 'another entry' });

    const [onlyGone, shared, edited] = await db
      .insert(memories)
      .values([
        { userId: user.id, kind: 'fact', content: 'only from the deleted entry' },
        { userId: user.id, kind: 'habit', content: 'from both entries', salience: 2 },
        { userId: user.id, kind: 'goal', content: 'user edited', userEdited: true },
      ])
      .returning();
    await db.insert(memorySources).values([
      { memoryId: onlyGone!.id, entryId: gone.id },
      { memoryId: shared!.id, entryId: gone.id },
      { memoryId: shared!.id, entryId: kept.id },
      { memoryId: edited!.id, entryId: gone.id },
    ]);

    const node = (name: string, weight: number) => ({
      userId: user.id,
      name,
      key: name.toLowerCase(),
      kind: 'person' as const,
      weight,
    });
    const [solo, both, other] = await db
      .insert(graphNodes)
      .values([node('Solo', 1), node('Both', 2), node('Other', 1)])
      .returning();
    await db.insert(graphNodeSources).values([
      { nodeId: solo!.id, entryId: gone.id },
      { nodeId: both!.id, entryId: gone.id },
      { nodeId: both!.id, entryId: kept.id },
      { nodeId: other!.id, entryId: kept.id },
    ]);
    const [a, b] = [solo!.id, both!.id].sort();
    await db.insert(graphEdges).values({ userId: user.id, source: a!, target: b! });

    expect((await api.delete(`/api/entries/${gone.id}`).set(user.headers)).status).toBe(204);

    const left = await db.select().from(memories).where(eq(memories.userId, user.id));
    expect(left.map((m) => m.content).sort()).toEqual(['from both entries', 'user edited']);
    const nodes = await db.select().from(graphNodes).where(eq(graphNodes.userId, user.id));
    expect(Object.fromEntries(nodes.map((n) => [n.name, n.weight]))).toEqual({ Both: 1, Other: 1 });
    expect(await db.select().from(graphEdges).where(eq(graphEdges.userId, user.id))).toEqual([]);
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
