/**
 * Regressions for the AI-budget review: memory selection, post-commit isolation, budget
 * refunds and pause pre-checks, weekly-letter refresh errors, and request cancellation.
 */
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate, weeklyLetterResponse } from '@solace/shared';
import { embedText, generateText } from '../../src/ai/gemini';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { aiUsage, attachments, entries, entryChunks, memories } from '../../src/db/schema';
import { INTERACTIVE_INLINE_WAIT_MS, interactiveAi } from '../../src/http/ai-options';
import { handlers } from '../../src/jobs/handlers/index';
import { DeferJobError, JOB } from '../../src/jobs/types';
import { enrichEntry } from '../../src/services/enrichment';
import { MEMORY_CONTEXT_LIMIT, memoryContext } from '../../src/services/memories';
import { resetDb, testApi } from '../helpers';
import {
  burstLimited,
  enrichReply,
  httpError,
  installFakeAi,
  memoryHandles,
  quotaPerDay,
  quotaSpent,
  type FakeAi,
} from './fake-ai';
import { seedEntry, seedUser } from './seed';

const api = testApi();
let fake: FakeAi;
beforeEach(async () => {
  await resetDb();
  fake = installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

const ctx = { id: 'job', attempt: 1, signal: new AbortController().signal };
const enrichJob = (userId: string, entryId: string) =>
  handlers[JOB.enrichEntry]!({ entryId, userId, version: 1 }, ctx);
const reload = async (id: string) =>
  (await db.select().from(entries).where(eq(entries.id, id)))[0]!;
const usageRow = async (userId: string) =>
  (await db.select().from(aiUsage).where(eq(aiUsage.userId, userId)))[0];
const enrichRuns = async (userId: string) => (await usageRow(userId))?.enrichRuns ?? 0;

async function seedMemory(
  userId: string,
  content: string,
  extra: Partial<typeof memories.$inferInsert> = {},
) {
  const [row] = await db
    .insert(memories)
    .values({
      userId,
      kind: 'goal',
      content,
      embedding: await embedText(content, 'RETRIEVAL_DOCUMENT'),
      model: config.GEMINI_EMBED_MODEL,
      ...extra,
    })
    .returning();
  return row!;
}

/** Make Gemini refuse `task` (or embeddings) so its model is paused for an hour. */
async function pause(lane: 'chat' | 'batch' | 'vision' | 'embed' | 'enrich') {
  fake.failures = [quotaSpent(3_600)];
  if (lane === 'embed') await embedText('x', 'RETRIEVAL_QUERY').catch(() => {});
  else await generateText({ task: lane, user: 'x' }).catch(() => {});
}

describe('enriching entries with no word of three letters or more', () => {
  it('enriches "ok so so ok" instead of failing memory selection', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'ok so so ok' });
    await enrichEntry({ entryId: e.id, userId: user.id, version: 1 });
    expect(await reload(e.id)).toMatchObject({ enrichmentStatus: 'ready', enrichedVersion: 1 });
    expect(fake.calls('enrich')).toHaveLength(1);
  });

  it('selects memories by salience when the text has no matchable words', async () => {
    const user = await seedUser();
    await seedMemory(user.id, 'You run on Sundays.', { salience: 4 });
    const ctxt = await memoryContext(user.id, { id: crypto.randomUUID(), text: '😊 😊 😊 😊' });
    expect([...ctxt.handles.keys()]).toEqual(['m1']);
  });
});

