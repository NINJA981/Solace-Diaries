import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  localDate,
  stats as statsSchema,
  weekStart,
  weeklyLetterResponse,
} from '@solace/shared';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { entries, insightReports } from '../../src/db/schema';
import { cleanLetter, weekWindow } from '../../src/services/insights';
import {
  buildDays,
  buildMoodTrend,
  computeStreaks,
  dominantMood,
  getStats,
  moodScore,
} from '../../src/services/stats';
import { resetDb, testApi } from '../helpers';
import { installFakeAi, userText, type FakeAi } from './fake-ai';
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

describe('streak math', () => {
  it('handles empty input', () => {
    expect(computeStreaks([], '2026-01-05')).toEqual({ current: 0, longest: 0 });
  });

  it('counts today or yesterday as alive, anything older as broken', () => {
    const run = ['2026-01-01', '2026-01-02', '2026-01-03'];
    expect(computeStreaks(run, '2026-01-03')).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(run, '2026-01-04')).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(run, '2026-01-05')).toEqual({ current: 0, longest: 3 });
  });

  it('finds the longest run across gaps, duplicates and unsorted input', () => {
    const dates = [
      '2026-02-10',
      '2026-01-01',
      '2026-01-02',
      '2026-02-09',
      '2026-01-03',
      '2026-01-04',
      '2026-01-02',
      '2026-02-11',
    ];
    expect(computeStreaks(dates, '2026-02-11')).toEqual({ current: 3, longest: 4 });
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(computeStreaks(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01').current).toBe(
      3,
    );
    expect(computeStreaks(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01').current).toBe(
      3,
    );
    expect(computeStreaks(['2027-02-28', '2027-03-01'], '2027-03-01').current).toBe(2);
  });

  it('is unaffected by DST transitions (pure calendar dates)', () => {
    // US spring-forward 2026-03-08, EU fall-back 2026-10-25.
    expect(computeStreaks(['2026-03-07', '2026-03-08', '2026-03-09'], '2026-03-09').current).toBe(
      3,
    );
    expect(computeStreaks(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26').current).toBe(
      3,
    );
  });

  it('ignores future-dated entries', () => {
    expect(computeStreaks(['2026-01-01', '2026-01-02', '2026-01-09'], '2026-01-02')).toEqual({
      current: 2,
      longest: 2,
    });
  });
});

describe('mood math', () => {
  it('averages valence and picks a stable dominant mood', () => {
    expect(moodScore([])).toBeNull();
    expect(moodScore(['joyful', 'sad', 'calm'])).toBeCloseTo(0.33);
    expect(moodScore(['nonsense'])).toBeNull();
    expect(dominantMood(['sad', 'calm', 'sad'])).toBe('sad');
    expect(dominantMood(['sad', 'calm'])).toBe('calm'); // tie → earlier in MOODS
    expect(
      buildDays([
        { date: '2026-01-02', count: 2, words: 10, moods: ['tired'] },
        { date: '2026-01-01', count: 1, words: 3, moods: [] },
      ]),
    ).toEqual([
      { date: '2026-01-01', count: 1, words: 3, moodScore: null, mood: null },
      { date: '2026-01-02', count: 2, words: 10, moodScore: -1, mood: 'tired' },
    ]);
  });

  it('builds 26 Monday weeks ending with the current week, oldest first', () => {
    const today = '2026-10-14'; // Wednesday
    const trend = buildMoodTrend(
      [
        { date: '2026-10-12', mood: 'joyful', count: 1 },
        { date: '2026-10-18', mood: 'sad', count: 1 }, // Sunday: same week
        { date: '2026-10-11', mood: 'calm', count: 3 }, // previous week
        { date: '2025-01-01', mood: 'calm', count: 1 }, // out of range
      ],
      today,
    );
    expect(trend).toHaveLength(26);
    expect(trend.at(-1)).toEqual({
      weekStart: '2026-10-12',
      avgScore: 0,
      counts: { joyful: 1, sad: 1 },
    });
    expect(trend.at(-2)).toEqual({ weekStart: '2026-10-05', avgScore: 1, counts: { calm: 3 } });
    expect(trend[0]!.weekStart).toBe(addDays('2026-10-12', -7 * 25));
    expect(trend.slice(0, -2).every((w) => w.avgScore === null)).toBe(true);
  });
});

describe('GET /insights/stats', () => {
  it('aggregates in SQL relative to today in the requested timezone', async () => {
    const user = await seedUser({ timezone: 'Pacific/Kiritimati' });
    const tz = 'Pacific/Kiritimati';
    const today = localDate(new Date(), tz);
    const other = await seedUser();
    await seedEntry(other.id, { body: 'not mine', entryDate: today });
    await seedEntry(user.id, {
      body: 'one two three',
      entryDate: today,
      mood: 'joyful',
      tags: ['walk', 'tea'],
    });
    await seedEntry(user.id, { body: 'four five', entryDate: today, mood: 'sad', tags: ['walk'] });
    await seedEntry(user.id, { body: 'x', entryDate: addDays(today, -1) });
    await seedEntry(user.id, { body: 'old', entryDate: addDays(today, -400), tags: ['walk'] });

    const res = await api.get('/api/insights/stats').set(user.headers).expect(200); // profile tz
    const s = statsSchema.parse(res.body);
    expect(s.today).toBe(today);
    expect(s.days.map((d) => d.date)).toEqual([addDays(today, -1), today]);
    expect(s.days[1]).toMatchObject({ count: 2, words: 5, moodScore: 0, mood: 'joyful' });
    expect(s).toMatchObject({ currentStreak: 2, longestStreak: 2, totalEntries: 4, totalWords: 7 });
    expect(s.topTags).toEqual([
      { tag: 'walk', count: 3 },
      { tag: 'tea', count: 1 },
    ]);
    expect(s.moodTrend.at(-1)!.counts).toEqual({ joyful: 1, sad: 1 });
  });

  it('honours ?tz and rejects unknown zones', async () => {
    const user = await seedUser();
    const now = new Date('2026-07-01T02:00:00Z'); // still June 30 in Los Angeles
    const s = await getStats(user.id, 'America/Los_Angeles', now);
    expect(s.today).toBe('2026-06-30');
    const bad = await api.get('/api/insights/stats?tz=Mars/Base').set(user.headers);
    expect(bad.status).toBe(400);
  });
});

describe('weekly letter', () => {
  it('computes the Monday-start week in the user’s timezone', () => {
    // Sunday 23:30 in New York is already Monday in UTC.
    const at = new Date('2026-10-19T03:30:00Z');
    expect(weekWindow('America/New_York', at)).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(weekWindow('UTC', at)).toEqual({ start: '2026-10-19', end: '2026-10-25' });
    expect(weekWindow('Asia/Tokyo', new Date('2026-10-18T15:30:00Z'))).toEqual({
      start: '2026-10-19',
      end: '2026-10-25',
    });
  });

  it('cleans the letter down to safe markdown', () => {
    expect(
      cleanLetter(
        '# Big\n#### Deep\n![x](http://e/i.png) see [this](http://e) <b>bold</b>\n\n\n\nend',
      ),
    ).toBe('### Big\n### Deep\n see this bold\n\nend');
  });

  it('needs at least two entries this week; generates once, caches, and flags staleness', async () => {
    const tz = 'Asia/Kolkata';
    const user = await seedUser({ timezone: tz });
    const today = localDate(new Date(), tz);
    const start = weekStart(today);
    const first = await seedEntry(user.id, {
      title: 'Monday',
      body: 'Started the week slowly.',
      entryDate: start,
    });
    await seedEntry(user.id, {
      title: 'Last week',
      body: 'Should not appear.',
      entryDate: addDays(start, -1),
    });

    let res = weeklyLetterResponse.parse(
      (await api.get('/api/insights/weekly').set(user.headers).expect(200)).body,
    );
    expect(res).toEqual({ letter: null, minEntries: 2 });

    await seedEntry(user.id, {
      title: 'Today',
      body: 'A good walk with mum.',
      entryDate: today === start ? start : today,
    });
    res = weeklyLetterResponse.parse(
      (await api.get('/api/insights/weekly').set(user.headers).expect(200)).body,
    );
    expect(res.letter).toMatchObject({ weekStart: start, entryCount: 2, stale: false });
    expect(res.letter!.content).toContain('### Your week');
    const prompt = userText(fake.calls('weekly')[0]!);
    expect(prompt).toContain('Started the week slowly.');
    expect(prompt).not.toContain('Should not appear.');

    // Cached: a second read makes no AI call.
    await api.get('/api/insights/weekly').set(user.headers).expect(200);
    expect(fake.calls('weekly')).toHaveLength(1);

    // Editing a week entry marks it stale; refresh regenerates.
    await db.update(entries).set({ body: 'Edited.' }).where(eq(entries.id, first.id));
    res = weeklyLetterResponse.parse(
      (await api.get('/api/insights/weekly').set(user.headers).expect(200)).body,
    );
    expect(res.letter!.stale).toBe(true);
    fake.replies.weekly = () => 'A fresh letter.';
    res = weeklyLetterResponse.parse(
      (await api.post('/api/insights/weekly/refresh').set(user.headers).expect(200)).body,
    );
    expect(res.letter).toMatchObject({ content: 'A fresh letter.', stale: false });
    const rows = await db.select().from(insightReports).where(eq(insightReports.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('maps AI failure to 503', async () => {
    const user = await seedUser();
    const today = localDate(new Date(), 'UTC');
    await seedEntry(user.id, { body: 'a', entryDate: today });
    await seedEntry(user.id, { body: 'b', entryDate: today });
    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
    const res = await api.post('/api/insights/weekly/refresh').set(user.headers);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ai_unavailable');
  });
});
