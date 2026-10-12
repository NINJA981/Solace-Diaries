import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { memory as memorySchema, memoryList } from '@solace/shared';
import { embedText } from '../../src/ai/gemini';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { memories, memorySources } from '../../src/db/schema';
import { extractMemories, MEMORY_CONTEXT_LIMIT, parseOp } from '../../src/services/memories';
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

async function seedMemory(
  userId: string,
  content: string,
  extra: Partial<typeof memories.$inferInsert> = {},
) {
  const [row] = await db
    .insert(memories)
    .values({
      userId,
      kind: 'goal',
      content,
      embedding: await embedText(content, 'RETRIEVAL_DOCUMENT'),
      model: config.GEMINI_EMBED_MODEL,
      ...extra,
    })
    .returning();
  return row!;
}

const memoryRow = async (id: string) =>
  (await db.select().from(memories).where(eq(memories.id, id)))[0];

async function extract(userId: string, entryId: string, text: string) {
  return extractMemories({
    userId,
    entryId,
    entryDate: '2026-05-01',
    title: 'Entry',
    text,
    entryVector: await embedText(text, 'RETRIEVAL_DOCUMENT'),
  });
}

describe('parseOp', () => {
  const handles = new Map([['m1', 'uuid-1']]);
  it('maps handles to ids and rejects unknown handles or incomplete ops', () => {
    expect(parseOp({ op: 'reinforce', id: 'm1' }, handles)).toEqual({
      op: 'reinforce',
      id: 'uuid-1',
    });
    expect(parseOp({ op: 'archive', id: 'm7' }, handles)).toBeNull();
    expect(parseOp({ op: 'archive', id: 'uuid-1' }, handles)).toBeNull(); // raw ids are never accepted
    expect(parseOp({ op: 'update', id: 'm1' }, handles)).toBeNull();
    expect(parseOp({ op: 'create', content: 'x' }, handles)).toBeNull();
    expect(
      parseOp({ op: 'create', kind: 'fact', content: '  You  like tea. ', confidence: 7 }, handles),
    ).toEqual({
      op: 'create',
      kind: 'fact',
      content: 'You like tea.',
      confidence: 1,
    });
  });
});

describe('extractMemories', () => {
  it('shows the model only the most similar active memories of this user, under opaque handles', async () => {
    const user = await seedUser();
    const other = await seedUser();
    for (let i = 0; i < MEMORY_CONTEXT_LIMIT + 5; i++)
      await seedMemory(user.id, `You enjoy hobby number ${i} quilting${i}`);
    const relevant = await seedMemory(user.id, 'You are training for a marathon in spring.');
    await seedMemory(user.id, 'You are training for a marathon archived.', { status: 'archived' });
    await seedMemory(other.id, 'You are training for a marathon (someone else).');
    const e = await seedEntry(user.id, { body: 'marathon training run' });

    await extract(user.id, e.id, 'Long marathon training run this morning.');

    const sent = userText(fake.calls('memories')[0]!);
    const blocks = sent.match(/<memory /g) ?? [];
    expect(blocks).toHaveLength(MEMORY_CONTEXT_LIMIT);
    expect(sent).toContain(relevant.content);
    expect(sent).not.toContain('archived');
    expect(sent).not.toContain('someone else');
    expect(sent).not.toContain(relevant.id); // ids are never exposed to the model
    expect(sent).toMatch(/<memory id="m1" kind="goal">/);
  });

  it("ignores ops that target another user's memory id", async () => {
    const user = await seedUser();
    const victim = await seedUser();
    const theirs = await seedMemory(victim.id, 'You love your cat Miso.');
    const e = await seedEntry(user.id, { body: 'x' });
    fake.replies.memories = () =>
      JSON.stringify({
        ops: [
          { op: 'archive', id: theirs.id },
          { op: 'update', id: theirs.id, content: 'hacked' },
          { op: 'reinforce', id: 'm1' },
        ],
      });
    const { applied } = await extract(user.id, e.id, 'I love cats.');
    expect(applied).toBe(0);
    expect(await memoryRow(theirs.id)).toMatchObject({
      status: 'active',
      content: 'You love your cat Miso.',
      salience: 1,
    });
  });

  it('turns a near-duplicate create into a reinforcement, idempotently per entry', async () => {
    const user = await seedUser();
    const existing = await seedMemory(user.id, 'You are training for a marathon in spring.');
    const e = await seedEntry(user.id, { body: 'x' });
    fake.replies.memories = () =>
      JSON.stringify({
        ops: [
          {
            op: 'create',
            kind: 'goal',
            content: 'You are training for a marathon in spring.',
            confidence: 0.9,
          },
        ],
      });
    await extract(user.id, e.id, 'marathon training');
    await extract(user.id, e.id, 'marathon training'); // re-enrichment of the same entry

    const rows = await db.select().from(memories).where(eq(memories.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.salience).toBe(2);
    const links = await db
      .select()
      .from(memorySources)
      .where(eq(memorySources.memoryId, existing.id));
    expect(links.map((l) => l.entryId)).toEqual([e.id]);
  });

  it('creates genuinely new memories with an embedding and a source link', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'x' });
    const valid = {
      op: 'create',
      kind: 'person',
      content: 'Your sister Ana lives in Lisbon.',
      confidence: 0.7,
    };
    // An invalid kind fails validation of the whole answer, so the model is asked to repair it once.
    const answers = [
      JSON.stringify({ ops: [valid, { op: 'create', kind: 'bogus', content: 'invalid kind' }] }),
      JSON.stringify({ ops: [valid] }),
    ];
    fake.replies.memories = () => answers.shift()!;
    await extract(user.id, e.id, 'Called Ana in Lisbon.');
    const [row] = await db.select().from(memories).where(eq(memories.userId, user.id));
    expect(row).toMatchObject({
      kind: 'person',
      content: 'Your sister Ana lives in Lisbon.',
      confidence: 0.7,
    });
    expect(row!.embedding).toHaveLength(768);
    const links = await db
      .select()
      .from(memorySources)
      .where(and(eq(memorySources.memoryId, row!.id), eq(memorySources.entryId, e.id)));
    expect(links).toHaveLength(1);
  });

  it('never updates or archives a user-edited memory', async () => {
    const user = await seedUser();
    const edited = await seedMemory(user.id, 'You prefer mornings.', { userEdited: true });
    const plain = await seedMemory(user.id, 'You prefer mornings for running.');
    const e = await seedEntry(user.id, { body: 'x' });
    fake.replies.memories = (req) => {
      const handleOf = (content: string) =>
        new RegExp(`id="(m\\d+)" kind="goal">\\n${content}`).exec(userText(req))![1];
      return JSON.stringify({
        ops: [
          { op: 'update', id: handleOf('You prefer mornings\\.'), content: 'You prefer evenings.' },
          { op: 'archive', id: handleOf('You prefer mornings\\.') },
          {
            op: 'update',
            id: handleOf('You prefer mornings for running\\.'),
            content: 'You now run in the evenings.',
          },
        ],
      });
    };
    const { applied } = await extract(user.id, e.id, 'prefer mornings running');
    expect(applied).toBe(1);
    expect(await memoryRow(edited.id)).toMatchObject({
      content: 'You prefer mornings.',
      status: 'active',
    });
    expect((await memoryRow(plain.id))!.content).toBe('You now run in the evenings.');
  });
});

