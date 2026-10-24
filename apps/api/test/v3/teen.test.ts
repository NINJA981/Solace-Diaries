import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import {
  entries,
  graphNodes,
  memories,
  parentalConsents,
  profiles,
} from '../../src/db/schema';
import { setAgeGateEnforced } from '../../src/middleware/age-gate';
import { forgetProfile } from '../../src/services/profiles';
import { clearOutbox, maskEmail, outbox } from '../../src/services/mailer';
import { classifyAge, conservativeAge, hashEmail } from '../../src/services/teen';
import { enrichEntry } from '../../src/services/enrichment';
import { enrichReply, installFakeAi, type FakeAi } from '../ai/fake-ai';
import { seedEntry } from '../ai/seed';
import { createTestUser, resetDb, testApi, type TestUser } from '../helpers';

const api = testApi();
const YEAR = new Date().getUTCFullYear();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeAll(() => setAgeGateEnforced(true));
afterAll(() => setAgeGateEnforced(false));
beforeEach(async () => {
  await resetDb();
  clearOutbox();
});

async function newUser(): Promise<TestUser> {
  const u = await createTestUser();
  await api.get('/api/me').set(u.headers).expect(200); // creates the profile row
  return u;
}
/** Born in December of (year - yearsOld - 1): conservatively exactly `yearsOld` all year. */
const ageAs = (u: TestUser, yearsOld: number) =>
  api
    .post('/api/me/age')
    .set(u.headers)
    .send({ birthYear: YEAR - yearsOld - 1, birthMonth: 12 });
const tokenOf = () => /\/consent\/([\w-]+)/.exec(outbox.at(-1)!.text)![1]!;

async function pendingTeen() {
  const u = await newUser();
  await ageAs(u, 15).expect(200);
  const sent = await api
    .post('/api/me/consent')
    .set(u.headers)
    .send({ parentEmail: 'Mum@Example.com' });
  expect(sent.status).toBe(200);
  return { u, token: tokenOf(), sent };
}

describe('age maths', () => {
  const at = (iso: string) => new Date(iso);
  it('is conservative inside the birth month', () => {
    expect(conservativeAge(2010, 3, at('2026-03-15T00:00:00Z'))).toBe(15);
    expect(conservativeAge(2010, 2, at('2026-03-15T00:00:00Z'))).toBe(16);
    expect(conservativeAge(2010, 4, at('2026-03-15T00:00:00Z'))).toBe(15);
  });
  it('handles year boundaries and leap-day births (month only)', () => {
    expect(conservativeAge(2013, 12, at('2026-01-01T00:00:00Z'))).toBe(12);
    expect(conservativeAge(2012, 2, at('2025-12-31T23:59:59Z'))).toBe(13);
    expect(conservativeAge(2008, 1, at('2026-01-31T00:00:00Z'))).toBe(17);
    expect(conservativeAge(2008, 1, at('2026-02-01T00:00:00Z'))).toBe(18);
  });
  it('classifies bands', () => {
    expect(classifyAge(12)).toEqual({ kind: 'under13' });
    expect(classifyAge(13)).toEqual({ kind: 'band', band: '13-15', mode: 'teen' });
    expect(classifyAge(15)).toEqual({ kind: 'band', band: '13-15', mode: 'teen' });
    expect(classifyAge(16)).toEqual({ kind: 'band', band: '16-17', mode: 'teen' });
    expect(classifyAge(17)).toEqual({ kind: 'band', band: '16-17', mode: 'teen' });
    expect(classifyAge(18)).toEqual({ kind: 'band', band: '18+', mode: 'adult' });
  });
  it('masks emails', () => expect(maskEmail('parent@gmail.com')).toBe('p•••@gmail.com'));
});

