import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import { intentionCheckins, intentions } from '../../src/db/schema';
import { computeXp, stageFor, STAGE_THRESHOLDS } from '../../src/services/companion';
import { resetDb, testApi } from '../helpers';
import { seedEntry, seedUser } from '../ai/seed';

const api = testApi();
beforeEach(resetDb);
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
type Body = {
  companion: { stage: number; xp: number; nextStageAt: number | null; mood: string; lastWroteAt: string | null };
  milestones: { key: string; title: string; achievedAt: string | null }[];
};
const get = async (u: { headers: { Authorization: string } }): Promise<Body> =>
  (await api.get('/api/companion').set(u.headers).expect(200)).body;
const ms = (b: Body, key: string) => b.milestones.find((m) => m.key === key)!.achievedAt;

describe('companion math', () => {
  it('xp formula and stage thresholds', () => {
    expect(computeXp(3, 120, 2)).toBe(30 + 2 + 10);
    expect(STAGE_THRESHOLDS).toHaveLength(7);
    expect(stageFor(0)).toEqual({ stage: 1, nextStageAt: 30 });
    expect(stageFor(29).stage).toBe(1);
    expect(stageFor(30).stage).toBe(2);
    expect(stageFor(99).stage).toBe(2);
    expect(stageFor(100).stage).toBe(3);
    expect(stageFor(250).stage).toBe(4);
    expect(stageFor(500).stage).toBe(5);
    expect(stageFor(1000).stage).toBe(6);
    expect(stageFor(2000)).toEqual({ stage: 7, nextStageAt: null });
    expect(stageFor(99999).stage).toBe(7);
  });
});

describe('GET /companion', () => {
  it('is a gentle empty state for a new user', async () => {
    const u = await seedUser();
    const b = await get(u);
    expect(b.companion).toEqual({
      stage: 1,
      xp: 0,
      nextStageAt: 30,
      mood: 'sleepy',
      lastWroteAt: null,
    });
    expect(b.milestones).toHaveLength(9);
    expect(b.milestones.every((m) => m.achievedAt === null && m.title)).toBe(true);
  });

  it('adds xp for entries, words and check-ins and never shrinks while writing continues', async () => {
    const u = await seedUser();
    await seedEntry(u.id, { body: words(100), updatedAt: ago(30) });
    await seedEntry(u.id, { body: words(10), updatedAt: ago(29) });
    const first = await get(u);
    expect(first.companion.xp).toBe(20 + Math.floor(110 / 50));
    const [i] = await db
      .insert(intentions)
      .values({ userId: u.id, title: 't', kind: 'habit' })
      .returning();
    await db
      .insert(intentionCheckins)
      .values({ intentionId: i!.id, userId: u.id, date: '2026-01-01' });
    const second = await get(u);
    expect(second.companion.xp).toBe(first.companion.xp + 5);
    expect(ms(second, 'first_checkin')).toBeTruthy();
    await seedEntry(u.id, { body: 'a', updatedAt: ago(10) });
    const third = await get(u);
    expect(third.companion.stage).toBeGreaterThanOrEqual(second.companion.stage);
    expect(third.companion.xp).toBeGreaterThan(second.companion.xp);
  });

  it('ignores blank drafts and other users', async () => {
    const u = await seedUser();
    const o = await seedUser();
    await seedEntry(u.id, { body: '' });
    await seedEntry(o.id, { body: words(60) });
    expect((await get(u)).companion.xp).toBe(0);
  });

  it('reaches stage 2 at 30 xp', async () => {
    const u = await seedUser();
    for (let i = 0; i < 3; i++) await seedEntry(u.id, { body: 'x', updatedAt: ago(20 + i) });
    expect((await get(u)).companion).toMatchObject({ stage: 2, xp: 30, nextStageAt: 100 });
  });

  it('mood: sleepy, content, glowing and proud', async () => {
    const u1 = await seedUser();
    await seedEntry(u1.id, { body: 'a', updatedAt: ago(40) });
    expect((await get(u1)).companion.mood).toBe('sleepy');

    const u2 = await seedUser();
    await seedEntry(u2.id, { body: 'a', updatedAt: ago(2) });
    expect((await get(u2)).companion.mood).toBe('content');

    const u3 = await seedUser();
    await seedEntry(u3.id, { body: 'a', updatedAt: ago(3) });
    expect((await get(u3)).companion.mood).toBe('sleepy');

    const u4 = await seedUser();
    for (let i = 0; i < 3; i++) await seedEntry(u4.id, { body: 'a', updatedAt: ago(60 - i) });
    await seedEntry(u4.id, { body: 'a' });
    expect((await get(u4)).companion.mood).toBe('glowing');

    const u5 = await seedUser();
    await seedEntry(u5.id, { body: 'a' });
    const b = await get(u5);
    expect(b.companion.mood).toBe('proud');
    expect(b.companion.lastWroteAt).toBeTruthy();
  });

  it('computes milestone dates from data', async () => {
    const u = await seedUser();
    const times: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const t = ago(40 - i);
      times.push(t);
      await seedEntry(u.id, {
        body: words(i === 6 ? 940 : 10),
        updatedAt: t,
        entryDate: t.toISOString().slice(0, 10),
      });
    }
    const b = await get(u);
    expect(ms(b, 'first_entry')).toBe(times[0]!.toISOString());
    expect(ms(b, 'entries_7')).toBe(times[6]!.toISOString());
    expect(ms(b, 'words_1000')).toBe(times[6]!.toISOString());
    expect(ms(b, 'entries_30')).toBeNull();
    expect(ms(b, 'entries_100')).toBeNull();
    expect(ms(b, 'words_10000')).toBeNull();
    expect(ms(b, 'first_photo')).toBeNull();
  });

  it('first full week needs 3+ entries in one Monday-week', async () => {
    const u = await seedUser();
    // 2026-03-02 is a Monday; two entries that week, then a third.
    await seedEntry(u.id, { body: 'a', entryDate: '2026-03-02', updatedAt: ago(30) });
    await seedEntry(u.id, { body: 'a', entryDate: '2026-03-08', updatedAt: ago(29) });
    await seedEntry(u.id, { body: 'a', entryDate: '2026-03-09', updatedAt: ago(28) });
    expect(ms(await get(u), 'first_full_week')).toBeNull();
    const third = ago(27);
    await seedEntry(u.id, { body: 'a', entryDate: '2026-03-04', updatedAt: third });
    expect(ms(await get(u), 'first_full_week')).toBe(third.toISOString());
  });

  it('validates tz and requires auth', async () => {
    const u = await seedUser();
    await api.get('/api/companion?tz=Nope/Nope').set(u.headers).expect(400);
    await api.get('/api/companion').expect(401);
  });
});
