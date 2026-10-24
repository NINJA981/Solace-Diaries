import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, intention as intentionSchema, localDate } from '@solace/shared';
import { db } from '../../src/db/client';
import { intentionCheckins, memories } from '../../src/db/schema';
import { resetDb, testApi } from '../helpers';
import { seedUser } from '../ai/seed';

const api = testApi();
beforeEach(resetDb);

type U = Awaited<ReturnType<typeof seedUser>>;

async function mem(userId: string, o: Partial<typeof memories.$inferInsert> = {}) {
  const [m] = await db
    .insert(memories)
    .values({ userId, kind: 'goal', content: 'Run a 10k', salience: 1, ...o })
    .returning();
  return m!;
}

async function make(user: U, body: object = {}) {
  const res = await api
    .post('/api/intentions')
    .set(user.headers)
    .send({ title: 'Walk daily', kind: 'habit', cadence: 'daily', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return intentionSchema.parse(res.body);
}

describe('intentions CRUD', () => {
  it('creates, updates, lists (done last) and deletes', async () => {
    const u = await seedUser();
    const a = await make(u, { title: 'A' });
    expect(a.source).toBe('user');
    expect(a.checkins).toEqual([]);
    const b = await make(u, { title: 'B' });
    await api.patch(`/api/intentions/${a.id}`).set(u.headers).send({ status: 'done' }).expect(200);
    await api
      .patch(`/api/intentions/${b.id}`)
      .set(u.headers)
      .send({ title: 'B2', status: 'paused' })
      .expect(200);
    const list = await api.get('/api/intentions').set(u.headers).expect(200);
    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(['B2', 'A']);
    await api.delete(`/api/intentions/${a.id}`).set(u.headers).expect(204);
    const after = await api.get('/api/intentions').set(u.headers);
    expect(after.body.items).toHaveLength(1);
  });

  it('rejects invalid input', async () => {
    const u = await seedUser();
    await api.post('/api/intentions').set(u.headers).send({ title: '', kind: 'habit' }).expect(400);
    await api.post('/api/intentions').set(u.headers).send({ title: 'x', kind: 'nope' }).expect(400);
  });

  it('isolates users on every route', async () => {
    const u = await seedUser();
    const o = await seedUser();
    const mine = await make(u);
    const date = localDate(new Date(), 'UTC');
    await api.patch(`/api/intentions/${mine.id}`).set(o.headers).send({ title: 'x' }).expect(404);
    await api.delete(`/api/intentions/${mine.id}`).set(o.headers).expect(404);
    await api.post(`/api/intentions/${mine.id}/checkins`).set(o.headers).send({ date }).expect(404);
    await api.delete(`/api/intentions/${mine.id}/checkins/${date}`).set(o.headers).expect(404);
    await api.patch(`/api/intentions/${randomUUID()}`).set(o.headers).send({}).expect(404);
    expect((await api.get('/api/intentions').set(o.headers)).body.items).toEqual([]);
    expect((await api.get('/api/intentions').set(u.headers)).body.items).toHaveLength(1);
  });

  it('requires auth', async () => {
    await api.get('/api/intentions').expect(401);
  });
});

describe('detected suggestions', () => {
  it('lists only own active unadopted goal/habit memories, most reinforced first, max 5', async () => {
    const u = await seedUser();
    const o = await seedUser();
    const low = await mem(u.id, { content: 'Low', salience: 1 });
    const high = await mem(u.id, { kind: 'habit', content: 'High', salience: 9 });
    await mem(u.id, { content: 'Archived', status: 'archived', salience: 20 });
    await mem(u.id, { kind: 'person', content: 'Mum', salience: 30 });
    await mem(o.id, { content: 'Theirs', salience: 40 });
    const adopted = await mem(u.id, { content: 'Adopted', salience: 15 });
    await make(u, { title: 'Adopted', memoryId: adopted.id });
    let res = await api.get('/api/intentions/suggestions').set(u.headers).expect(200);
    expect(res.body.items).toEqual([
      { memoryId: high.id, title: 'High', kind: 'habit' },
      { memoryId: low.id, title: 'Low', kind: 'goal' },
    ]);
    for (let i = 0; i < 6; i++) await mem(u.id, { content: `m${i}`, salience: 2 });
    res = await api.get('/api/intentions/suggestions').set(u.headers);
    expect(res.body.items).toHaveLength(5);
  });

  it('trims titles to 120 chars', async () => {
    const u = await seedUser();
    await mem(u.id, { content: `  ${'x'.repeat(200)}` });
    const res = await api.get('/api/intentions/suggestions').set(u.headers);
    expect(res.body.items[0].title).toHaveLength(120);
  });

  it('adopting links the memory and marks it detected; bad memories are 400', async () => {
    const u = await seedUser();
    const o = await seedUser();
    const m = await mem(u.id);
    const i = await make(u, { memoryId: m.id });
    expect(i.source).toBe('detected');
    expect(i.memoryId).toBe(m.id);
    const post = (memoryId: string) =>
      api.post('/api/intentions').set(u.headers).send({ title: 't', kind: 'goal', memoryId });
    expect((await post(m.id)).status).toBe(400);
    expect((await post((await mem(o.id)).id)).status).toBe(400);
    expect((await post((await mem(u.id, { status: 'archived' })).id)).status).toBe(400);
    expect((await post((await mem(u.id, { kind: 'fact' })).id)).status).toBe(400);
    expect((await post(randomUUID())).status).toBe(400);
  });
});

describe('check-ins', () => {
  it('upserts one per date, newest first, and undo is idempotent', async () => {
    const u = await seedUser();
    const i = await make(u);
    const today = localDate(new Date(), 'UTC');
    const y = addDays(today, -1);
    const url = `/api/intentions/${i.id}/checkins`;
    await api.post(url).set(u.headers).send({ date: y }).expect(200);
    await api.post(url).set(u.headers).send({ date: today, note: 'a' }).expect(200);
    const again = await api.post(url).set(u.headers).send({ date: today, note: 'b' });
    expect(again.body.checkins).toEqual([
      { date: today, note: 'b' },
      { date: y, note: null },
    ]);
    const del = await api.delete(`${url}/${today}`).set(u.headers).expect(200);
    expect(del.body.checkins).toEqual([{ date: y, note: null }]);
    await api.delete(`${url}/${today}`).set(u.headers).expect(200);
    await api.delete(`${url}/garbage`).set(u.headers).expect(400);
  });

  it('enforces the date window in the user timezone', async () => {
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const u = await seedUser({ timezone: tz });
      const i = await make(u);
      const today = localDate(new Date(), tz);
      const post = (date: string) =>
        api.post(`/api/intentions/${i.id}/checkins`).set(u.headers).send({ date });
      expect((await post(today)).status).toBe(200);
      expect((await post(addDays(today, -7))).status).toBe(200);
      expect((await post(addDays(today, -8))).status).toBe(400);
      expect((await post(addDays(today, 1))).status).toBe(400);
    }
  });

  it('only returns check-ins from the last 90 days and carries no missed fields', async () => {
    const u = await seedUser();
    const i = await make(u);
    const today = localDate(new Date(), 'UTC');
    await db.insert(intentionCheckins).values([
      { intentionId: i.id, userId: u.id, date: addDays(today, -89) },
      { intentionId: i.id, userId: u.id, date: addDays(today, -90) },
    ]);
    const res = await api.get('/api/intentions').set(u.headers);
    expect(res.body.items[0].checkins.map((c: { date: string }) => c.date)).toEqual([
      addDays(today, -89),
    ]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'cadence',
      'checkins',
      'createdAt',
      'id',
      'kind',
      'memoryId',
      'source',
      'status',
      'title',
      'updatedAt',
    ]);
  });
});
