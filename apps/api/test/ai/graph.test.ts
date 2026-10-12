import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { graph as graphSchema } from '@solace/shared';
import { config } from '../../src/config';
import { db } from '../../src/db/client';
import { graphEdges, graphNodes } from '../../src/db/schema';
import {
  GRAPH_NODE_LIMIT,
  normalizeEntities,
  recordEntities,
  type Entity,
} from '../../src/services/graph';
import { resetDb, testApi } from '../helpers';
import { installFakeAi } from './fake-ai';
import { seedEntry, seedUser } from './seed';

const api = testApi();
beforeEach(async () => {
  await resetDb();
  installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

const nodesOf = async (userId: string) =>
  Object.fromEntries(
    (await db.select().from(graphNodes).where(eq(graphNodes.userId, userId))).map((n) => [
      `${n.key}/${n.kind}`,
      n.weight,
    ]),
  );
const edgesOf = (userId: string) =>
  db.select().from(graphEdges).where(eq(graphEdges.userId, userId));

const maya: Entity = { name: 'Maya', kind: 'person' };
const river: Entity = { name: 'the river', kind: 'place' };
const calm: Entity = { name: 'calm', kind: 'emotion' };

describe('normalizeEntities', () => {
  it('trims, bounds and de-duplicates on (key, kind)', () => {
    expect(
      normalizeEntities([
        { name: '  Maya ', kind: 'person' },
        { name: 'maya', kind: 'person' },
        { name: 'Maya', kind: 'project' },
        { name: '<b>', kind: 'place' },
      ]),
    ).toEqual([
      { name: 'Maya', key: 'maya', kind: 'person' },
      { name: 'Maya', key: 'maya', kind: 'project' },
      { name: 'b', key: 'b', kind: 'place' },
    ]);
  });
});

describe('recordEntities', () => {
  it('is idempotent when the same entry is re-extracted', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'x' });
    await recordEntities(user.id, e.id, [maya, river]);
    await recordEntities(user.id, e.id, [maya, river]);
    expect(await nodesOf(user.id)).toEqual({ 'maya/person': 1, 'the river/place': 1 });
    const edges = await edgesOf(user.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.weight).toBe(1);
    expect(edges[0]!.source < edges[0]!.target).toBe(true);
  });

  it('counts each supporting entry once and only adds edges for newly linked nodes', async () => {
    const user = await seedUser();
    const a = await seedEntry(user.id, { body: 'a' });
    const b = await seedEntry(user.id, { body: 'b' });
    await recordEntities(user.id, a.id, [maya, river]);
    await recordEntities(user.id, b.id, [maya, river]);
    // Editing entry a adds "calm": only edges touching calm are new for a.
    await recordEntities(user.id, a.id, [maya, river, calm]);
    expect(await nodesOf(user.id)).toEqual({
      'maya/person': 2,
      'the river/place': 2,
      'calm/emotion': 1,
    });
    const weights = (await edgesOf(user.id)).map((e) => e.weight).sort();
    expect(weights).toEqual([1, 1, 2]);
  });

  it('keeps counts exact under concurrent upserts from many entries', async () => {
    const user = await seedUser();
    const list = await Promise.all(
      Array.from({ length: 8 }, () => seedEntry(user.id, { body: 'x' })),
    );
    await Promise.all(list.map((e) => recordEntities(user.id, e.id, [calm, river, maya])));
    expect(await nodesOf(user.id)).toEqual({
      'maya/person': 8,
      'the river/place': 8,
      'calm/emotion': 8,
    });
    expect((await edgesOf(user.id)).map((e) => e.weight)).toEqual([8, 8, 8]);
  });
});

describe('GET /memories/graph', () => {
  it('returns the heaviest nodes and only edges among them, scoped to the user', async () => {
    const user = await seedUser();
    const other = await seedUser();
    const e = await seedEntry(user.id, { body: 'x' });
    const o = await seedEntry(other.id, { body: 'x' });
    await recordEntities(other.id, o.id, [maya, river]);
    const many: Entity[] = Array.from({ length: 12 }, (_, i) => ({
      name: `thing ${i}`,
      kind: 'project',
    }));
    await recordEntities(user.id, e.id, many);
    // Push enough extra nodes to exceed the limit.
    for (let i = 0; i < 8; i++) {
      const extra = await seedEntry(user.id, { body: 'x' });
      await recordEntities(
        user.id,
        extra.id,
        Array.from({ length: 12 }, (_, j) => ({ name: `extra ${i}-${j}`, kind: 'habit' as const })),
      );
    }
    await recordEntities(user.id, (await seedEntry(user.id, { body: 'x' })).id, [
      many[0]!,
      many[1]!,
    ]);

    const res = await api.get('/api/memories/graph').set(user.headers).expect(200);
    const g = graphSchema.parse(res.body);
    expect(g.nodes).toHaveLength(GRAPH_NODE_LIMIT);
    expect(g.nodes[0]!.weight).toBe(2);
    expect(g.nodes.some((n) => n.name === 'Maya')).toBe(false);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const edge of g.edges) expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
  });
});
