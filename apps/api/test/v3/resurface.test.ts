import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import { entries, memories, memorySources, profiles } from '../../src/db/schema';
import { getResurface } from '../../src/services/resurface';
import { seedUser } from '../ai/seed';
import { resetDb, testApi } from '../helpers';

const api = testApi();
beforeEach(resetDb);

async function entry(userId: string, entryDate: string, mood: string | null = null) {
  const [r] = await db
    .insert(entries)
    .values({ id: randomUUID(), userId, entryDate, mood, body: 'text', wordCount: 1 })
    .returning();
  return r!;
}
const noon = (d: string) => new Date(`${d}T12:00:00Z`);

describe('resurface', () => {
  it('empty state is an empty list', async () => {
    const u = await seedUser();
    const res = await api.get('/api/resurface').set(u.headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('on this day across years with plain reasons', async () => {
    const u = await seedUser();
    await entry(u.id, '2025-10-24');
    const r1 = await getResurface(u.id, 'UTC', noon('2026-10-24'));
    expect(r1.items).toHaveLength(1);
    expect(r1.items[0]!.kind).toBe('on_this_day');
    expect(r1.items[0]!.reason).toBe('One year ago today');
    await entry(u.id, '2023-10-24');
    const r2 = await getResurface(u.id, 'UTC', noon('2026-10-24'));
    expect(r2.items[0]!.reason).toMatch(/^(One year|3 years) ago today$/);
    await entry(u.id, '2026-10-24');
    await entry(u.id, '2025-10-25');
    const r3 = await getResurface(u.id, 'UTC', noon('2026-10-24'));
    expect(r3.items.every((i) => i.entry.entryDate !== '2026-10-24')).toBe(true);
    expect(r3.items.every((i) => i.entry.entryDate !== '2025-10-25')).toBe(true);
  });

  it('leap day only matches earlier leap days', async () => {
    const u = await seedUser();
    await entry(u.id, '2024-02-29');
    const day = (d: string) =>
      getResurface(u.id, 'UTC', noon(d)).then((r) => r.items.filter((i) => i.kind === 'on_this_day'));
    expect((await day('2028-02-29'))[0]?.reason).toBe('4 years ago today');
    expect(await day('2027-02-28')).toEqual([]);
    expect(await day('2027-03-01')).toEqual([]);
  });

  it('uses the user timezone for today', async () => {
    const u = await seedUser();
    await entry(u.id, '2025-10-24');
    // 2026-10-24T02:00Z is still Oct 23 in New York.
    const at = new Date('2026-10-24T02:00:00Z');
    expect((await getResurface(u.id, 'UTC', at)).items).toHaveLength(1);
    expect((await getResurface(u.id, 'America/New_York', at)).items).toHaveLength(0);
    expect((await api.get('/api/resurface?tz=Mars/Base').set(u.headers)).status).toBe(400);
  });

  it('echo picks an old strong-mood entry, not recent or mild ones', async () => {
    const u = await seedUser();
    const old = await entry(u.id, '2026-03-10', 'joyful');
    await entry(u.id, '2026-09-20', 'sad');
    await entry(u.id, '2026-03-11', 'calm');
    const r = await getResurface(u.id, 'UTC', noon('2026-10-24'));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.kind).toBe('echo');
    expect(r.items[0]!.entry.id).toBe(old.id);
    expect(r.items[0]!.reason).toBe('A strong day from March');
    const v = await seedUser();
    await entry(v.id, '2026-03-10', 'joyful');
    const later = await getResurface(v.id, 'UTC', noon('2027-10-24'));
    expect(later.items[0]!.reason).toBe('A strong day from March 2026');
  });

  it('echo does not repeat the on-this-day entry', async () => {
    const u = await seedUser();
    await entry(u.id, '2025-10-24', 'joyful');
    const r = await getResurface(u.id, 'UTC', noon('2026-10-24'));
    expect(r.items.map((i) => i.kind)).toEqual(['on_this_day']);
  });

  it('unfinished: quiet goal memory, ignores recent, archived and other kinds', async () => {
    const u = await seedUser();
    const e = await entry(u.id, '2026-08-01');
    const now = noon('2026-10-24');
    const mk = async (
      kind: 'goal' | 'habit' | 'fact',
      status: 'active' | 'archived',
      daysAgo: number,
      content: string,
    ) => {
      const [m] = await db
        .insert(memories)
        .values({
          userId: u.id,
          kind,
          status,
          content,
          lastSeen: new Date(now.getTime() - daysAgo * 86_400_000),
        })
        .returning();
      await db.insert(memorySources).values({ memoryId: m!.id, entryId: e.id });
    };
    await mk('goal', 'active', 5, 'recent goal');
    await mk('goal', 'archived', 40, 'archived goal');
    await mk('fact', 'active', 40, 'a fact');
    expect((await getResurface(u.id, 'UTC', now)).items).toEqual([]);
    await mk('habit', 'active', 14, 'run every morning');
    const r = await getResurface(u.id, 'UTC', now);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.kind).toBe('unfinished');
    expect(r.items[0]!.entry.id).toBe(e.id);
    expect(r.items[0]!.reason).toContain('run every morning');
  });

  it('is deterministic per day, at most 3, and varies across days', async () => {
    const u = await seedUser();
    for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) await entry(u.id, `${y}-10-24`, 'joyful');
    for (let i = 0; i < 6; i++) await entry(u.id, `2026-0${i + 1}-05`, 'sad');
    const a = await getResurface(u.id, 'UTC', noon('2026-10-24'));
    const b = await getResurface(u.id, 'UTC', new Date('2026-10-24T20:00:00Z'));
    expect(b).toEqual(a);
    expect(a.items.length).toBeLessThanOrEqual(3);
    const picks = new Set<string>();
    for (let d = 1; d <= 20; d++) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      for (const i of (await getResurface(u.id, 'UTC', noon(day))).items) picks.add(i.entry.id);
    }
    expect(picks.size).toBeGreaterThan(2);
  });

  it('isolates users', async () => {
    const u = await seedUser();
    const other = await seedUser();
    await entry(other.id, '2025-10-24', 'joyful');
    expect((await getResurface(u.id, 'UTC', noon('2026-10-24'))).items).toEqual([]);
  });

  it('teen accounts get the same behaviour', async () => {
    const u = await seedUser();
    await db.update(profiles).set({ mode: 'teen' }).where(eq(profiles.id, u.id));
    await entry(u.id, '2025-10-24');
    expect((await getResurface(u.id, 'UTC', noon('2026-10-24'))).items).toHaveLength(1);
  });

  it('requires auth', async () => {
    expect((await api.get('/api/resurface')).status).toBe(401);
  });
});
