/**
 * The memory constellation: entities mentioned in entries and how often they co-occur.
 * Re-extracting an entry is idempotent — a node's weight grows only the first time a
 * given entry is linked to it (graph_node_sources), and an edge only when at least one of
 * its ends is newly linked. All counters are atomic SQL increments, never read-modify-write.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { GRAPH_KINDS, type Graph, type GraphKind } from '@solace/shared';
import { generateJson, type AiOptions } from '../ai/gemini';
import { DATA_POLICY, dataBlock } from '../ai/untrusted';
import { db } from '../db/client';
import { graphEdges, graphNodeSources, graphNodes } from '../db/schema';

export const GRAPH_NODE_LIMIT = 80;
const MAX_ENTITIES = 12;

export type Entity = { name: string; kind: GraphKind };

const entitiesSchema = z.object({
  entities: z.array(z.object({ name: z.string(), kind: z.enum(GRAPH_KINDS) })).max(30),
});

const SYSTEM = `You pick out what a private journal entry is about, for a personal "constellation" map. Return {"entities": [{"name", "kind"}]} with at most ${MAX_ENTITIES} items.
Kinds: person (by the name or role the writer uses, e.g. "Maya", "my manager"), place, project, goal, habit, emotion (a feeling the writer actually expresses, e.g. "anxiety", "relief").
Use the writer's own wording, 1-4 words, singular. Skip generic words ("today", "stuff", "work" unless it is clearly a theme), and never invent entities.
${DATA_POLICY}`;

/** Trim, collapse whitespace, bound length; de-duplicate on (key, kind). */
export function normalizeEntities(raw: Entity[]): Array<Entity & { key: string }> {
  const seen = new Set<string>();
  const out: Array<Entity & { key: string }> = [];
  for (const e of raw) {
    const name = e.name
      .replace(/[‹›<>"]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    const key = name.toLowerCase();
    if (!key || seen.has(`${key}|${e.kind}`)) continue;
    seen.add(`${key}|${e.kind}`);
    out.push({ name, kind: e.kind, key });
    if (out.length === MAX_ENTITIES) break;
  }
  return out;
}

export async function extractEntities(
  input: { userId: string; entryDate: string; title: string; text: string },
  opts: AiOptions = {},
): Promise<Entity[]> {
  const out = await generateJson(
    entitiesSchema,
    {
      system: SYSTEM,
      temperature: 0.1,
      user: dataBlock(
        'entry',
        { date: input.entryDate },
        `${input.title}\n\n${input.text}`,
        12_000,
      ),
    },
    { ...opts, userId: input.userId },
  );
  return out.entities;
}

/** Upsert the entry's entities and co-occurrence edges in one transaction. */
export async function recordEntities(
  userId: string,
  entryId: string,
  raw: Entity[],
): Promise<void> {
  // A stable order means concurrent transactions lock rows in the same sequence (no deadlocks).
  const entities = normalizeEntities(raw).sort((a, b) =>
    a.key === b.key ? a.kind.localeCompare(b.kind) : a.key < b.key ? -1 : 1,
  );
  if (entities.length === 0) return;

  await db.transaction(async (tx) => {
    const nodes = await tx
      .insert(graphNodes)
      .values(entities.map((e) => ({ userId, name: e.name, key: e.key, kind: e.kind })))
      .onConflictDoUpdate({
        target: [graphNodes.userId, graphNodes.key, graphNodes.kind],
        set: { updatedAt: sql`now()` },
      })
      .returning({ id: graphNodes.id, inserted: sql<boolean>`(xmax = 0)` });

    const linked = await tx
      .insert(graphNodeSources)
      .values(nodes.map((n) => ({ nodeId: n.id, entryId })))
      .onConflictDoNothing()
      .returning({ nodeId: graphNodeSources.nodeId });
    const newlyLinked = new Set(linked.map((l) => l.nodeId));

    // Freshly inserted nodes already start at weight 1 for this entry.
    const bump = nodes.filter((n) => newlyLinked.has(n.id) && !n.inserted).map((n) => n.id);
    if (bump.length) {
      await tx
        .update(graphNodes)
        .set({ weight: sql`${graphNodes.weight} + 1` })
        .where(and(eq(graphNodes.userId, userId), inArray(graphNodes.id, bump)));
    }

    const pairs: Array<{ userId: string; source: string; target: string }> = [];
    const ids = nodes.map((n) => n.id).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (newlyLinked.has(ids[i]!) || newlyLinked.has(ids[j]!)) {
          pairs.push({ userId, source: ids[i]!, target: ids[j]! });
        }
      }
    }
    if (pairs.length) {
      await tx
        .insert(graphEdges)
        .values(pairs)
        .onConflictDoUpdate({
          target: [graphEdges.source, graphEdges.target],
          set: { weight: sql`${graphEdges.weight} + 1`, updatedAt: sql`now()` },
        });
    }
  });
}

export async function extractGraph(
  input: { userId: string; entryId: string; entryDate: string; title: string; text: string },
  opts: AiOptions = {},
): Promise<void> {
  await recordEntities(input.userId, input.entryId, await extractEntities(input, opts));
}

export async function getGraph(userId: string): Promise<Graph> {
  const nodes = await db
    .select({
      id: graphNodes.id,
      name: graphNodes.name,
      kind: graphNodes.kind,
      weight: graphNodes.weight,
    })
    .from(graphNodes)
    .where(eq(graphNodes.userId, userId))
    .orderBy(desc(graphNodes.weight), desc(graphNodes.updatedAt))
    .limit(GRAPH_NODE_LIMIT);
  if (nodes.length === 0) return { nodes: [], edges: [] };
  const ids = nodes.map((n) => n.id);
  const edges = await db
    .select({ source: graphEdges.source, target: graphEdges.target, weight: graphEdges.weight })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.userId, userId),
        inArray(graphEdges.source, ids),
        inArray(graphEdges.target, ids),
      ),
    );
  return { nodes, edges };
}
