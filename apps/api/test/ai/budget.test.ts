/**
 * The AI budget end to end: which model each task's requests go to, and the per-person
 * budget meter (GET /me/usage).
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, aiUsage as aiUsageSchema, localDate } from '@solace/shared';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { aiUsage, attachments, memories } from '../../src/db/schema';
import { handlers } from '../../src/jobs/handlers/index';
import { JOB } from '../../src/jobs/types';
import { consumeAiQuota, consumeEnrichmentBudget, nextUtcDay } from '../../src/services/quota';
import { putObject } from '../../src/storage/index';
import { resetDb, testApi } from '../helpers';
import { installFakeAi, type FakeAi } from './fake-ai';
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

type Mutable = Record<string, unknown>;
const saved = { ...(config as unknown as Mutable) };
afterEach(() => {
  Object.assign(config as unknown as Mutable, saved, { GEMINI_API_KEY: 'test-server-key' });
});

const ctx = { id: 'job', attempt: 1, signal: new AbortController().signal };

describe('per-task model routing', () => {
  it('sends every request to its task’s model', async () => {
    Object.assign(config, {
      GEMINI_CHAT_MODEL: 'default-model',
      GEMINI_MODEL_ENRICH: 'enrich-model',
      GEMINI_MODEL_CHAT: 'chat-model',
      GEMINI_MODEL_BATCH: 'batch-model',
      GEMINI_MODEL_VISION: 'vision-model',
    });
    const user = await seedUser();
    const today = localDate(new Date(), 'UTC');

    // Enrichment: one structured request, one embedding request.
    const entry = await seedEntry(user.id, {
      body: 'Long run by the harbour with Maya this morning.',
      entryDate: today,
    });
    await handlers[JOB.enrichEntry]!({ entryId: entry.id, userId: user.id, version: 1 }, ctx);
    // A photo description.
    await putObject(`${user.id}/${entry.id}/p.jpg`, Buffer.from('jpeg'), 'image/jpeg');
    const [att] = await db
      .insert(attachments)
      .values({
        entryId: entry.id,
        userId: user.id,
        storagePath: `${user.id}/${entry.id}/p.jpg`,
        mime: 'image/jpeg',
        bytes: 4,
      })
      .returning();
    await handlers[JOB.describeAttachment]!({ attachmentId: att!.id, userId: user.id }, ctx);
    // The weekly letter and a memory-based daily prompt.
    await seedEntry(user.id, { body: 'Quiet evening.', entryDate: today });
    await api.get('/api/insights/weekly').set(user.headers).expect(200);
    await db
      .insert(memories)
      .values({ userId: user.id, kind: 'goal', content: 'You are training.', salience: 3 });
    await api.get('/api/prompts/today').set(user.headers).expect(200);
    // A Reflect answer.
    const thread = (await api.post('/api/threads').set(user.headers).send({}).expect(201)).body;
    await api
      .post(`/api/threads/${thread.id}/messages`)
      .set(user.headers)
      .send({ content: 'How was the harbour?' })
      .buffer(true)
      .expect(200);

    const byModel = (calls: Array<{ model: string }>) => calls.map((c) => c.model);
    expect(byModel(fake.calls('enrich'))).toEqual(['enrich-model']);
    expect(byModel(fake.calls('photo'))).toEqual(['vision-model']);
    expect(byModel(fake.calls('weekly'))).toEqual(['batch-model']);
    expect(byModel(fake.calls('dailyPrompt'))).toEqual(['batch-model']);
    expect(byModel(fake.streamCalls)).toEqual(['chat-model']);
    expect(new Set(byModel(fake.embedCalls))).toEqual(new Set([config.GEMINI_EMBED_MODEL]));
  });
});

describe('GET /me/usage', () => {
  const usage = async (headers: Record<string, string>) =>
    aiUsageSchema.parse((await api.get('/api/me/usage').set(headers).expect(200)).body);

  it('reports today’s interactive and enrichment budgets, the tier and the reset time', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const fresh = await usage(user.headers);
    expect(fresh).toEqual({
      tier: 'free',
      ownKey: false,
      interactive: { used: 0, limit: config.AI_DAILY_QUOTA },
      enrichment: { used: 0, limit: config.ENRICH_DAILY_QUOTA },
      resetsAt: nextUtcDay().toISOString(),
    });
    expect(fresh.resetsAt).toMatch(/T00:00:00\.000Z$/);

    await consumeAiQuota(user.id, { usingOwnKey: false });
    await consumeAiQuota(user.id, { usingOwnKey: false });
    await consumeEnrichmentBudget(user.id);
    await consumeAiQuota(other.id, { usingOwnKey: false });
    // Yesterday's row never counts toward today.
    await db.insert(aiUsage).values({
      userId: user.id,
      day: addDays(new Date().toISOString().slice(0, 10), -1),
      calls: 50,
      enrichRuns: 50,
    });

    const now = await usage({ ...user.headers, 'x-gemini-key': 'my-own-key' });
    expect(now).toMatchObject({
      ownKey: true,
      interactive: { used: 2, limit: config.AI_DAILY_QUOTA },
      enrichment: { used: 1, limit: config.ENRICH_DAILY_QUOTA },
    });
  });

  it('never reads above the limit, and follows AI_TIER', async () => {
    const user = await seedUser();
    await db.insert(aiUsage).values({
      userId: user.id,
      day: new Date().toISOString().slice(0, 10),
      calls: config.AI_DAILY_QUOTA + 7, // own-key calls are counted but not capped
      enrichRuns: config.ENRICH_DAILY_QUOTA,
    });
    (config as { AI_TIER: string }).AI_TIER = 'paid';
    const u = await usage(user.headers);
    expect(u.tier).toBe('paid');
    expect(u.interactive).toEqual({ used: config.AI_DAILY_QUOTA, limit: config.AI_DAILY_QUOTA });
    expect(u.enrichment.used).toBe(config.ENRICH_DAILY_QUOTA);
    const [row] = await db.select().from(aiUsage).where(eq(aiUsage.userId, user.id));
    expect(row!.calls).toBe(config.AI_DAILY_QUOTA + 7); // reading spends nothing
  });

  it('needs a signed-in user and is never cached', async () => {
    await api.get('/api/me/usage').expect(401);
    const user = await seedUser();
    const res = await api.get('/api/me/usage').set(user.headers).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