describe('age gate', () => {
  it('rejects absurd inputs', async () => {
    const u = await newUser();
    const post = (body: object) => api.post('/api/me/age').set(u.headers).send(body);
    await post({ birthYear: YEAR + 1, birthMonth: 1 }).expect(400);
    await post({ birthYear: 1900, birthMonth: 1 }).expect(400);
    await post({ birthYear: 2000, birthMonth: 13 }).expect(400);
  });

  it('sets adult mode with no consent needed, and stores no birth date', async () => {
    const u = await newUser();
    const res = await ageAs(u, 30).expect(200);
    expect(res.body).toMatchObject({
      mode: 'adult',
      ageConfirmed: true,
      consentStatus: 'not_required',
    });
    const [row] = await db.select().from(profiles).where(eq(profiles.id, u.id));
    expect(row!.ageBand).toBe('18+');
    expect(JSON.stringify(row)).not.toContain(String(YEAR - 31));
    await api.get('/api/entries').set(u.headers).expect(200);
  });

  it('puts 13-17 in teen mode with consent pending', async () => {
    const a = await newUser();
    expect((await ageAs(a, 14).expect(200)).body).toMatchObject({
      mode: 'teen',
      consentStatus: 'pending',
    });
    const b = await newUser();
    await ageAs(b, 17).expect(200);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, b.id));
    expect(row!.ageBand).toBe('16-17');
  });

  it('under 13: 403 age_restricted and the account is completely deleted', async () => {
    const u = await newUser();
    await seedEntry(u.id, { title: 'x', body: 'some words here for the diary' });
    await db.insert(memories).values({ userId: u.id, kind: 'habit', content: 'Walks' });
    const res = await ageAs(u, 11);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('age_restricted');
    expect(await db.select().from(profiles).where(eq(profiles.id, u.id))).toHaveLength(0);
    expect(await db.select().from(entries).where(eq(entries.userId, u.id))).toHaveLength(0);
    expect(await db.select().from(memories).where(eq(memories.userId, u.id))).toHaveLength(0);
    forgetProfile();
  });

  it('the band is immutable once set (no up or down moves)', async () => {
    const adult = await newUser();
    await ageAs(adult, 30).expect(200);
    const again = await ageAs(adult, 14).expect(200);
    expect(again.body).toMatchObject({ mode: 'adult', consentStatus: 'not_required' });

    const teen = await newUser();
    await ageAs(teen, 14).expect(200);
    const up = await ageAs(teen, 30).expect(200);
    expect(up.body).toMatchObject({ mode: 'teen', consentStatus: 'pending' });
    const [row] = await db.select().from(profiles).where(eq(profiles.id, teen.id));
    expect(row!.ageBand).toBe('13-15');
    // an under-13 answer after the gate is set does not delete a settled account either
    await ageAs(teen, 9).expect(200);
    expect(await db.select().from(profiles).where(eq(profiles.id, teen.id))).toHaveLength(1);
  });

  it('production without a mail provider: teen gets 503 and nothing is stored; adults are fine', async () => {
    const c = config as { NODE_ENV: string };
    c.NODE_ENV = 'production';
    try {
      const teen = await newUser();
      const res = await ageAs(teen, 15);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('teen_signup_unavailable');
      const [row] = await db.select().from(profiles).where(eq(profiles.id, teen.id));
      expect(row).toMatchObject({ ageBand: null, mode: 'adult', consentStatus: 'not_required' });
      const adult = await newUser();
      await ageAs(adult, 25).expect(200);
    } finally {
      c.NODE_ENV = 'test';
    }
  });
});

describe('gating matrix', () => {
  it('age_required until the gate is answered; allowed routes still work', async () => {
    const u = await newUser();
    for (const path of ['/api/entries', '/api/memories', '/api/capsules']) {
      const res = await api.get(path).set(u.headers);
      expect([path, res.status, res.body.code]).toEqual([path, 403, 'age_required']);
    }
    const consent = await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'a@b.co' });
    expect([consent.status, consent.body.code]).toEqual([403, 'age_required']);
    await api.get('/api/me').set(u.headers).expect(200);
    await api.get('/api/me/usage').set(u.headers).expect(200);
    await api.get('/api/me/export').set(u.headers).expect(200);
    await ageAs(u, 30).expect(200);
  });

  it('consent_required for a teen until granted; allowed routes and /me/consent still work', async () => {
    const u = await newUser();
    await ageAs(u, 15).expect(200);
    for (const path of ['/api/entries', '/api/memories', '/api/capsules']) {
      const res = await api.get(path).set(u.headers);
      expect([path, res.status, res.body.code]).toEqual([path, 403, 'consent_required']);
    }
    await api.get('/api/me').set(u.headers).expect(200);
    await api.get('/api/me/usage').set(u.headers).expect(200);
    await api.get('/api/me/export').set(u.headers).expect(200);
    await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'p@example.com' })
      .expect(200);
  });

  it('unlocks after a grant and locks again after a revoke', async () => {
    const { u, token } = await pendingTeen();
    await api.post(`/api/consent/${token}`).send({ decision: 'grant' }).expect(200);
    await api.get('/api/entries').set(u.headers).expect(200);
    await api.post(`/api/consent/${token}`).send({ decision: 'revoke' }).expect(200);
    const res = await api.get('/api/entries').set(u.headers);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('consent_required');
    await api.get('/api/me/export').set(u.headers).expect(200);
  });

  it('delete account works for a locked teen', async () => {
    const { u } = await pendingTeen();
    await api.delete('/api/me').set(u.headers).send({ confirmEmail: u.email }).expect(204);
  });

  it('adults cannot use the consent endpoint', async () => {
    const u = await newUser();
    await ageAs(u, 30).expect(200);
    await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'p@example.com' })
      .expect(403);
  });
});

