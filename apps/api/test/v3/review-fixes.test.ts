/** Regression tests for the confirmed API findings of the v3 adversarial review. */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, weekStart } from '@solace/shared';
import { embedModel } from '../../src/ai/gemini';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import {
  aiUsage,
  capsules,
  chapters,
  entries,
  growthNotes,
  intentionCheckins,
  intentions,
  jobs,
  memories,
  parentalConsents,
  pastLetters,
  profiles,
} from '../../src/db/schema';
import { httpLogSerializers, loggablePath } from '../../src/middleware/http-logger';
import { listChapters, MAX_BUILDS_PER_DAY } from '../../src/services/chapters';
import { similarMemories } from '../../src/services/memories';
import { clearOutbox, outbox, sendMail } from '../../src/services/mailer';
import { forgetGate, gateState } from '../../src/services/profiles';
import { requestConsent } from '../../src/services/teen';
import { logger } from '../../src/logger';
import { JOB } from '../../src/jobs/types';
import { fakeEmbedding, installFakeAi, type FakeAi } from '../ai/fake-ai';
import { seedEntry, seedUser } from '../ai/seed';
import { resetDb, testApi } from '../helpers';
import { daysAgo, featureCalls, jobRows, runJob, systemOf } from './ai-util';

const api = testApi();
let fake: FakeAi;
beforeEach(async () => {
  await resetDb();
  clearOutbox();
  fake = installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

const makeTeen = (id: string, consentStatus: 'granted' | 'pending' = 'granted') =>
  db
    .update(profiles)
    .set({ mode: 'teen', ageBand: '13-15', consentStatus })
    .where(eq(profiles.id, id));

// ───────────────────────── export ─────────────────────────

describe('export includes the v3 data', () => {
  async function seedV3() {
    const u = await seedUser();
    const past = (h: number) => new Date(Date.now() + h * 3_600_000);
    await db.insert(capsules).values([
      { userId: u.id, title: 'Sealed one', body: 'SEALED-SECRET-BODY', unlockAt: past(48) },
      { userId: u.id, title: 'Ready one', body: 'READY-SECRET-BODY', unlockAt: past(-2) },
      {
        userId: u.id,
        title: 'Opened one',
        body: 'OPENED-VISIBLE-BODY',
        unlockAt: past(-48),
        openedAt: past(-24),
      },
    ]);
    await db
      .insert(pastLetters)
      .values({ userId: u.id, month: '2026-09', content: 'Dear you, LETTER-TEXT', citations: [] });
    await db.insert(chapters).values({
      userId: u.id,
      title: 'The harbour flat',
      summary: 'A quiet start.',
      fromDate: '2026-01-01',
      color: 'accent',
      cast: ['Maya'],
    });
    await db
      .insert(growthNotes)
      .values({ userId: u.id, weekStart: '2026-10-05', text: 'GROWTH-TEXT', citations: [] });
    const [intention] = await db
      .insert(intentions)
      .values({ userId: u.id, title: 'Stretch daily', kind: 'habit', cadence: 'daily' })
      .returning();
    await db
      .insert(intentionCheckins)
      .values({ intentionId: intention!.id, userId: u.id, date: '2026-10-01', note: 'felt good' });
    await db.insert(parentalConsents).values({
      userId: u.id,
      parentEmailHash: 'HASH-EMAIL',
      tokenHash: 'HASH-TOKEN',
      status: 'granted',
      policyVersion: '2026-10',
      decidedAt: new Date('2026-10-02T10:00:00Z'),
      expiresAt: past(100),
    });
    return u;
  }

  it('JSON: version 2, new sections, sealed and ready capsules have a null body, no hashes', async () => {
    const u = await seedV3();
    const res = await api.get('/api/me/export?format=json').set(u.headers).buffer(true).expect(200);
    const text = res.text;
    const body = JSON.parse(text);
    expect(body.version).toBe(2);
    const byTitle = Object.fromEntries(
      body.capsules.map((c: { title: string; body: string | null }) => [c.title, c]),
    );
    expect(byTitle['Sealed one'].body).toBeNull();
    expect(byTitle['Ready one'].body).toBeNull();
    expect(byTitle['Opened one'].body).toBe('OPENED-VISIBLE-BODY');
    expect(text).not.toContain('SEALED-SECRET-BODY');
    expect(text).not.toContain('READY-SECRET-BODY');
    expect(body.letters[0].content).toContain('LETTER-TEXT');
    expect(body.chapters[0]).toMatchObject({ title: 'The harbour flat', cast: ['Maya'] });
    expect(body.growthNotes[0].text).toBe('GROWTH-TEXT');
    expect(body.intentions[0]).toMatchObject({
      title: 'Stretch daily',
      checkins: [{ date: '2026-10-01', note: 'felt good' }],
    });
    expect(body.consent).toEqual({ status: 'not_required', decidedAt: '2026-10-02T10:00:00.000Z' });
    expect(text).not.toContain('HASH-EMAIL');
    expect(text).not.toContain('HASH-TOKEN');
  });

  it('Markdown: capsule titles and dates, letters, intentions; never a capsule body', async () => {
    const u = await seedV3();
    const res = await api.get('/api/me/export?format=markdown').set(u.headers).buffer(true).expect(200);
    expect(res.text).toContain('# Time capsules');
    expect(res.text).toContain('Sealed one');
    expect(res.text).toContain('LETTER-TEXT');
    expect(res.text).toContain('Stretch daily');
    for (const secret of ['SEALED-SECRET-BODY', 'READY-SECRET-BODY', 'OPENED-VISIBLE-BODY']) {
      expect(res.text).not.toContain(secret);
    }
  });
});

// ───────────────────────── chapters ─────────────────────────

describe('chapters refresh cannot drain the batch quota', () => {
  async function stale() {
    const u = await seedUser();
    for (let i = 0; i < 16; i++) {
      await seedEntry(u.id, {
        body: `Entry number ${i} about the harbour flat and the months going by.`,
        entryDate: addDays(daysAgo(200), i * 10),
      });
    }
    return u;
  }
  const calls = async (id: string) =>
    Number(
      (await db.select().from(aiUsage).where(eq(aiUsage.userId, id)))[0]?.calls ?? 0,
    );
  const kill = (userId: string) =>
    db.insert(jobs).values({
      type: JOB.buildChapters,
      payload: { userId },
      dedupeKey: `chapters:${userId}`,
      status: 'dead',
    });

  it('spends one unit of the daily budget per queued build, not per click', async () => {
    const u = await stale();
    await api.post('/api/chapters/refresh').set(u.headers).expect(200);
    await api.post('/api/chapters/refresh').set(u.headers).expect(200);
    expect(await jobRows(JOB.buildChapters)).toHaveLength(1);
    expect(await calls(u.id)).toBe(1);
  });

  it('is refused with 429 once the daily AI budget is spent', async () => {
    const u = await stale();
    const c = config as { AI_DAILY_QUOTA: number };
    const prev = c.AI_DAILY_QUOTA;
    c.AI_DAILY_QUOTA = 0;
    try {
      await api.post('/api/chapters/refresh').set(u.headers).expect(429);
      expect(await jobRows(JOB.buildChapters)).toHaveLength(0);
    } finally {
      c.AI_DAILY_QUOTA = prev;
    }
  });

  it('does not queue again right after a build died (failure cooldown)', async () => {
    const u = await stale();
    await kill(u.id);
    await api.post('/api/chapters/refresh').set(u.headers).expect(200);
    expect(await jobRows(JOB.buildChapters)).toHaveLength(1); // only the dead one
    expect(await calls(u.id)).toBe(0);
  });

  it('caps builds per person per day', async () => {
    const u = await stale();
    await db.insert(jobs).values(
      Array.from({ length: MAX_BUILDS_PER_DAY }, () => ({
        type: JOB.buildChapters,
        payload: { userId: u.id },
        dedupeKey: `chapters:${u.id}`,
        status: 'done' as const,
      })),
    );
    await api.post('/api/chapters/refresh').set(u.headers).expect(200);
    expect(await jobRows(JOB.buildChapters)).toHaveLength(MAX_BUILDS_PER_DAY);
    expect(await calls(u.id)).toBe(0);
  });

  it('the route sits behind the AI rate limiter', async () => {
    const limited = testApi({ rateLimits: { ai: 1 } });
    const u = await stale();
    await limited.post('/api/chapters/refresh').set(u.headers).expect(200);
    await limited.post('/api/chapters/refresh').set(u.headers).expect(429);
  });
});

// ───────────────────────── letters ─────────────────────────

describe('concurrent POST /letters', () => {
  it('makes one model call, charges one quota unit and returns the same letter', async () => {
    const u = await seedUser();
    for (let i = 0; i < 6; i++) {
      await seedEntry(u.id, {
        body: `I walked by the river on day ${i} and thought about the future.`,
        entryDate: daysAgo(70 + i * 20),
        mood: 'joyful',
      });
    }
    const [a, b, c] = await Promise.all([
      api.post('/api/letters').set(u.headers),
      api.post('/api/letters').set(u.headers),
      api.post('/api/letters').set(u.headers),
    ]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(new Set([a.body.id, b.body.id, c.body.id]).size).toBe(1);
    expect(featureCalls(fake)).toHaveLength(1);
    const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.userId, u.id));
    expect(usage!.calls).toBe(1);
    expect(await db.select().from(pastLetters).where(eq(pastLetters.userId, u.id))).toHaveLength(1);
  });

  it('refunds the quota unit when the model fails', async () => {
    const u = await seedUser();
    for (let i = 0; i < 6; i++) {
      await seedEntry(u.id, {
        body: `I walked by the river on day ${i} and thought about the future.`,
        entryDate: daysAgo(70 + i * 20),
      });
    }
    fake.failures.push(new Error('boom'));
    const res = await api.post('/api/letters').set(u.headers);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.userId, u.id));
    expect(usage?.calls ?? 0).toBe(0);
  });
});