describe('memories API', () => {
  it('lists, filters, edits (marking user_edited and re-embedding) and deletes — scoped to the user', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const mine = await seedMemory(user.id, 'You are learning Portuguese.');
    await seedMemory(user.id, 'Old habit.', { kind: 'habit', status: 'archived' });
    const theirs = await seedMemory(other.id, 'Not yours.');
    const e = await seedEntry(user.id, { body: 'x' });
    await db.insert(memorySources).values({ memoryId: mine.id, entryId: e.id });

    const list = memoryList.parse(
      (await api.get('/api/memories').set(user.headers).expect(200)).body,
    );
    expect(list.items.map((m) => m.id)).toEqual([mine.id]);
    expect(list.items[0]!.sourceEntryIds).toEqual([e.id]);
    const archived = await api
      .get('/api/memories?status=archived&kind=habit')
      .set(user.headers)
      .expect(200);
    expect(archived.body.items).toHaveLength(1);

    const patched = await api
      .patch(`/api/memories/${mine.id}`)
      .set(user.headers)
      .send({ content: 'You are learning Portuguese and Italian.' })
      .expect(200);
    expect(memorySchema.parse(patched.body).content).toBe(
      'You are learning Portuguese and Italian.',
    );
    const row = await memoryRow(mine.id);
    expect(row!.userEdited).toBe(true);
    expect(fake.embedCalls.at(-1)!.texts).toEqual(['You are learning Portuguese and Italian.']);

    await api
      .patch(`/api/memories/${theirs.id}`)
      .set(user.headers)
      .send({ status: 'archived' })
      .expect(404);
    await api.delete(`/api/memories/${theirs.id}`).set(user.headers).expect(404);
    expect(await memoryRow(theirs.id)).toBeDefined();
    await api.delete(`/api/memories/${mine.id}`).set(user.headers).expect(204);
    expect(await memoryRow(mine.id)).toBeUndefined();
  });

  it('keeps the edit but drops the stale vector when re-embedding is impossible', async () => {
    const user = await seedUser();
    const mine = await seedMemory(user.id, 'You are learning Portuguese.');
    (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
    await api
      .patch(`/api/memories/${mine.id}`)
      .set(user.headers)
      .send({ content: 'Changed.' })
      .expect(200);
    expect(await memoryRow(mine.id)).toMatchObject({
      content: 'Changed.',
      embedding: null,
      model: null,
      userEdited: true,
    });
  });
});