describe('memories for a re-enriched entry', () => {
  const fillers = async (userId: string, n: number) => {
    // Identical words, so identical embeddings: they all sit right next to the first draft.
    for (let i = 0; i < n; i++)
      await seedMemory(userId, `You enjoy hobby number ${i} quilting`, { salience: 5 });
  };
  const shown = () => [...memoryHandles(fake.calls('enrich').at(-1)!).values()];

  it('keeps room for memories that match what the entry says now', async () => {
    const user = await seedUser();
    await fillers(user.id, MEMORY_CONTEXT_LIMIT + 5);
    await seedMemory(user.id, 'You love tea on rainy days.');
    const e = await seedEntry(user.id, { body: 'Enjoy the hobby number quilting hobby.' });
    await enrichEntry({ entryId: e.id, userId: user.id, version: 1 });
    expect(shown()).not.toContain('You love tea on rainy days.'); // nothing about tea yet

    await db
      .update(entries)
      .set({ version: 2, body: 'Grey day. Rain on the window, tea going cold.' })
      .where(eq(entries.id, e.id));
    await enrichEntry({ entryId: e.id, userId: user.id, version: 2 });
    expect(shown()).toContain('You love tea on rainy days.');
    expect(shown().length).toBeLessThanOrEqual(MEMORY_CONTEXT_LIMIT);
  });

  it('never shows another user’s or an archived memory through the vector path', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const text = 'Marathon training along the river with Maya.';
    const e = await seedEntry(user.id, { body: text });
    await enrichEntry({ entryId: e.id, userId: user.id, version: 1 }); // stores its passages
    expect((await db.select().from(entryChunks).where(eq(entryChunks.entryId, e.id))).length).toBe(
      1,
    );

    // Each of these embeds exactly like the entry, so it is the nearest of all.
    await seedMemory(other.id, text);
    await seedMemory(user.id, text, { status: 'archived' });
    await seedMemory(user.id, 'Your sister lives in Lisbon.');
    await db
      .update(entries)
      .set({ version: 2, body: 'Quiet evening at home.' })
      .where(eq(entries.id, e.id));
    await enrichEntry({ entryId: e.id, userId: user.id, version: 2 });

    const handles = shown();
    expect(handles).toEqual(['Your sister lives in Lisbon.']);
  });

});

describe('after the entry is saved', () => {
  it('a failing graph or memory step never fails the job, and nothing is sent twice', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    fake.replies.enrich = () =>
      enrichReply({
        summary: 'You walked.',
        memoryOps: [{ op: 'create', kind: 'goal', content: 'You walk by the river.' }],
        entities: [{ name: 'Ma\u0000ya', kind: 'person' }], // Postgres rejects a NUL byte
      });
    await expect(enrichJob(user.id, e.id)).resolves.toBeUndefined();
    expect(await reload(e.id)).toMatchObject({
      enrichmentStatus: 'ready',
      summary: 'You walked.',
    });
    expect(await db.select().from(entryChunks).where(eq(entryChunks.entryId, e.id))).toHaveLength(
      1,
    );
    const mems = await db.select().from(memories).where(eq(memories.userId, user.id));
    expect(mems.map((m) => m.content)).toEqual(['You walk by the river.']);
    expect(fake.generateCalls).toHaveLength(1);
  });

  it('treats a missing or null list as "nothing", not as a failed answer', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    fake.replies.enrich = () =>
      JSON.stringify({
        mood: 'calm',
        tags: ['walks'],
        summary: 'You walked.',
        memoryOps: null,
        relations: 'none',
      });
    await enrichJob(user.id, e.id);
    expect(await reload(e.id)).toMatchObject({ enrichmentStatus: 'ready', summary: 'You walked.' });
    expect(fake.calls('enrich')).toHaveLength(1); // no repair round
  });
});

