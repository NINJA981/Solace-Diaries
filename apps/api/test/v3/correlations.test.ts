import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, localDate } from '@solace/shared';
import { computeCorrelations } from '../../src/services/correlations';
import { resetDb, testApi } from '../helpers';
import { seedEntry, seedUser } from '../ai/seed';

const api = testApi();
beforeEach(resetDb);
const today = () => localDate(new Date(), 'UTC');

describe('correlations', () => {
  it('matches a hand-computed fixture', async () => {
    const u = await seedUser();
    const rows: [string, string[]][] = [
      ['joyful', ['run']],
      ['joyful', ['run']],
      ['calm', ['run', 'work']],
      ['tired', ['work']],
      ['tired', ['work']],
      ['sad', ['work']],
      ['calm', []],
      ['calm', []],
      ['joyful', []],
      ['calm', ['rare']],
      ['calm', ['rare']],
      ['calm', []],
      ['calm', []],
      ['calm', []],
    ];
    let i = 0;
    for (const [mood, tags] of rows)
      await seedEntry(u.id, { mood, tags, entryDate: addDays(today(), -i++) });
    await seedEntry(u.id, { mood: null, tags: ['run'] }); // unscored: excluded
    await seedEntry(u.id, { mood: 'sad', tags: ['run'], entryDate: addDays(today(), -400) }); // outside window
    // scores sum to 10 over 14 entries: baseline 0.714..
    const res = await api.get('/api/insights/correlations').set(u.headers).expect(200);
    expect(res.body.minEntries).toBe(14);
    const by = Object.fromEntries(res.body.items.map((c: { tag: string }) => [c.tag, c]));
    // run: (2+2+1)/3 = 1.6667, work: (1-1-1-2)/4 = -0.75, rare: only 2 entries, dropped
    expect(by.run).toEqual({ tag: 'run', entries: 3, avgMood: 1.67, baseline: 0.71, delta: 0.95 });
    expect(by.work).toEqual({
      tag: 'work',
      entries: 4,
      avgMood: -0.75,
      baseline: 0.71,
      delta: -1.46,
    });
    expect(by.rare).toBeUndefined();
    expect(res.body.items.map((c: { tag: string }) => c.tag)).toEqual(['work', 'run']);
  });

  it('returns an empty list below minEntries scored entries', async () => {
    const u = await seedUser();
    for (let i = 0; i < 13; i++)
      await seedEntry(u.id, { mood: 'calm', tags: ['a'], entryDate: addDays(today(), -i) });
    for (let i = 0; i < 5; i++) await seedEntry(u.id, { mood: null, tags: ['a'] });
    const res = await api.get('/api/insights/correlations').set(u.headers).expect(200);
    expect(res.body).toEqual({ items: [], minEntries: 14 });
  });

  it('keeps the top 8 by absolute delta and counts a duplicated tag once', () => {
    const rows: { mood: string; tags: string[] }[] = [];
    for (let t = 0; t < 10; t++)
      for (let k = 0; k < 3; k++)
        rows.push({ mood: t % 2 ? 'joyful' : 'sad', tags: [`t${t}`, `t${t}`] });
    const out = computeCorrelations(rows);
    expect(out).toHaveLength(8);
    expect(out.every((c) => c.entries === 3)).toBe(true);
  });

  it('is scoped to the caller and validates tz', async () => {
    const u = await seedUser();
    const o = await seedUser();
    for (let i = 0; i < 16; i++)
      await seedEntry(o.id, { mood: 'calm', tags: ['x', 'y'], entryDate: addDays(today(), -i) });
    const res = await api.get('/api/insights/correlations').set(u.headers).expect(200);
    expect(res.body.items).toEqual([]);
    await api.get('/api/insights/correlations?tz=Nope/Nope').set(u.headers).expect(400);
    await api.get('/api/insights/correlations').expect(401);
  });
});