describe('parental consent', () => {
  it('stores hashes only and emails a link through the mailer', async () => {
    const { u, token, sent } = await pendingTeen();
    expect(sent.body.sentTo).toBe('M•••@Example.com');
    expect(new Date(sent.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const mail = outbox.at(-1)!;
    expect(mail.to).toBe('Mum@Example.com');
    expect(mail.text).toContain(`${config.WEB_ORIGIN[0]}/consent/${token}`);
    expect(mail.text).toMatch(/withdraw approval/);
    expect(mail.text).not.toMatch(/<img|pixel/i);
    const rows = await db.select().from(parentalConsents).where(eq(parentalConsents.userId, u.id));
    expect(rows).toHaveLength(1);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(token);
    expect(dump.toLowerCase()).not.toContain('mum@example.com');
    expect(rows[0]).toMatchObject({
      tokenHash: sha(token),
      parentEmailHash: hashEmail('mum@example.com'),
      policyVersion: '2026-10',
      status: 'pending',
    });
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows the parent only the first name, status, version and expiry', async () => {
    const { u, token } = await pendingTeen();
    await db.update(profiles).set({ displayName: 'Alex Johnson' }).where(eq(profiles.id, u.id));
    const res = await api.get(`/api/consent/${token}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'expiresAt',
      'policyVersion',
      'status',
      'teenFirstName',
    ]);
    expect(res.body).toMatchObject({
      teenFirstName: 'Alex',
      status: 'pending',
      policyVersion: '2026-10',
    });
  });

  it('grant is one-time; deny after grant and a second grant are refused', async () => {
    const { u, token } = await pendingTeen();
    const ok = await api.post(`/api/consent/${token}`).send({ decision: 'grant' }).expect(200);
    expect(ok.body.status).toBe('granted');
    await api.post(`/api/consent/${token}`).send({ decision: 'grant' }).expect(409);
    await api.post(`/api/consent/${token}`).send({ decision: 'deny' }).expect(409);
    const [p] = await db.select().from(profiles).where(eq(profiles.id, u.id));
    expect(p!.consentStatus).toBe('granted');
    const [c] = await db.select().from(parentalConsents).where(eq(parentalConsents.userId, u.id));
    expect(c!.decidedAt).not.toBeNull();
    const me = await api.get('/api/me').set(u.headers).expect(200);
    expect(me.body.consentDecidedAt).toBeTruthy();
  });

  it('revoke only works after a grant, and a revoked account cannot be re-asked', async () => {
    const { u, token } = await pendingTeen();
    await api.post(`/api/consent/${token}`).send({ decision: 'revoke' }).expect(409);
    await api.post(`/api/consent/${token}`).send({ decision: 'grant' }).expect(200);
    const res = await api.post(`/api/consent/${token}`).send({ decision: 'revoke' }).expect(200);
    expect(res.body.status).toBe('revoked');
    await api.post(`/api/consent/${token}`).send({ decision: 'grant' }).expect(409);
    await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'p@example.com' })
      .expect(409);
  });

  it('a declined request locks the account but the teen may ask again', async () => {
    const { u, token } = await pendingTeen();
    await api.post(`/api/consent/${token}`).send({ decision: 'deny' }).expect(200);
    const [p] = await db.select().from(profiles).where(eq(profiles.id, u.id));
    expect(p!.consentStatus).toBe('revoked');
    await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'other@example.com' })
      .expect(200);
    const [p2] = await db.select().from(profiles).where(eq(profiles.id, u.id));
    expect(p2!.consentStatus).toBe('pending');
  });

  it('a newer email replaces the older link', async () => {
    const { u, token } = await pendingTeen();
    await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'dad@example.com' })
      .expect(200);
    await api.get(`/api/consent/${token}`).expect(404);
    await api.get(`/api/consent/${tokenOf()}`).expect(200);
  });

  it('missing, malformed and expired links all answer the same generic 404', async () => {
    const { token } = await pendingTeen();
    await db.update(parentalConsents).set({ expiresAt: new Date(Date.now() - 1000) });
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    const expired = await api.get(`/api/consent/${token}`);
    const missing = await api.get(`/api/consent/${'A'.repeat(43)}`);
    const junk = await api.get('/api/consent/x');
    for (const r of [expired, missing, junk]) expect(r.status).toBe(404);
    expect(strip(expired.body)).toEqual(strip(missing.body));
    expect(strip(junk.body)).toEqual(strip(missing.body));
    const post = await api.post(`/api/consent/${token}`).send({ decision: 'grant' });
    expect(post.status).toBe(404);
    expect(strip(post.body)).toEqual(strip(missing.body));
  });

  it('a granted link stays usable for withdrawing approval after 7 days', async () => {
    const { token } = await pendingTeen();
    await api.post(`/api/consent/${token}`).send({ decision: 'grant' }).expect(200);
    await db.update(parentalConsents).set({ expiresAt: new Date(Date.now() - 1000) });
    await api.post(`/api/consent/${token}`).send({ decision: 'revoke' }).expect(200);
  });

  it('rate-limits to 3 emails per teen per day', async () => {
    const u = await newUser();
    await ageAs(u, 15).expect(200);
    for (const n of [1, 2, 3]) {
      await api
        .post('/api/me/consent')
        .set(u.headers)
        .send({ parentEmail: `p${n}@example.com` })
        .expect(200);
    }
    const res = await api
      .post('/api/me/consent')
      .set(u.headers)
      .send({ parentEmail: 'p4@example.com' });
    expect(res.status).toBe(429);
    expect(outbox).toHaveLength(3);
  });

  it('rate-limits the public link per IP', async () => {
    const limited = testApi({ consentIpLimit: 3 });
    const path = `/api/consent/${'B'.repeat(43)}`;
    for (let i = 0; i < 3; i++) await limited.get(path).expect(404);
    await limited.get(path).expect(429);
  });

  it('refuses the teen own email and bad addresses', async () => {
    const u = await newUser();
    await ageAs(u, 15).expect(200);
    await api.post('/api/me/consent').set(u.headers).send({ parentEmail: u.email }).expect(400);
    await api.post('/api/me/consent').set(u.headers).send({ parentEmail: 'nope' }).expect(400);
    expect(outbox).toHaveLength(0);
  });
});

describe('teen enrichment: no third parties', () => {
  let fake: FakeAi;
  beforeEach(() => {
    fake = installFakeAi();
  });
  afterAll(() => {
    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
  });
  const BODY = Array.from(
    { length: 40 },
    () => 'I walked with Maya and thought about my running goal.',
  ).join(' ');

  async function run(mode: 'teen' | 'adult') {
    const u = await newUser();
    await db
      .update(profiles)
      .set({
        mode,
        ageBand: mode === 'teen' ? '13-15' : '18+',
        consentStatus: mode === 'teen' ? 'granted' : 'not_required',
      })
      .where(eq(profiles.id, u.id));
    const e = await seedEntry(u.id, { title: 'Walk', body: BODY });
    fake.generateCalls = [];
    fake.replies.enrich = () =>
      enrichReply({
        memoryOps: [
          { op: 'create', kind: 'person', content: 'Maya is your friend.', confidence: 0.9 },
          { op: 'create', kind: 'goal', content: 'You want to run a 10k.', confidence: 0.9 },
        ],
        entities: [
          { name: 'Maya', kind: 'person' },
          { name: 'running', kind: 'goal' },
        ],
        relations: [{ from: 'Maya', to: 'running' }],
      });
    await enrichEntry({ entryId: e.id, userId: u.id, version: e.version });
    return u;
  }

  it('drops person memories and nodes and tells the model so', async () => {
    const u = await run('teen');
    const mems = await db.select().from(memories).where(eq(memories.userId, u.id));
    expect(mems.map((m) => m.kind)).toEqual(['goal']);
    const nodes = await db.select().from(graphNodes).where(eq(graphNodes.userId, u.id));
    expect(nodes.map((n) => n.kind)).toEqual(['goal']);
    expect(fake.generateCalls[0]!.system).toContain('This writer is a teenager');
  });

  it('adults are unchanged', async () => {
    const u = await run('adult');
    const mems = await db.select().from(memories).where(eq(memories.userId, u.id));
    expect(mems.map((m) => m.kind).sort()).toEqual(['goal', 'person']);
    expect(fake.generateCalls[0]!.system).not.toContain('This writer is a teenager');
  });
});