// ───────────────────────── ritual ─────────────────────────

describe('concurrent weekly rituals', () => {
  it('leave one Weekly review entry and one intention', async () => {
    const u = await seedUser();
    const send = () =>
      api
        .post('/api/rituals/weekly')
        .set(u.headers)
        .send({ highs: 'Good week', intention: { title: 'Read more', kind: 'habit', cadence: 'daily' } });
    const res = await Promise.all([send(), send(), send()]);
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    const weekly = await db
      .select()
      .from(entries)
      .where(and(eq(entries.userId, u.id), eq(entries.title, 'Weekly review')));
    expect(weekly).toHaveLength(1);
    expect(await db.select().from(intentions).where(eq(intentions.userId, u.id))).toHaveLength(1);
    expect(weekStart(weekly[0]!.entryDate)).toBeTruthy();
  });
});

// ───────────────────────── unwrapped ─────────────────────────

describe('unwrapped period validation', () => {
  it.each([
    'period=year&at=0000',
    'period=month&at=0000-05',
    'period=year&at=0001',
    'period=month&at=1850-01',
    'period=year&at=9999',
    'period=month&at=9999-12',
  ])('answers 400 for %s', async (qs) => {
    const u = await seedUser();
    expect((await api.get(`/api/unwrapped?${qs}`).set(u.headers)).status).toBe(400);
  });

  it('still accepts a normal year', async () => {
    const u = await seedUser();
    expect((await api.get('/api/unwrapped?period=year&at=2026&tz=UTC').set(u.headers)).status).toBe(200);
  });
});

