import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate, todayPromptResponse } from '@solace/shared';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { memories, prompts } from '../../src/db/schema';
import {
  CURATED_PROMPTS,
  cleanQuestion,
  curatedPrompt,
  getTodayPrompt,
} from '../../src/services/prompts';
import { resetDb, testApi } from '../helpers';
import { httpError, installFakeAi, type FakeAi } from './fake-ai';
import { seedUser } from './seed';

const api = testApi();
let fake: FakeAi;
beforeEach(async () => {
  await resetDb();
  fake = installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

describe('curated prompts', () => {
  it('has a varied, unique set and a deterministic pick per user and date', () => {
    expect(CURATED_PROMPTS.length).toBeGreaterThanOrEqual(55);
    expect(new Set(CURATED_PROMPTS).size).toBe(CURATED_PROMPTS.length);
    expect(curatedPrompt('u1', '2026-01-01')).toBe(curatedPrompt('u1', '2026-01-01'));
    const spread = new Set(
      Array.from({ length: 30 }, (_, i) =>
        curatedPrompt('u1', `2026-01-${String(i + 1).padStart(2, '0')}`),
      ),
    );
    expect(spread.size).toBeGreaterThan(15);
  });

  it('accepts only a single clean question', () => {
    expect(cleanQuestion('"How is your training going?"\nextra')).toBe(
      'How is your training going?',
    );
    expect(cleanQuestion('Write about your day.')).toBeNull();
    expect(cleanQuestion('')).toBeNull();
  });
});

describe('GET /prompts/today', () => {
  it('creates one curated prompt per local date and returns the same row afterwards', async () => {
    const user = await seedUser({ timezone: 'Pacific/Auckland' });
    const a = todayPromptResponse.parse(
      (await api.get('/api/prompts/today').set(user.headers).expect(200)).body,
    );
    const b = todayPromptResponse.parse(
      (await api.get('/api/prompts/today').set(user.headers).expect(200)).body,
    );
    expect(a.prompt).toMatchObject({
      source: 'curated',
      status: 'pending',
      forDate: localDate(new Date(), 'Pacific/Auckland'),
    });
    expect(b.prompt!.id).toBe(a.prompt!.id);
    expect(fake.generateCalls).toHaveLength(0);
  });

  it('is race-safe: concurrent first requests converge on one row', async () => {
    const user = await seedUser();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => getTodayPrompt(user.id, 'UTC')),
    );
    expect(new Set(results.map((p) => p!.id)).size).toBe(1);
    expect(await db.select().from(prompts).where(eq(prompts.userId, user.id))).toHaveLength(1);
  });

  it('asks a memory-based question when reinforced memories exist', async () => {
    const user = await seedUser();
    const [m] = await db
      .insert(memories)
      .values({
        userId: user.id,
        kind: 'goal',
        content: 'You are training for a half marathon.',
        salience: 3,
      })
      .returning();
    await db
      .insert(memories)
      .values({ userId: user.id, kind: 'fact', content: 'You live in Porto.', salience: 9 });
    const res = todayPromptResponse.parse(
      (await api.get('/api/prompts/today').set(user.headers).expect(200)).body,
    );
    expect(res.prompt).toMatchObject({
      source: 'memory',
      text: 'How is your training going this week?',
    });
    const [row] = await db.select().from(prompts).where(eq(prompts.userId, user.id));
    expect(row!.memoryId).toBe(m!.id);
    expect(fake.calls('dailyPrompt')[0]!.contents[0]!.parts[0]).toMatchObject({
      text: expect.stringContaining('<memory kind="goal">'),
    });
  });

  it('falls back to a curated prompt silently when the AI fails', async () => {
    const user = await seedUser();
    await db
      .insert(memories)
      .values({ userId: user.id, kind: 'habit', content: 'You journal at night.', salience: 2 });
    fake.failures = [httpError(503), httpError(503), httpError(503)];
    const res = todayPromptResponse.parse(
      (await api.get('/api/prompts/today').set(user.headers).expect(200)).body,
    );
    expect(res.prompt!.source).toBe('curated');
  });

  it('returns null once dismissed; dismiss is scoped to the owner', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const { prompt } = todayPromptResponse.parse(
      (await api.get('/api/prompts/today').set(user.headers)).body,
    );
    await api.post(`/api/prompts/${prompt!.id}/dismiss`).set(other.headers).expect(404);
    const dismissed = await api
      .post(`/api/prompts/${prompt!.id}/dismiss`)
      .set(user.headers)
      .expect(200);
    expect(dismissed.body.status).toBe('dismissed');
    const after = todayPromptResponse.parse(
      (await api.get('/api/prompts/today').set(user.headers)).body,
    );
    expect(after.prompt).toBeNull();
  });
});
