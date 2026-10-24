import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { unwrapped as unwrappedSchema, type Unwrapped } from '@solace/shared';
import { db } from '../../src/db/client';
import { entries, graphNodeSources, graphNodes, profiles } from '../../src/db/schema';
import { derivePersona, PERSONAS, type PersonaStats } from '../../src/services/persona';
import { seedUser } from '../ai/seed';
import { resetDb, testApi } from '../helpers';

const api = testApi();
beforeEach(resetDb);

type E = { date: string; at?: string; mood?: string | null; words?: number; tags?: string[] };
async function add(userId: string, e: E) {
  const [r] = await db
    .insert(entries)
    .values({
      id: randomUUID(),
      userId,
      entryDate: e.date,
      createdAt: new Date(e.at ?? `${e.date}T12:00:00Z`),
      mood: e.mood ?? null,
      body: 'private text',
      wordCount: e.words ?? 10,
      tags: e.tags ?? [],
    })
    .returning();
  return r!;
}
const get = (user: { headers: Record<string, string> }, qs: string) =>
  api.get(`/api/unwrapped?${qs}`).set(user.headers);
const parse = (body: unknown) => unwrappedSchema.parse(body);
const slide = <K extends string>(u: Unwrapped, kind: K) =>
  u.slides.find((s) => s.kind === kind) as
    | Extract<Unwrapped['slides'][number], { kind: K }>
    | undefined;

describe('unwrapped', () => {
  it('computes a month from seeded data', async () => {
    const u = await seedUser();
    await add(u.id, { date: '2026-10-01', mood: 'joyful', words: 100, tags: ['work', 'run'] });
    await add(u.id, { date: '2026-10-02', mood: 'sad', words: 300, tags: ['work'] });
    await add(u.id, { date: '2026-10-03', mood: 'joyful', words: 50 });
    await add(u.id, { date: '2026-10-03', mood: 'calm', words: 50 });
    await add(u.id, { date: '2026-10-10', words: 20 });
    await add(u.id, { date: '2026-09-30', mood: 'joyful', words: 999 });
    const res = await get(u, 'period=month&at=2026-10&tz=UTC');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = parse(res.body);
    expect(out.label).toBe('October 2026');
    expect([out.from, out.to]).toEqual(['2026-10-01', '2026-10-31']);
    expect(slide(out, 'totals')).toEqual({ kind: 'totals', entries: 5, words: 520, days: 4 });
    expect(slide(out, 'moods')).toEqual({
      kind: 'moods',
      counts: { joyful: 2, sad: 1, calm: 1 },
      top: 'joyful',
    });
    expect(slide(out, 'tags')!.top).toEqual([
      { tag: 'work', count: 2 },
      { tag: 'run', count: 1 },
    ]);
    expect(slide(out, 'streak')).toMatchObject({ longest: 3 });
    const rhythm = slide(out, 'rhythm')!;
    expect(rhythm.byHour[12]).toBe(5);
    expect(rhythm.peakHour).toBe(12);
    expect(rhythm.byWeekday.reduce((a, b) => a + b, 0)).toBe(5);
    expect(rhythm.byWeekday[3]).toBe(1); // 2026-10-01 is a Thursday
    const b = slide(out, 'bookends')!;
    expect(b.first!.entryDate).toBe('2026-10-01');
    expect(b.last!.entryDate).toBe('2026-10-10');
    expect(slide(out, 'highlight')!.entry.mood).toBe('sad'); // ties joyful at 2; longer wins
    expect(out.persona).not.toBeNull();
    expect(JSON.stringify(out.persona)).not.toContain('private text');
  });

  it('computes a year and its label', async () => {
    const u = await seedUser();
    await add(u.id, { date: '2026-01-05' });
    await add(u.id, { date: '2026-12-31' });
    await add(u.id, { date: '2025-12-31' });
    const out = parse((await get(u, 'period=year&at=2026&tz=UTC')).body);
    expect(out.label).toBe('2026');
    expect([out.from, out.to]).toEqual(['2026-01-01', '2026-12-31']);
    expect(slide(out, 'totals')!.entries).toBe(2);
    expect(out.persona).toBeNull();
    expect(out.minEntries).toBe(5);
  });

  it('empty period still returns slides without a highlight', async () => {
    const u = await seedUser();
    const out = parse((await get(u, 'period=month&at=2020-02&tz=UTC')).body);
    expect(out.to).toBe('2020-02-29');
    expect(slide(out, 'totals')!.entries).toBe(0);
    expect(slide(out, 'highlight')).toBeUndefined();
    expect(slide(out, 'rhythm')!.peakHour).toBeNull();
    expect(out.persona).toBeNull();
  });

  it('rejects invalid at / tz and requires auth', async () => {
    const u = await seedUser();
    expect((await get(u, 'period=month&at=2026')).status).toBe(400);
    expect((await get(u, 'period=year&at=2026-10')).status).toBe(400);
    expect((await get(u, 'period=month&at=2026-13')).status).toBe(400);
    expect((await get(u, 'period=month&at=2026-10&tz=Nope/Zone')).status).toBe(400);
    expect((await api.get('/api/unwrapped?period=month&at=2026-10')).status).toBe(401);
  });

  it('buckets the hour in the user timezone (23:30 local vs UTC)', async () => {
    const u = await seedUser();
    // 23:30 on Oct 5 in New York (UTC-4) is 03:30Z on Oct 6.
    await add(u.id, { date: '2026-10-05', at: '2026-10-06T03:30:00Z' });
    const ny = parse((await get(u, 'period=month&at=2026-10&tz=America/New_York')).body);
    expect(slide(ny, 'rhythm')!.peakHour).toBe(23);
    const utc = parse((await get(u, 'period=month&at=2026-10&tz=UTC')).body);
    expect(slide(utc, 'rhythm')!.peakHour).toBe(3);
    // Membership follows the stored local entry_date, not the UTC timestamp.
    await add(u.id, { date: '2026-09-30', at: '2026-10-01T02:00:00Z' });
    const oct = parse((await get(u, 'period=month&at=2026-10&tz=America/New_York')).body);
    expect(slide(oct, 'totals')!.entries).toBe(1);
  });

  it('persona appears at exactly minEntries', async () => {
    const u = await seedUser();
    for (let d = 1; d <= 4; d++) await add(u.id, { date: `2026-10-0${d}` });
    expect(parse((await get(u, 'period=month&at=2026-10&tz=UTC')).body).persona).toBeNull();
    await add(u.id, { date: '2026-10-05' });
    const p = parse((await get(u, 'period=month&at=2026-10&tz=UTC')).body).persona!;
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.traits.length).toBeGreaterThanOrEqual(2);
    expect(p.traits.length).toBeLessThanOrEqual(4);
  });

  it('people slide: top people in period; omitted for teens', async () => {
    const u = await seedUser();
    const e1 = await add(u.id, { date: '2026-10-01' });
    const e2 = await add(u.id, { date: '2026-10-02' });
    const old = await add(u.id, { date: '2026-08-02' });
    const node = async (name: string, ids: string[], kind: 'person' | 'place' = 'person') => {
      const [n] = await db
        .insert(graphNodes)
        .values({ userId: u.id, name, key: name.toLowerCase(), kind })
        .returning();
      await db.insert(graphNodeSources).values(ids.map((entryId) => ({ nodeId: n!.id, entryId })));
    };
    await node('Maya', [e1.id, e2.id]);
    await node('Ben', [e1.id, old.id]);
    await node('Oldie', [old.id]);
    await node('Paris', [e1.id], 'place');
    const out = parse((await get(u, 'period=month&at=2026-10&tz=UTC')).body);
    expect(slide(out, 'people')!.top).toEqual([
      { name: 'Maya', count: 2 },
      { name: 'Ben', count: 1 },
    ]);
    await db.update(profiles).set({ mode: 'teen' }).where(eq(profiles.id, u.id));
    const teen = parse((await get(u, 'period=month&at=2026-10&tz=UTC')).body);
    expect(slide(teen, 'people')).toBeUndefined();
    expect(JSON.stringify(teen)).not.toContain('Maya');
  });

  it('isolates users', async () => {
    const u = await seedUser();
    const other = await seedUser();
    await add(other.id, { date: '2026-10-01', mood: 'joyful', tags: ['x'] });
    const out = parse((await get(u, 'period=month&at=2026-10&tz=UTC')).body);
    expect(slide(out, 'totals')!.entries).toBe(0);
    expect(slide(out, 'tags')!.top).toEqual([]);
  });
});