// ───────────────────────── teen: third parties ─────────────────────────

describe('teen accounts do not get lists or mentions of other people', () => {
  async function journal(userId: string) {
    for (let i = 0; i < 16; i++) {
      await seedEntry(userId, {
        title: i === 2 ? 'Walk with Maya' : `Day ${i}`,
        body: `Entry number ${i} about the harbour flat and the months going by.`,
        entryDate: addDays(daysAgo(200), i * 10),
        mood: 'calm',
      });
    }
  }
  const model = () => ({
    chapters: [
      {
        title: 'The harbour flat',
        summary: 'A quiet start.',
        from: addDays(daysAgo(200), 0),
        to: null,
        color: 'accent',
        cast: ['Maya'],
        keyEntryIds: ['e1'],
      },
    ],
  });

  it('chapters are built without a cast and the prompt does not ask for one', async () => {
    const u = await seedUser();
    await journal(u.id);
    await makeTeen(u.id);
    fake.replies.other = () => JSON.stringify(model());
    await runJob(JOB.buildChapters, { userId: u.id });
    const [row] = await db.select().from(chapters).where(eq(chapters.userId, u.id));
    expect(row!.cast).toEqual([]);
    expect(systemOf(featureCalls(fake)[0]!)).toContain('always an empty array');
  });

  it('adults still get their cast', async () => {
    const u = await seedUser();
    await journal(u.id);
    fake.replies.other = () => JSON.stringify(model());
    await runJob(JOB.buildChapters, { userId: u.id });
    const [row] = await db.select().from(chapters).where(eq(chapters.userId, u.id));
    expect(row!.cast).toEqual(['Maya']);
  });

  it('legacy chapters with a cast are served to a teen with an empty cast', async () => {
    const u = await seedUser();
    await db
      .insert(chapters)
      .values({ userId: u.id, title: 'Old', summary: 's', fromDate: '2026-01-01', color: 'accent', cast: ['Maya'] });
    await makeTeen(u.id);
    expect((await listChapters(u.id)).items[0]!.cast).toEqual([]);
  });

  it('letters and growth notes tell the model not to name other people', async () => {
    const u = await seedUser();
    for (let i = 0; i < 6; i++) {
      await seedEntry(u.id, {
        body: `I walked by the river on day ${i} and thought about the future.`,
        entryDate: daysAgo(70 + i * 20),
      });
    }
    await makeTeen(u.id);
    await api.post('/api/letters').set(u.headers).expect(200);
    expect(systemOf(featureCalls(fake)[0]!)).toContain('teenager');
  });

  it('Reflect retrieval and memory prompts skip person memories for teens', async () => {
    const teen = await seedUser();
    const adult = await seedUser();
    await makeTeen(teen.id);
    const vec = fakeEmbedding('Maya from school');
    for (const id of [teen.id, adult.id]) {
      await db.insert(memories).values({
        userId: id,
        kind: 'person',
        content: 'Maya is a friend from school',
        salience: 3,
        embedding: vec,
        model: embedModel(),
      });
    }
    expect(await similarMemories(teen.id, vec, 5, -1, db, ['person'])).toHaveLength(0);
    expect(await similarMemories(adult.id, vec, 5)).toHaveLength(1);

    await api.get('/api/prompts/today').set(teen.headers).expect(200);
    expect(fake.generateCalls).toHaveLength(0); // no memory-inspired prompt
    await api.get('/api/prompts/today').set(adult.headers).expect(200);
    expect(fake.generateCalls).toHaveLength(1);
  });
});

