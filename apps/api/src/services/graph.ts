/**
 * The memory constellation: entities mentioned in entries, and the connections entries make
 * between them. Both come from the one enrichment call per entry (see enrichment.ts).
 * Re-recording an entry is idempotent — a node's weight grows only the first time a given
 * entry is linked to it (graph_node_sources), and an edge's weight only when at least one of
 * its ends is newly linked. A relation between two nodes the entry already had (a later
 * enrichment finding a connection the first one missed) still creates the edge if it does not
 * exist yet, but never raises the weight of an existing one: without per-entry edge
 * provenance (a table we do not have) that cannot be told apart from a re-run, so such an
 * edge may be one short. All counters are atomic SQL increments, never read-modify-write.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { GRAPH_KINDS, type Graph, type GraphKind } from '@solace/shared';
import { db } from '../db/client';
import { graphEdges, graphNodeSources, graphNodes } from '../db/schema';

export const GRAPH_NODE_LIMIT = 80;
export const MAX_ENTITIES = 12;
export const MAX_RELATIONS = 12;

export type Entity = { name: string; kind: GraphKind };
/** Two entities (by name) that one entry connects; undirected. */
export type Relation = { from: string; to: string };

export const entitySchema = z.object({ name: z.string(), kind: z.enum(GRAPH_KINDS) });
export const relationSchema = z.object({ from: z.string(), to: z.string() });

/** The graph part of the enrichment instructions (reply fields `entities` and `relations`). */
export const GRAPH_INSTRUCTIONS = `- entities: what the entry is about, for a personal "constellation" map: at most ${MAX_ENTITIES} items {"name","kind"}. Kinds: person (by the name or role the writer uses, e.g. "Maya", "my manager"), place, project, goal, habit, emotion (a feeling the writer actually expresses, e.g. "anxiety", "relief"). Use the writer's own wording, 1-4 words, singular. Skip generic words ("today", "stuff", "work" unless it is clearly a theme), and never invent entities.
- relations: pairs of your entities that this entry itself connects, as {"from":<entity name>,"to":<entity name>} using names exactly as in entities (e.g. a person and the place you went with them, or a habit and the goal it serves). At most ${MAX_RELATIONS}; an empty list is fine.`;

const nameKey = (name: string) => cleanName(name).toLowerCase();

function cleanName(name: string): string {
  return name
    .replace(/[‹›<>"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Trim, collapse whitespace, bound length; de-duplicate on (key, kind). */
export function normalizeEntities(raw: Entity[]): Array<Entity & { key: string }> {
  const seen = new Set<string>();
  const out: Array<Entity & { key: string }> = [];
  for (const e of raw) {
    const name = cleanName(e.name);
    const key = name.toLowerCase();
    if (!key || seen.has(`${key}|${e.kind}`)) continue;
    seen.add(`${key}|${e.kind}`);
    out.push({ name, kind: e.kind, key });
    if (out.length === MAX_ENTITIES) break;
  }
  return out;
}

/**
 * Upsert the entry's entities and the edges its relations name, in one transaction.
 * Relations may only join this entry's own entities; anything else is ignored.
 */
export async function recordEntities(
  userId: string,
  entryId: string,
  raw: Entity[],
  relations: Relation[] = [],
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
      .returning({ id: graphNodes.id, key: graphNodes.key, inserted: sql<boolean>`(xmax = 0)` });

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

    const all = edgePairs(nodes, relations);
    const fresh = all.filter(([a, b]) => newlyLinked.has(a) || newlyLinked.has(b));
    const known = all.filter(([a, b]) => !newlyLinked.has(a) && !newlyLinked.has(b));
    if (fresh.length) {
      await tx
        .insert(graphEdges)
        .values(fresh.map(([source, target]) => ({ userId, source, target })))
        .onConflictDoUpdate({
          target: [graphEdges.source, graphEdges.target],
          set: { weight: sql`${graphEdges.weight} + 1`, updatedAt: sql`now()` },
        });
    }
    if (known.length) {
      await tx
        .insert(graphEdges)
        .values(known.map(([source, target]) => ({ userId, source, target })))
        .onConflictDoNothing();
    }
  });
}

/**
 * Distinct undirected node-id pairs (source < target, sorted, so concurrent writers lock
 * edges in the same order) for the relations whose two ends are among this entry's nodes.
 */
function edgePairs(nodes: Array<{ id: string; key: string }>, relations: Relation[]) {
  const idsByKey = new Map<string, string[]>();
  for (const n of nodes) idsByKey.set(n.key, [...(idsByKey.get(n.key) ?? []), n.id]);
  const pairs = new Map<string, [string, string]>();
  for (const r of relations.slice(0, MAX_RELATIONS)) {
    for (const a of idsByKey.get(nameKey(r.from)) ?? []) {
      for (const b of idsByKey.get(nameKey(r.to)) ?? []) {
        if (a === b) continue;
        const pair: [string, string] = a < b ? [a, b] : [b, a];
        pairs.set(pair.join(), pair);
      }
    }
  }
  return [...pairs.values()].sort((x, y) => (x.join() < y.join() ? -1 : 1));
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