describe('Gemini refusals and the enrichment budget', () => {
  it('waits out a per-day quota whose RetryInfo is short, and gives the budget unit back', async () => {
    const user = await seedUser();
    const a = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    const b = await seedEntry(user.id, { body: 'Walked by the harbour with Leo today, again.' });
    fake.failures = [quotaPerDay(22)];
    const first = await enrichJob(user.id, a.id).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(DeferJobError);
    expect((first as DeferJobError).until.getTime() - Date.now()).toBeGreaterThan(59_000);
    expect(await enrichRuns(user.id)).toBe(0); // the refused request cost nothing

    // Nothing more is sent, or charged, while the model is out of quota.
    const second = await enrichJob(user.id, b.id).catch((e: unknown) => e);
    expect(second).toBeInstanceOf(DeferJobError);
    expect(fake.calls('enrich')).toHaveLength(1);
    expect(await enrichRuns(user.id)).toBe(0);
    expect((await reload(b.id)).enrichmentStatus).toBe('pending');
  });

  it('refunds a run refused with a bare 429 that names no quota or delay', async () => {
    const user = await seedUser();
    const a = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    fake.failures = [httpError(429), httpError(429), httpError(429)];
    expect(await enrichJob(user.id, a.id).catch((e: unknown) => e)).toBeInstanceOf(DeferJobError);
    expect(await enrichRuns(user.id)).toBe(0);
    expect((await reload(a.id)).enrichmentStatus).toBe('pending');
  });

  it('still charges a run that failed for another reason', async () => {
    const user = await seedUser();
    const a = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    fake.failures = [httpError(503), httpError(503), httpError(503)];
    await expect(enrichJob(user.id, a.id)).rejects.toThrow();
    expect(await enrichRuns(user.id)).toBe(1);
  });

  it('does not sleep on a long rate limit inside a job: it defers instead', async () => {
    const user = await seedUser();
    const a = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    fake.failures = [burstLimited(25)];
    const started = Date.now();
    const err = await enrichJob(user.id, a.id).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(err).toBeInstanceOf(DeferJobError);
    expect(fake.calls('enrich')).toHaveLength(1);
    expect(await enrichRuns(user.id)).toBe(0);
  });
});

describe('requests known to fail are not charged', () => {
  const calls = async (userId: string) => (await usageRow(userId))?.calls ?? 0;

  it('enrichment waits while the embedding model is paused, without spending a unit', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'Walked by the river with Maya today, again.' });
    await pause('embed');
    const err = await enrichJob(user.id, e.id).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(DeferJobError);
    expect(fake.calls('enrich')).toHaveLength(0);
    expect(await enrichRuns(user.id)).toBe(0);
  });

  it('photo descriptions wait while the vision model is paused', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'Beach day.' });
    const [att] = await db
      .insert(attachments)
      .values({ entryId: e.id, userId: user.id, storagePath: 'p', mime: 'image/png', bytes: 1 })
      .returning();
    await pause('vision');
    const err = await handlers[JOB.describeAttachment]!(
      { attachmentId: att!.id, userId: user.id },
      ctx,
    ).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(DeferJobError);
    expect(fake.calls('photo')).toHaveLength(0);
    expect(await enrichRuns(user.id)).toBe(0);
  });

  it('search falls back to exact words without charging when embeddings are paused or no key is set', async () => {
    const user = await seedUser();
    await seedEntry(user.id, { title: 'Harbour', body: 'Watched the ferries at the harbour.' });
    await pause('embed');
    const embeds = fake.embedCalls.length;
    const res = await api.get('/api/search').query({ q: 'ferries' }).set(user.headers).expect(200);
    expect(res.body.mode).toBe('keyword');
    expect(fake.embedCalls).toHaveLength(embeds);
    expect(await usageRow(user.id)).toBeUndefined();

    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
    const none = await api.get('/api/search').query({ q: 'ferries' }).set(user.headers).expect(200);
    expect(none.body.mode).toBe('keyword');
    expect(await usageRow(user.id)).toBeUndefined();
  });

  it('the daily prompt is curated without charging when the batch model is paused', async () => {
    const user = await seedUser();
    await db
      .insert(memories)
      .values({ userId: user.id, kind: 'goal', content: 'You are training.', salience: 3 });
    await pause('batch');
    const sent = fake.generateCalls.length;
    const res = await api.get('/api/prompts/today').set(user.headers).expect(200);
    expect(res.body.prompt.source).toBe('curated');
    expect(fake.generateCalls).toHaveLength(sent);
    expect(await usageRow(user.id)).toBeUndefined();
  });

  it('the daily prompt does not wait out a long rate limit before falling back', async () => {
    const user = await seedUser();
    await db
      .insert(memories)
      .values({ userId: user.id, kind: 'goal', content: 'You are training.', salience: 3 });
    fake.failures = [burstLimited(25)];
    const started = Date.now();
    const res = await api.get('/api/prompts/today').set(user.headers).expect(200);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(res.body.prompt.source).toBe('curated');
    expect(fake.generateCalls).toHaveLength(1);
  });

  it('editing a memory keeps the budget when embeddings are paused', async () => {
    const user = await seedUser();
    const mine = await seedMemory(user.id, 'You are learning Portuguese.');
    await pause('embed');
    const embeds = fake.embedCalls.length;
    await api
      .patch(`/api/memories/${mine.id}`)
      .set(user.headers)
      .send({ content: 'You are learning Italian.' })
      .expect(200);
    expect(fake.embedCalls).toHaveLength(embeds);
    expect(await usageRow(user.id)).toBeUndefined();
    expect((await db.select().from(memories).where(eq(memories.id, mine.id)))[0]).toMatchObject({
      content: 'You are learning Italian.',
      embedding: null,
    });
  });

  it('Reflect answers 429 before streaming, uncharged, when only the embedding model is paused', async () => {
    const user = await seedUser();
    const t = (await api.post('/api/threads').set(user.headers).send({}).expect(201)).body;
    await pause('embed');
    const res = await api
      .post(`/api/threads/${t.id}/messages`)
      .set(user.headers)
      .send({ content: 'What made me happy?' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('ai_quota_exceeded');
    expect(fake.streamCalls).toHaveLength(0);
    expect(await calls(user.id)).toBe(0);
  });

  it('Reflect still streams on a person’s own key while the server key’s chat model is paused', async () => {
    const user = await seedUser();
    const t = (await api.post('/api/threads').set(user.headers).send({}).expect(201)).body;
    await pause('chat');
    expect(
      (
        await api
          .post(`/api/threads/${t.id}/messages`)
          .set(user.headers)
          .send({ content: 'And snow?' })
      ).status,
    ).toBe(429);
    const own = await api
      .post(`/api/threads/${t.id}/messages`)
      .set({ ...user.headers, 'x-gemini-key': 'mine' })
      .send({ content: 'And snow?' })
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(own.status).toBe(200);
    expect(String(own.body)).toContain('event: done');
  });
});