describe('persona rules', () => {
  const hours = (h: number[]) => {
    const a = Array<number>(24).fill(0);
    for (const x of h) a[x]! += 1;
    return a;
  };
  const base: PersonaStats = {
    entries: 10,
    activeDays: 10,
    elapsedDays: 30,
    avgWords: 120,
    byHour: hours(Array<number>(10).fill(14)),
    byWeekday: [2, 2, 2, 2, 1, 1, 0],
    moodScores: [],
    distinctMoods: 0,
    distinctTags: 2,
  };
  const key = (o: Partial<PersonaStats>) => derivePersona({ ...base, ...o }).key;

  it('picks each persona from aggregates', () => {
    expect(key({})).toBe('everyday_noticer');
    expect(key({ byHour: hours(Array<number>(10).fill(23)) })).toBe('night_owl');
    expect(key({ byHour: hours(Array<number>(10).fill(6)) })).toBe('early_riser');
    expect(key({ avgWords: 400 })).toBe('deep_diver');
    expect(key({ activeDays: 28 })).toBe('daily_ritualist');
    expect(key({ moodScores: [2, -2, 1, -1, 2, -2], distinctMoods: 6 })).toBe('wide_ranging');
    expect(key({ moodScores: [1, 1, 1, 1], distinctMoods: 2 })).toBe('steady_water');
    expect(key({ distinctTags: 12 })).toBe('curious_collector');
    expect(key({ avgWords: 20 })).toBe('quick_noter');
    expect(key({ byWeekday: [0, 0, 1, 0, 1, 4, 4] })).toBe('weekend_wanderer');
  });

  it('has at least 8 distinct personas and always 2-4 traits', () => {
    expect(new Set(PERSONAS.map((p) => p.key)).size).toBeGreaterThanOrEqual(8);
    const p = derivePersona(base);
    expect(p.traits.length).toBeGreaterThanOrEqual(2);
    expect(p.traits.length).toBeLessThanOrEqual(4);
  });
});
