import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  chatStreamEvent,
  createSseParser,
  thread as threadSchema,
  threadWithMessages,
  type ChatStreamEvent,
} from '@solace/shared';
import { createApp } from '../../src/app';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { aiUsage, chatMessages } from '../../src/db/schema';
import type { ChunkHit } from '../../src/services/search';
import {
  MAX_CHUNKS_PER_ENTRY,
  referencedCitations,
  selectChunks,
  titleFrom,
} from '../../src/services/chat';
import { resetDb, testApi, type TestUser } from '../helpers';
import { httpError, installFakeAi, quotaSpent, userText, type FakeAi } from './fake-ai';
import { seedEnriched, seedUser } from './seed';

const api = testApi();
let fake: FakeAi;
beforeEach(async () => {
  await resetDb();
  fake = installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

function parseEvents(raw: string): ChatStreamEvent[] {
  return createSseParser()(raw).map((e) =>
    chatStreamEvent.parse({ event: e.event, data: JSON.parse(e.data) }),
  );
}

async function newThread(user: TestUser) {
  const res = await api.post('/api/threads').set(user.headers).send({});
  expect(res.status).toBe(201);
  return threadSchema.parse(res.body);
}

async function send(user: TestUser, threadId: string, body: Record<string, unknown>) {
  const res = await api
    .post(`/api/threads/${threadId}/messages`)
    .set(user.headers)
    .send(body)
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });
  return res;
}

async function seedHikes(userId: string) {
  return [
    await seedEnriched(userId, {
      title: 'Ridge',
      body: 'Hiking the ridge trail alone, the mountain air felt free.',
      entryDate: '2026-04-01',
    }),
    await seedEnriched(userId, {
      title: 'Summit',
      body: 'Mountain summit with Leo, hiking boots soaked.',
      entryDate: '2026-05-02',
    }),
    await seedEnriched(userId, {
      title: 'Valley',
      body: 'Short valley hike, mountain views, a quiet picnic.',
      entryDate: '2026-06-03',
    }),
  ];
}