describe('Reflect and a model that never starts answering', () => {
  it('ends with an error event once the first-token limit passes', async () => {
    const user = await seedUser();
    const t = (await api.post('/api/threads').set(user.headers).send({}).expect(201)).body;
    fake.streamDelayMs = 600;
    const saved = config.AI_FIRST_TOKEN_MS;
    (config as { AI_FIRST_TOKEN_MS: number }).AI_FIRST_TOKEN_MS = 80;
    try {
      const started = Date.now();
      const res = await api
        .post(`/api/threads/${t.id}/messages`)
        .set(user.headers)
        .send({ content: 'Anything about rain?' })
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (data += c));
          r.on('end', () => cb(null, data));
        });
      expect(Date.now() - started).toBeLessThan(550);
      expect(String(res.body)).toContain('event: error');
      expect(String(res.body)).toContain('ai_unavailable');
      expect(String(res.body)).not.toContain('event: done');
    } finally {
      (config as { AI_FIRST_TOKEN_MS: number }).AI_FIRST_TOKEN_MS = saved;
    }
  });
});

describe('weekly letter refresh', () => {
  async function weekWithStaleLetter() {
    const user = await seedUser();
    const today = localDate(new Date(), 'UTC');
    const first = await seedEntry(user.id, { body: 'Rain all morning.', entryDate: today });
    await seedEntry(user.id, { body: 'Sunny walk later.', entryDate: today });
    const letter = weeklyLetterResponse.parse(
      (await api.get('/api/insights/weekly').set(user.headers).expect(200)).body,
    ).letter!;
    await db.update(entries).set({ body: 'Edited.' }).where(eq(entries.id, first.id));
    return { user, letter };
  }
  const refresh = (headers: Record<string, string>) =>
    api.post('/api/insights/weekly/refresh').set(headers);
  const stillServed = async (headers: Record<string, string>, content: string) => {
    const res = await api.get('/api/insights/weekly').set(headers).expect(200);
    expect(res.body.letter).toMatchObject({ content, stale: true });
  };

  it('returns 429 ai_quota_exceeded when the budget is spent, while GET serves the stale letter', async () => {
    const { user, letter } = await weekWithStaleLetter();
    await db
      .insert(aiUsage)
      .values({ userId: user.id, day: new Date().toISOString().slice(0, 10), calls: config.AI_DAILY_QUOTA })
      .onConflictDoUpdate({
        target: [aiUsage.userId, aiUsage.day],
        set: { calls: config.AI_DAILY_QUOTA },
      });
    const res = await refresh(user.headers);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('ai_quota_exceeded');
    await stillServed(user.headers, letter.content);
  });

  it('returns 429 ai_quota_exceeded for a spent provider quota, and stops spending once paused', async () => {
    const { user, letter } = await weekWithStaleLetter();
    fake.failures = [quotaPerDay(30)];
    const first = await refresh(user.headers);
    expect(first.status).toBe(429);
    expect(first.body.code).toBe('ai_quota_exceeded');
    const spent = (await usageRow(user.id))!.calls;
    const sent = fake.calls('weekly').length;

    const second = await refresh(user.headers);
    expect(second.status).toBe(429);
    expect((await usageRow(user.id))!.calls).toBe(spent);
    expect(fake.calls('weekly')).toHaveLength(sent);
    await stillServed(user.headers, letter.content);
  });

  it('returns 429 rate_limited for a burst limit', async () => {
    const { user } = await weekWithStaleLetter();
    fake.failures = [burstLimited(25)];
    const res = await refresh(user.headers);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limited');
  });

  it('returns 503 ai_unavailable when Gemini is down or no key is set', async () => {
    const { user, letter } = await weekWithStaleLetter();
    fake.failures = [httpError(503), httpError(503), httpError(503)];
    const down = await refresh(user.headers);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('ai_unavailable');
    await stillServed(user.headers, letter.content);

    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
    const nokey = await refresh(user.headers);
    expect(nokey.status).toBe(503);
    expect(nokey.body.code).toBe('ai_unavailable');
  });

  it('the first letter is not charged while the batch model is paused, and a real outage is a 503', async () => {
    const user = await seedUser();
    const today = localDate(new Date(), 'UTC');
    await seedEntry(user.id, { body: 'a', entryDate: today });
    await seedEntry(user.id, { body: 'b', entryDate: today });
    fake.failures = [httpError(503), httpError(503), httpError(503)];
    const outage = await api.get('/api/insights/weekly').set(user.headers);
    expect(outage.status).toBe(503);
    expect(outage.body.code).toBe('ai_unavailable');

    await pause('batch');
    const spent = (await usageRow(user.id))?.calls ?? 0;
    const sent = fake.calls('weekly').length;
    const paused = await api.get('/api/insights/weekly').set(user.headers);
    expect(paused.status).toBe(429);
    expect(paused.body.code).toBe('ai_quota_exceeded');
    expect((await usageRow(user.id))?.calls ?? 0).toBe(spent);
    expect(fake.calls('weekly')).toHaveLength(sent);
  });
});

describe('interactive AI options', () => {
  const fakeRes = () =>
    Object.assign(new EventEmitter(), { writableEnded: false }) as unknown as Response;

  it('cancels the AI call when the client goes away before the answer is sent', () => {
    const res = fakeRes();
    const ai = interactiveAi({ geminiKey: 'k' } as Request, res);
    expect(ai).toMatchObject({ apiKey: 'k', maxInlineWaitMs: INTERACTIVE_INLINE_WAIT_MS });
    expect(ai.signal!.aborted).toBe(false);
    res.emit('close');
    expect(ai.signal!.aborted).toBe(true);
  });

  it('does not abort when the response finished normally', () => {
    const res = fakeRes();
    const ai = interactiveAi({} as Request, res);
    (res as unknown as { writableEnded: boolean }).writableEnded = true;
    res.emit('close');
    expect(ai.signal!.aborted).toBe(false);
  });
});
