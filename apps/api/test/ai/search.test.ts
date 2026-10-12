import { addDays, searchResult } from '@solace/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { aiUsage } from '../../src/db/schema';
import { RECENCY_WEIGHT, rrf, withRecency } from '../../src/services/search';
import { resetDb, testApi, type TestUser } from '../helpers';
import { installFakeAi, type FakeAi } from './fake-ai';
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

const today = new Date().toISOString().slice(0, 10);

async function search(user: TestUser, params: Record<string, string>) {
  const res = await api.get('/api/search').query(params).set(user.headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return searchResult.parse(res.body);
}

describe('ranking math', () => {
  it('fuses ranks with RRF', () => {
    const s = rrf([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(s.get('b')).toBeCloseTo(1 / 62 + 1 / 61);
    expect([...s].sort((x, y) => y[1] - x[1])[0]![0]).toBe('b');
  });

  it('adds at most a 5% recency nudge that halves every 180 days', () => {
    expect(withRecency(1, today, today)).toBeCloseTo(1 + RECENCY_WEIGHT);
    expect(withRecency(1, addDays(today, -180), today)).toBeCloseTo(1 + RECENCY_WEIGHT / 2);
    expect(withRecency(1, addDays(today, -3650), today)).toBeLessThan(1.0001);
  });
});

describe('GET /search (hybrid)', () => {
  it('ranks a relevant old entry above an irrelevant recent one, and drops unrelated entries', async () => {
    const user = await seedUser();
    const old = await seedEnriched(user.id, {
      title: 'Mountain trail',
      body: 'We went hiking up the mountain trail with my brother. The summit view was worth every step.',
      entryDate: addDays(today, -400),
    });
    await seedEnriched(user.id, {
      title: 'Errands',
      body: 'Groceries, laundry and paying bills. Nothing special about it.',
      entryDate: today,
    });
    fake.reset();

    const r = await search(user, { q: 'hiking mountain summit' });
    expect(r.mode).toBe('hybrid');
    expect(r.hits.map((h) => h.entry.id)).toEqual([old.id]);
    expect(r.hits[0]!.matchedBy).toEqual(['meaning', 'keyword']);
    expect(r.hits[0]!.snippet).toMatch(/mountain/i);
    expect(fake.embedCalls).toHaveLength(1);
    expect(fake.embedCalls[0]!.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('finds entries by meaning when the keyword side has no match', async () => {
    const user = await seedUser();
    const e = await seedEnriched(user.id, { body: 'Laps at the pool before work.' });
    // websearch syntax ANDs terms, so "marathon" rules out a keyword match.
    const r = await search(user, { q: 'pool laps marathon' });
    expect(r.hits.map((h) => h.entry.id)).toEqual([e.id]);
    expect(r.hits[0]!.matchedBy).toEqual(['meaning']);
  });

  it('returns nothing for an unrelated query instead of noise', async () => {
    const user = await seedUser();
    await seedEnriched(user.id, { body: 'Coffee with Sam downtown, we talked about his new job.' });
    await seedEnriched(user.id, { body: 'Long run in the rain, legs heavy but happy.' });
    const r = await search(user, { q: 'quantum spreadsheet invoices' });
    expect(r.hits).toEqual([]);
  });

  it('applies mood, tag and date filters in SQL', async () => {
    const user = await seedUser();
    const a = await seedEnriched(user.id, {
      body: 'Garden work: planting tomatoes in the garden.',
      mood: 'calm',
      tags: ['garden'],
      entryDate: '2026-01-10',
    });
    const b = await seedEnriched(user.id, {
      body: 'Garden again, the tomatoes are sprouting in the garden.',
      mood: 'joyful',
      tags: ['plants'],
      entryDate: '2026-03-10',
    });
    const ids = async (p: Record<string, string>) =>
      (await search(user, { q: 'garden tomatoes', ...p })).hits.map((h) => h.entry.id);
    expect((await ids({})).sort()).toEqual([a.id, b.id].sort());
    expect(await ids({ mood: 'joyful' })).toEqual([b.id]);
    expect(await ids({ tag: 'Garden' })).toEqual([a.id]);
    expect(await ids({ from: '2026-02-01' })).toEqual([b.id]);
    expect(await ids({ to: '2026-02-01' })).toEqual([a.id]);
  });

  it("never returns another user's entries", async () => {
    const user = await seedUser();
    const other = await seedUser();
    await seedEnriched(other.id, {
      body: 'Secret diary about the lighthouse keeper and the lighthouse.',
    });
    expect((await search(user, { q: 'lighthouse keeper' })).hits).toEqual([]);
    expect((await search(user, { q: 'lighthouse', mode: 'keyword' })).hits).toEqual([]);
  });

  it('consumes one AI call of quota; keyword mode consumes none', async () => {
    const user = await seedUser();
    await search(user, { q: 'anything', mode: 'keyword' });
    expect(await db.select().from(aiUsage).where(eq(aiUsage.userId, user.id))).toEqual([]);
    await search(user, { q: 'anything' });
    const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.userId, user.id));
    expect(usage!.calls).toBe(1);
  });

  it('falls back to exact-word results when no AI key is available', async () => {
    const user = await seedUser();
    await seedEnriched(user.id, { title: 'Harbour', body: 'Watched the ferries at the harbour.' });
    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
    const res = await api.get('/api/search').query({ q: 'ferries' }).set(user.headers).expect(200);
    expect(res.body.mode).toBe('keyword');
    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0].matchedBy).toEqual(['keyword']);
  });
});

describe('GET /search (keyword)', () => {
  it('matches exact words with web-search syntax and a plain-text headline', async () => {
    const user = await seedUser();
    const e = await seedEnriched(user.id, {
      title: 'Bakery',
      body: 'Bought sourdough bread at the corner bakery. The baker remembered my name.',
    });
    await seedEnriched(user.id, { body: 'Made bread at home, it was dense.' });
    fake.reset();
    const r = await search(user, { q: '"corner bakery" -dense', mode: 'keyword' });
    expect(r.mode).toBe('keyword');
    expect(r.hits.map((h) => h.entry.id)).toEqual([e.id]);
    expect(r.hits[0]!.matchedBy).toEqual(['keyword']);
    expect(r.hits[0]!.snippet).toContain('corner bakery');
    expect(r.hits[0]!.snippet).not.toMatch(/<\/?b>/);
    expect(r.hits[0]!.entry).toMatchObject({ title: 'Bakery', attachmentCount: 0 });
    expect(fake.embedCalls).toHaveLength(0);
  });

  it('validates the query', async () => {
    const user = await seedUser();
    const res = await api.get('/api/search').query({ q: '   ' }).set(user.headers);
    expect(res.status).toBe(400);
  });
});
