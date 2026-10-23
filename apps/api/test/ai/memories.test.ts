import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { memory as memorySchema, memoryList } from '@solace/shared';
import { embedText } from '../../src/ai/gemini';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { entries, memories, memorySources } from '../../src/db/schema';
import { enrichEntry } from '../../src/services/enrichment';
import {
  MAX_MEMORY_OPS,
  MEMORY_CONTEXT_LIMIT,
  applyMemoryOps,
  parseOp,
  planMemoryOps,
  queryTerms,
} from '../../src/services/memories';
import { resetDb, testApi } from '../helpers';
import { enrichReply, installFakeAi, memoryHandles, userText, type FakeAi } from './fake-ai';
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

  it('keeps at most MAX_MEMORY_OPS valid ops, in order', () => {
    const raw = [
      { op: 'reinforce' as const, id: 'm9' },
      ...Array.from({ length: MAX_MEMORY_OPS + 2 }, (_, i) => ({
        op: 'create' as const,
        kind: 'fact' as const,
        content: `Fact ${i}.`,
      })),
    ];
    const ops = planMemoryOps(raw, handles);
    expect(ops).toHaveLength(MAX_MEMORY_OPS);
    expect(ops[0]).toMatchObject({ op: 'create', content: 'Fact 0.' });
  });

  it('matches on distinct words of three or more letters', () => {
    expect(queryTerms('Ran 5km with Maya, then ran home. Été!')).toEqual([
      'ran',
      '5km',
      'with',
      'maya',
      'then',
      'home',
      'été',
    ]);
  });
});