// ───────────────────────── consent token in logs ─────────────────────────

describe('consent token redaction', () => {
  it('replaces the token in the logged path, with or without a query', () => {
    const token = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-';
    expect(loggablePath(`/api/consent/${token}`)).toBe('/api/consent/:token');
    expect(loggablePath(`/api/consent/${token}?x=1`)).toBe('/api/consent/:token');
    expect(loggablePath('/api/entries?q=secret')).toBe('/api/entries');
    const logged = httpLogSerializers.req({ id: 1, method: 'POST', url: `/api/consent/${token}` });
    expect(JSON.stringify(logged)).not.toContain(token);
  });
});

// ───────────────────────── mail transport and consent requests ─────────────────────────

describe('consent mail outside development', () => {
  it('the log transport does not write the link or the parent address to the logs', async () => {
    const spies = [vi.spyOn(logger, 'info'), vi.spyOn(logger, 'warn')];
    try {
      await sendMail({
        to: 'parent@example.com',
        subject: 'Please approve',
        text: 'Open https://app.example/consent/SECRETTOKEN',
      });
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain('SECRETTOKEN');
      expect(logged).not.toContain('parent@example.com');
      expect(outbox).toHaveLength(1); // tests still read the in-memory outbox
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('in development it still logs for local testing', async () => {
    const c = config as { NODE_ENV: string };
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    c.NODE_ENV = 'development';
    try {
      await sendMail({ to: 'p@example.com', subject: 's', text: 'link' });
      expect(spy).toHaveBeenCalled();
    } finally {
      c.NODE_ENV = 'test';
      spy.mockRestore();
    }
  });

  it('requestConsent answers 503 in production without a mailer and stores nothing', async () => {
    const u = await seedUser();
    await makeTeen(u.id, 'pending');
    const c = config as { NODE_ENV: string };
    c.NODE_ENV = 'production';
    try {
      await expect(requestConsent(u.id, 'mum@example.com')).rejects.toMatchObject({
        status: 503,
        code: 'teen_signup_unavailable',
      });
    } finally {
      c.NODE_ENV = 'test';
    }
    expect(await db.select().from(parentalConsents).where(eq(parentalConsents.userId, u.id))).toHaveLength(0);
    expect(outbox).toHaveLength(0);
  });
});

// ───────────────────────── gate cache ─────────────────────────

describe('gate cache after a revoke', () => {
  it('a read that raced the invalidation is not cached', async () => {
    const u = await seedUser();
    await makeTeen(u.id, 'granted');
    forgetGate(u.id);

    const racing = gateState(u.id); // reads "granted" from the database
    forgetGate(u.id); // the revoke commits and invalidates while that read is in flight
    expect((await racing)?.consentStatus).toBe('granted');

    await db.update(profiles).set({ consentStatus: 'revoked' }).where(eq(profiles.id, u.id));
    // Without the fix the stale "granted" was cached by `racing` and is served here.
    expect((await gateState(u.id))?.consentStatus).toBe('revoked');
  });
});
