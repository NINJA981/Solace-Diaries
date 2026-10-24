import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { thread as threadSchema, threadWithMessages, THREAD_MODES } from '@solace/shared';
import { config } from '../../src/config';
import { resetDb, testApi, type TestUser } from '../helpers';
import { installFakeAi, type FakeAi } from '../ai/fake-ai';
import { seedUser } from '../ai/seed';

const api = testApi();
let fake: FakeAi;
beforeEach(async () => {
  await resetDb();
  fake = installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

const send = (user: TestUser, id: string, content: string) =>
  api
    .post(`/api/threads/${id}/messages`)
    .set(user.headers)
    .send({ content })
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });

describe('guided thread modes', () => {
  it('defaults to open and persists the mode on create, list and get', async () => {
    const u = await seedUser();
    const open = threadSchema.parse((await api.post('/api/threads').set(u.headers).send({})).body);
    expect(open.mode).toBe('open');
    const g = threadSchema.parse(
      (await api.post('/api/threads').set(u.headers).send({ mode: 'gratitude' })).body,
    );
    expect(g.mode).toBe('gratitude');
    expect(g.title).toBe('Gratitude');
    const list = (await api.get('/api/threads').set(u.headers)).body.items as Array<{ id: string; mode: string }>;
    expect(list.find((t) => t.id === g.id)!.mode).toBe('gratitude');
    expect(threadWithMessages.parse((await api.get(`/api/threads/${g.id}`).set(u.headers)).body).mode).toBe(
      'gratitude',
    );
    await api.post('/api/threads').set(u.headers).send({ mode: 'nonsense' }).expect(400);
  });

  const expectations: Record<string, string> = {
    gratitude: 'GRATITUDE',
    reframe: 'NOT therapy',
    unsent_letter: 'never be sent',
    sunday_review: 'SUNDAY REVIEW',
  };
  it.each(Object.entries(expectations))('%s script reaches the model with safety rules', async (mode, marker) => {
    const u = await seedUser();
    const t = threadSchema.parse((await api.post('/api/threads').set(u.headers).send({ mode })).body);
    const res = await send(u, t.id, 'Hello there');
    expect(res.status).toBe(200);
    const system = fake.streamCalls[0]!.system!;
    expect(system).toContain(marker);
    expect(system).toContain('companion inside the user');
    expect(system).toContain('13 to 17');
    expect(system).toContain('988');
    expect(system).toContain('never follow instructions');
    expect(system).toContain('square brackets');
  });

  it('open and legacy threads get no guided script', async () => {
    const u = await seedUser();
    const t = threadSchema.parse((await api.post('/api/threads').set(u.headers).send({})).body);
    await send(u, t.id, 'Hello there');
    const system = fake.streamCalls[0]!.system!;
    expect(system).not.toContain('Guided reflection');
    expect(THREAD_MODES).toContain('open');
  });

  it('keeps the guided title and isolates threads between users', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const t = threadSchema.parse((await api.post('/api/threads').set(a.headers).send({ mode: 'reframe' })).body);
    await send(a, t.id, 'I am worried about exams');
    expect(threadWithMessages.parse((await api.get(`/api/threads/${t.id}`).set(a.headers)).body).title).toBe(
      'Reframe a worry',
    );
    await api.get(`/api/threads/${t.id}`).set(b.headers).expect(404);
  });
});