describe('memories in the enrichment call', () => {
  const enrich = (userId: string, entryId: string, version = 1) =>
    enrichEntry({ entryId, userId, version });
  const lastPrompt = () => userText(fake.calls('enrich').at(-1)!);
  /** Answer with these ops; `handle(content)` is the handle the model was shown for a memory. */
  const replyWith = (
    ops: (handle: (content: string) => string) => Array<Record<string, unknown>>,
  ) => {
    fake.replies.enrich = (req) => {
      const shown = [...memoryHandles(req)];
      return enrichReply({
        memoryOps: ops((c) => {
          const found = shown.find(([, text]) => text === c)?.[0];
          if (!found) throw new Error(`the model was not shown the memory "${c}"`);
          return found;
        }),
      });
    };
  };

  it('shows the model only related active memories of this user, under opaque handles', async () => {
    const user = await seedUser();
    const other = await seedUser();
    for (let i = 0; i < MEMORY_CONTEXT_LIMIT + 5; i++)
      await seedMemory(user.id, `You enjoy hobby number ${i} quilting${i}`);
    const relevant = await seedMemory(user.id, 'You are training for a marathon in spring.');
    await seedMemory(user.id, 'You are training for a marathon archived.', { status: 'archived' });
    await seedMemory(other.id, 'You are training for a marathon (someone else).');
    const e = await seedEntry(user.id, { body: 'Long marathon training run this morning.' });

    await enrich(user.id, e.id);

    const sent = lastPrompt();
    expect(sent.match(/<memory /g)).toHaveLength(MEMORY_CONTEXT_LIMIT);
    expect(sent).toMatch(
      /<memory id="m1" kind="goal">\nYou are training for a marathon in spring\./,
    );
    expect(sent).not.toContain('archived');
    expect(sent).not.toContain('someone else');
    expect(sent).not.toContain(relevant.id); // ids are never exposed to the model
  });

  it('picks memories by meaning once an earlier version of the entry was embedded', async () => {
    const user = await seedUser();
    for (let i = 0; i < MEMORY_CONTEXT_LIMIT + 1; i++)
      await seedMemory(user.id, `You enjoy hobby number ${i} quilting${i}`, { salience: 5 });
    await seedMemory(user.id, 'You love the lighthouse keeper and his painted boats.');
    const e = await seedEntry(user.id, {
      body: 'Spent the afternoon with the lighthouse keeper painting boats.',
    });
    await enrich(user.id, e.id);
    // The new text shares no words with the memory: only the stored passages lead to it.
    await db
      .update(entries)
      .set({ version: 2, body: 'Grey day. Rain on the window, tea going cold.' })
      .where(eq(entries.id, e.id));
    await enrich(user.id, e.id, 2);

    expect(lastPrompt()).toMatch(/<memory id="m1" kind="goal">\nYou love the lighthouse keeper/);
  });

  it("ignores ops that target another user's memory id", async () => {
    const user = await seedUser();
    const victim = await seedUser();
    const theirs = await seedMemory(victim.id, 'You love your cat Miso.');
    const e = await seedEntry(user.id, { body: 'I love cats, they are lovely.' });
    replyWith(() => [
      { op: 'archive', id: theirs.id },
      { op: 'update', id: theirs.id, content: 'hacked' },
      { op: 'reinforce', id: 'm1' },
    ]);
    await enrich(user.id, e.id);
    expect(await memoryRow(theirs.id)).toMatchObject({
      status: 'active',
      content: 'You love your cat Miso.',
      salience: 1,
    });
    expect(await db.select().from(memories).where(eq(memories.userId, user.id))).toHaveLength(0);
  });

  it('turns a near-duplicate create into a reinforcement, idempotently per entry', async () => {
    const user = await seedUser();
    const existing = await seedMemory(user.id, 'You are training for a marathon in spring.');
    const e = await seedEntry(user.id, { body: 'Marathon training went well today.' });
    replyWith(() => [
      {
        op: 'create',
        kind: 'goal',
        content: 'You are training for a marathon in spring.',
        confidence: 0.9,
      },
    ]);
    await enrich(user.id, e.id);
    await enrich(user.id, e.id); // the same version enriched again

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
    const e = await seedEntry(user.id, { body: 'Called Ana in Lisbon this evening.' });
    replyWith(() => [
      {
        op: 'create',
        kind: 'person',
        content: 'Your sister Ana lives in Lisbon.',
        confidence: 0.7,
      },
      { op: 'create', kind: 'bogus', content: 'An invalid kind is dropped, not repaired.' },
    ]);
    await enrich(user.id, e.id);
    expect(fake.calls('enrich')).toHaveLength(1);
    const rows = await db.select().from(memories).where(eq(memories.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'person',
      content: 'Your sister Ana lives in Lisbon.',
      confidence: 0.7,
    });
    expect(rows[0]!.embedding).toHaveLength(768);
    const links = await db
      .select()
      .from(memorySources)
      .where(and(eq(memorySources.memoryId, rows[0]!.id), eq(memorySources.entryId, e.id)));
    expect(links).toHaveLength(1);
  });

  it('never updates or archives a user-edited memory', async () => {
    const user = await seedUser();
    const edited = await seedMemory(user.id, 'You prefer mornings.', { userEdited: true });
    const plain = await seedMemory(user.id, 'You prefer mornings for running.');
    const e = await seedEntry(user.id, { body: 'I prefer mornings for running now.' });
    replyWith((handle) => [
      { op: 'update', id: handle('You prefer mornings.'), content: 'You prefer evenings.' },
      { op: 'archive', id: handle('You prefer mornings.') },
      {
        op: 'update',
        id: handle('You prefer mornings for running.'),
        content: 'You now run in the evenings.',
      },
    ]);
    await enrich(user.id, e.id);
    // Both memories reached the model, so the update/archive ops really hit the guard.
    expect([...memoryHandles(fake.calls('enrich')[0]!).values()]).toEqual(
      expect.arrayContaining(['You prefer mornings.', 'You prefer mornings for running.']),
    );
    expect(await memoryRow(edited.id)).toMatchObject({
      content: 'You prefer mornings.',
      status: 'active',
    });
    expect((await memoryRow(plain.id))!.content).toBe('You now run in the evenings.');
  });

  it('applies each op on its own: one failing op never stops the rest', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'x' });
    const applied = await applyMemoryOps(
      user.id,
      e.id,
      [
        { op: 'create', kind: 'fact', content: 'A broken vector.', confidence: 0.5 },
        { op: 'create', kind: 'fact', content: 'You like tea.', confidence: 0.6 },
      ],
      [[1, 2, 3], await embedText('You like tea.', 'RETRIEVAL_DOCUMENT')],
    );
    expect(applied).toBe(1);
    const rows = await db.select().from(memories).where(eq(memories.userId, user.id));
    expect(rows.map((r) => r.content)).toEqual(['You like tea.']);
    await expect(
      applyMemoryOps(user.id, e.id, [{ op: 'update', id: rows[0]!.id, content: 'x' }], []),
    ).rejects.toThrow(/one vector/);
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
