import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { CAPSULE_LIMITS, capsule as capsuleSchema } from '@solace/shared';
import { db } from '../../src/db/client';
import { capsules } from '../../src/db/schema';
import { createCapsule, openCapsule } from '../../src/services/capsules';
import { seedUser } from '../ai/seed';
import { resetDb, testApi, type TestUser } from '../helpers';

const api = testApi();
beforeEach(resetDb);

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const SECRET = 'the secret body text';

async function make(u: TestUser, unlockAt = inHours(48)) {
  const res = await api
    .post('/api/capsules')
    .set(u.headers)
    .send({ title: 'Hello future me', body: SECRET, unlockAt });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return capsuleSchema.parse(res.body);
}

/** A capsule already past its unlock time (bypasses the lead-time rule). */
async function makeUnlocked(u: TestUser) {
  const c = await make(u);
  await db
    .update(capsules)
    .set({ unlockAt: new Date(Date.now() - 1000) })
    .where(eq(capsules.id, c.id));
  return c;
}

describe('capsules', () => {
  it('seals on create and never leaks the body', async () => {
    const u = await seedUser();
    const c = await make(u);
    expect(c.status).toBe('sealed');
    expect(c.body).toBeNull();
    const list = await api.get('/api/capsules').set(u.headers);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    expect(list.body.items[0].status).toBe('sealed');
  });

  it('refuses to open before unlock with 409 capsule_sealed and no body', async () => {
    const u = await seedUser();
    const c = await make(u);
    const res = await api.post(`/api/capsules/${c.id}/open`).set(u.headers);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('capsule_sealed');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('enforces lead-time bounds with a field error', async () => {
    const u = await seedUser();
    for (const unlockAt of [
      inHours(CAPSULE_LIMITS.minLeadHours - 1),
      inHours(26 * 365 * 24),
      inHours(-5),
    ]) {
      const res = await api
        .post('/api/capsules')
        .set(u.headers)
        .send({ title: 't', body: 'b', unlockAt });
      expect(res.status).toBe(400);
      expect(res.body.fields?.unlockAt).toBeTruthy();
    }
    await make(u, inHours(CAPSULE_LIMITS.minLeadHours + 1));
    await make(u, inHours(24 * 365 * 24));
  });

  it('shows ready (body hidden) after unlock, then opens once and is idempotent', async () => {
    const u = await seedUser();
    const c = await makeUnlocked(u);
    const list = await api.get('/api/capsules').set(u.headers);
    expect(list.body.items[0].status).toBe('ready');
    expect(list.body.items[0].body).toBeNull();

    const first = await api.post(`/api/capsules/${c.id}/open`).set(u.headers);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('opened');
    expect(first.body.body).toBe(SECRET);
    const second = await api.post(`/api/capsules/${c.id}/open`).set(u.headers);
    expect(second.body.openedAt).toBe(first.body.openedAt);
    expect(second.body.body).toBe(SECRET);
    const after = await api.get('/api/capsules').set(u.headers);
    expect(after.body.items[0].body).toBe(SECRET);
  });

  it('lists newest first', async () => {
    const u = await seedUser();
    const a = await make(u);
    const b = await make(u);
    const list = await api.get('/api/capsules').set(u.headers);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
  });

  it('delete is idempotent, own-only, and leaves nothing behind', async () => {
    const u = await seedUser();
    const other = await seedUser();
    const c = await make(u);
    expect((await api.delete(`/api/capsules/${c.id}`).set(other.headers)).status).toBe(204);
    expect((await api.get('/api/capsules').set(u.headers)).body.items).toHaveLength(1);
    expect((await api.delete(`/api/capsules/${c.id}`).set(u.headers)).status).toBe(204);
    expect((await api.delete(`/api/capsules/${c.id}`).set(u.headers)).status).toBe(204);
    expect((await api.delete('/api/capsules/not-a-uuid').set(u.headers)).status).toBe(204);
    const list = await api.get('/api/capsules').set(u.headers);
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    expect(list.body.items).toHaveLength(0);
    expect((await api.post(`/api/capsules/${c.id}/open`).set(u.headers)).status).toBe(404);
  });

  it('isolates users on list and open', async () => {
    const u = await seedUser();
    const other = await seedUser();
    const c = await makeUnlocked(u);
    expect((await api.get('/api/capsules').set(other.headers)).body.items).toEqual([]);
    expect((await api.post(`/api/capsules/${c.id}/open`).set(other.headers)).status).toBe(404);
    const mine = await api.get('/api/capsules').set(u.headers);
    expect(mine.body.items[0].openedAt).toBeNull();
  });

  it('requires auth', async () => {
    expect((await api.get('/api/capsules')).status).toBe(401);
  });

  it('handles a concurrent double open', async () => {
    const u = await seedUser();
    const c = await createCapsule(u.id, { title: 't', body: 'b', unlockAt: inHours(30) });
    const later = new Date(Date.now() + 40 * 3_600_000);
    const [x, y] = await Promise.all([
      openCapsule(u.id, c.id, later),
      openCapsule(u.id, c.id, later),
    ]);
    expect(x.openedAt).toBe(y.openedAt);
    expect(x.body).toBe('b');
  });
});