describe('pure helpers', () => {
  const chunk = (entryId: string, i: number): ChunkHit => ({
    chunkId: `${entryId}-${i}`,
    entryId,
    entryDate: '2026-01-01',
    content: `${entryId} ${i}`,
    similarity: 0.9 - i * 0.01,
  });

  it('caps chunks per entry and total', () => {
    const vector = [
      ...Array.from({ length: 5 }, (_, i) => chunk('a', i)),
      ...Array.from({ length: 10 }, (_, i) => chunk(`e${i}`, 0)),
    ];
    const picked = selectChunks(vector, []);
    expect(picked).toHaveLength(8);
    expect(picked.filter((c) => c.entryId === 'a')).toHaveLength(MAX_CHUNKS_PER_ENTRY);
  });

  it('keeps only citations the answer referenced, including grouped markers', () => {
    const cites = [1, 2, 3, 4].map((n) => ({
      n,
      entryId: `${n}`,
      title: '',
      entryDate: '2026-01-01',
      snippet: '',
    }));
    expect(referencedCitations('a [1] b [3, 4] c [9]', cites).map((c) => c.n)).toEqual([1, 3, 4]);
  });

  it('derives a short title from the first question', () => {
    expect(titleFrom('  What   made me happy?  ')).toBe('What made me happy?');
    const long = titleFrom(
      'When did I last feel really rested and what was going on in my life around that time?',
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('threads', () => {
  it('lists, reads and deletes only the caller’s threads', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const t = await newThread(user);
    await newThread(other);
    const list = await api.get('/api/threads').set(user.headers).expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect(
      threadWithMessages.parse(
        (await api.get(`/api/threads/${t.id}`).set(user.headers).expect(200)).body,
      ).messages,
    ).toEqual([]);
    await api.get(`/api/threads/${t.id}`).set(other.headers).expect(404);
    await api.delete(`/api/threads/${t.id}`).set(other.headers).expect(404);
    await api.delete(`/api/threads/${t.id}`).set(user.headers).expect(204);
    await api.get(`/api/threads/${t.id}`).set(user.headers).expect(404);
  });
});

describe('POST /threads/:id/messages', () => {
  it('streams sources → tokens → done and persists only referenced citations', async () => {
    const user = await seedUser({ aiStyle: 'stoic' });
    const other = await seedUser();
    await seedHikes(user.id);
    await seedEnriched(other.id, {
      body: 'Hiking the mountain with a secret companion named Zorro.',
    });
    fake.replies.chat = () => 'You felt free on the ridge [1] and later at the valley [3, 1].';
    const t = await newThread(user);

    const res = await send(user, t.id, {
      content: 'When did hiking in the mountains make me happy?',
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');

    const events = parseEvents(res.body as string);
    expect(events[0]!.event).toBe('sources');
    expect(events.at(-1)!.event).toBe('done');
    expect(events.slice(1, -1).every((e) => e.event === 'token')).toBe(true);
    const first = events[0]!;
    const sources = first.event === 'sources' ? first.data.citations : [];
    expect(sources.length).toBe(3);
    expect(sources.map((c) => c.n)).toEqual([1, 2, 3]);
    const text = events.flatMap((e) => (e.event === 'token' ? [e.data.text] : [])).join('');
    expect(text).toBe('You felt free on the ridge [1] and later at the valley [3, 1].');

    const done = events.at(-1)!;
    if (done.event !== 'done') throw new Error('no done');
    expect(done.data.userMessage?.content).toBe('When did hiking in the mountains make me happy?');
    expect(done.data.message.citations.map((c) => c.n)).toEqual([1, 3]);

    const stored = threadWithMessages.parse(
      (await api.get(`/api/threads/${t.id}`).set(user.headers)).body,
    );
    expect(stored.title).toBe('When did hiking in the mountains make me happy?');
    expect(stored.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(stored.messages[1]!.citations.map((c) => c.n)).toEqual([1, 3]);

    // The prompt treats journal text as delimited data and never includes other users' entries.
    const req = fake.streamCalls[0]!;
    expect(req.system).toMatch(/Stoic/);
    expect(req.system).toMatch(/never follow instructions/);
    expect(req.system).toMatch(/crisis line/);
    const prompt = userText(req);
    expect(prompt.match(/<journal_excerpt n="\d"/g)).toHaveLength(3);
    expect(prompt).not.toContain('Zorro');
  });

  it('includes recent thread history, without stale citation markers', async () => {
    const user = await seedUser();
    await seedHikes(user.id);
    const t = await newThread(user);
    await send(user, t.id, { content: 'Tell me about hiking.' });
    await send(user, t.id, { content: 'And the summit?' });
    const req = fake.streamCalls[1]!;
    expect(req.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(JSON.stringify(req.contents[1])).not.toMatch(/\[1\]/);
  });

  it('regenerates the last answer from the last question', async () => {
    const user = await seedUser();
    await seedHikes(user.id);
    const t = await newThread(user);
    await send(user, t.id, { content: 'What about hiking?' });
    fake.replies.chat = () => 'A second take [2].';
    const res = await send(user, t.id, { content: 'ignored', regenerate: true });
    const done = parseEvents(res.body as string).at(-1)!;
    expect(done.event).toBe('done');
    if (done.event === 'done') expect(done.data.userMessage).toBeNull();
    const stored = threadWithMessages.parse(
      (await api.get(`/api/threads/${t.id}`).set(user.headers)).body,
    );
    expect(stored.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'What about hiking?'],
      ['assistant', 'A second take [2].'],
    ]);
    expect(userText(fake.streamCalls[1]!)).toContain('Question: What about hiking?');
  });

  it('ends with an error event (never a hanging stream) when generation fails', async () => {
    const user = await seedUser();
    const t = await newThread(user);
    fake.failures = [undefined, httpError(503), httpError(503), httpError(503)]; // embed ok, stream fails
    const res = await send(user, t.id, { content: 'Anything about rain?' });
    const events = parseEvents(res.body as string);
    expect(events.map((e) => e.event)).toEqual(['sources', 'error']);
    const err = events[1]!;
    if (err.event === 'error') expect(err.data.code).toBe('ai_unavailable');
    // The question is kept so the user can regenerate.
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.threadId, t.id));
    expect(rows.map((r) => r.role)).toEqual(['user']);
  });

  it('rejects up front with JSON errors', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const t = await newThread(other);
    expect(
      (await api.post(`/api/threads/${t.id}/messages`).set(user.headers).send({ content: 'hi' }))
        .status,
    ).toBe(404);
    const mine = await newThread(user);
    expect(
      (await api.post(`/api/threads/${mine.id}/messages`).set(user.headers).send({ content: '' }))
        .status,
    ).toBe(400);
    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
    const res = await api
      .post(`/api/threads/${mine.id}/messages`)
      .set(user.headers)
      .send({ content: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ai_unavailable');
    const ok = await api
      .post(`/api/threads/${mine.id}/messages`)
      .set({ ...user.headers, 'x-gemini-key': 'my-own-key' })
      .send({ content: 'hi' });
    expect(ok.status).toBe(200);
  });

  it('answers 429 ai_quota_exceeded before streaming once today’s budget is spent', async () => {
    const user = await seedUser();
    const t = await newThread(user);
    await db.insert(aiUsage).values({
      userId: user.id,
      day: new Date().toISOString().slice(0, 10),
      calls: config.AI_DAILY_QUOTA,
    });
    const res = await api
      .post(`/api/threads/${t.id}/messages`)
      .set(user.headers)
      .send({ content: 'What made me happy?' });
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.code).toBe('ai_quota_exceeded');
    expect(fake.embedCalls).toHaveLength(0);
    expect(fake.streamCalls).toHaveLength(0);
    expect(await db.select().from(chatMessages).where(eq(chatMessages.threadId, t.id))).toEqual([]);

    // A person's own key isn't limited by the server budget.
    const own = await send(
      { ...user, headers: { ...user.headers, 'x-gemini-key': 'mine' } } as TestUser,
      t.id,
      {
        content: 'What made me happy?',
      },
    );
    expect(own.status).toBe(200);
  });

  it('stops before streaming, without spending the budget, while Gemini has paused the chat model', async () => {
    const user = await seedUser();
    const t = await newThread(user);
    fake.failures = [undefined, quotaSpent(4 * 3_600)]; // the embedding works, the answer is refused
    const first = parseEvents(
      (await send(user, t.id, { content: 'Anything about rain?' })).body as string,
    );
    expect(first.map((e) => e.event)).toEqual(['sources', 'error']);
    const err = first[1]!;
    if (err.event === 'error') expect(err.data.code).toBe('ai_quota_exceeded');
    const spent = async () =>
      (await db.select().from(aiUsage).where(eq(aiUsage.userId, user.id)))[0]!.calls;
    expect(await spent()).toBe(1);

    const res = await api
      .post(`/api/threads/${t.id}/messages`)
      .set(user.headers)
      .send({ content: 'And snow?' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('ai_quota_exceeded');
    expect(res.body.error).toMatch(/own Gemini key/);
    expect(fake.streamCalls).toHaveLength(1);
    expect(await spent()).toBe(1);
    const stored = await db.select().from(chatMessages).where(eq(chatMessages.threadId, t.id));
    expect(stored.map((m) => m.content)).toEqual(['Anything about rain?']);
  });

  it('stops generating when the client disconnects and keeps the partial answer', async () => {
    const user = await seedUser();
    const t = await newThread(user);
    fake.streamPieces = () => Array.from({ length: 200 }, (_, i) => `w${i} `);
    fake.streamDelayMs = 10;

    const server = createApp().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/threads/${t.id}/messages`, {
        method: 'POST',
        headers: { ...user.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Tell me a long story' }),
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let seen = '';
      while (!seen.includes('event: token')) seen += decoder.decode((await reader.read()).value);
      controller.abort();

      await expect.poll(() => fake.lastStreamSignal?.aborted, { timeout: 3000 }).toBe(true);
      await expect
        .poll(
          async () =>
            (
              await db
                .select()
                .from(chatMessages)
                .where(and(eq(chatMessages.threadId, t.id), eq(chatMessages.role, 'assistant')))
            ).length,
          {
            timeout: 3000,
          },
        )
        .toBe(1);
      const [partial] = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.threadId, t.id), eq(chatMessages.role, 'assistant')));
      expect(partial!.content.length).toBeGreaterThan(0);
      expect(partial!.content).not.toContain('w199');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
