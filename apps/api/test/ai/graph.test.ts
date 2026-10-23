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
  type Relation,
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

const rel = (a: Entity, b: Entity): Relation => ({ from: a.name, to: b.name });

describe('recordEntities', () => {
  it('is idempotent when the same entry is re-recorded', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'x' });
    await recordEntities(user.id, e.id, [maya, river], [rel(maya, river)]);
    await recordEntities(user.id, e.id, [maya, river], [rel(maya, river)]);
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
    await recordEntities(user.id, a.id, [maya, river], [rel(maya, river)]);
    await recordEntities(user.id, b.id, [maya, river], [rel(river, maya)]);
    // Editing entry a adds "calm": only edges touching calm are new for a.
    await recordEntities(
      user.id,
      a.id,
      [maya, river, calm],
      [rel(maya, river), rel(maya, calm), rel(river, calm)],
    );
    expect(await nodesOf(user.id)).toEqual({
      'maya/person': 2,
      'the river/place': 2,
      'calm/emotion': 1,
    });
    const weights = (await edgesOf(user.id)).map((e) => e.weight).sort();
    expect(weights).toEqual([1, 1, 2]);
  });

  it('records a relation found on re-enrichment between nodes the entry already had', async () => {
    const user = await seedUser();
    const a = await seedEntry(user.id, { body: 'a' });
    await recordEntities(user.id, a.id, [maya, river], []);
    expect(await edgesOf(user.id)).toHaveLength(0);

    await recordEntities(user.id, a.id, [maya, river], [rel(maya, river)]);
    let edges = await edgesOf(user.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.weight).toBe(1);

    // Re-running changes nothing (never over-counted).
    await recordEntities(user.id, a.id, [maya, river], [rel(maya, river)]);
    edges = await edgesOf(user.id);
    expect(edges.map((e) => e.weight)).toEqual([1]);
    expect(await nodesOf(user.id)).toEqual({ 'maya/person': 1, 'the river/place': 1 });
  });

  it('joins only what the entry relates, among its own entities, once per pair', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'x' });
    await recordEntities(
      user.id,
      e.id,
      [maya, river, calm],
      [
        { from: ' maya ', to: 'THE RIVER' },
        { from: 'the river', to: 'Maya' },
        { from: 'Maya', to: 'Maya' },
        { from: 'Maya', to: 'Zorro' },
      ],
    );
    const edges = await edgesOf(user.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.weight).toBe(1);
    expect(await nodesOf(user.id)).toMatchObject({ 'calm/emotion': 1 }); // unrelated, still a node
  });

  it('keeps counts exact under concurrent upserts from many entries', async () => {
    const user = await seedUser();
    const list = await Promise.all(
      Array.from({ length: 8 }, () => seedEntry(user.id, { body: 'x' })),
    );
    await Promise.all(
      list.map((e) =>
        recordEntities(
          user.id,
          e.id,
          [calm, river, maya],
          [rel(calm, river), rel(river, maya), rel(maya, calm)],
        ),
      ),
    );
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
    await recordEntities(other.id, o.id, [maya, river], [rel(maya, river)]);
    const chain = (list: Entity[]) => list.slice(1).map((x, i) => rel(list[i]!, x));
    const many: Entity[] = Array.from({ length: 12 }, (_, i) => ({
      name: `thing ${i}`,
      kind: 'project',
    }));
    await recordEntities(user.id, e.id, many, chain(many));
    // Push enough extra nodes to exceed the limit.
    for (let i = 0; i < 8; i++) {
      const extra = await seedEntry(user.id, { body: 'x' });
      const extras = Array.from({ length: 12 }, (_, j) => ({
        name: `extra ${i}-${j}`,
        kind: 'habit' as const,
      }));
      await recordEntities(user.id, extra.id, extras, chain(extras));
    }
    await recordEntities(
      user.id,
      (await seedEntry(user.id, { body: 'x' })).id,
      [many[0]!, many[1]!],
      [rel(many[0]!, many[1]!)],
    );

    const res = await api.get('/api/memories/graph').set(user.headers).expect(200);
    const g = graphSchema.parse(res.body);
    expect(g.nodes).toHaveLength(GRAPH_NODE_LIMIT);
    expect(g.nodes[0]!.weight).toBe(2);
    expect(g.nodes.some((n) => n.name === 'Maya')).toBe(false);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.length).toBeGreaterThan(0);
    for (const edge of g.edges) expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
    expect(Math.max(...g.edges.map((x) => x.weight))).toBe(2); // thing 0 — thing 1, twice
  });
});
