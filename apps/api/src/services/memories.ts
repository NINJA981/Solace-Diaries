/**
 * Long-term memory: what the enrichment call may do to memories (bounded context, opaque
 * handles, per-op isolation, similarity de-dup) and the user-facing CRUD. Every statement is
 * scoped by user_id; ids the model returns are opaque handles we minted and map back ourselves.
 */
import { config } from '../config';
import { and, desc, eq, getTableColumns, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MEMORY_KINDS, type Memory, type MemoryKind, type UpdateMemoryInput } from '@solace/shared';
import { aiConfigured, aiPausedMs, embedModel, embedText, type AiOptions } from '../ai/gemini';
import { AiBadOutputError, AiUnavailableError } from '../ai/errors';
import { dataBlock } from '../ai/untrusted';
import { db, type DbOrTx } from '../db/client';
import { memories, memorySources } from '../db/schema';
import { HttpError } from '../http/errors';
import { logger } from '../logger';
import { consumeAiQuota } from './quota';

/** Existing memories shown to the model per entry — never the whole history. */
export const MEMORY_CONTEXT_LIMIT = 15;
/**
 * Of those, at most this many come from the entry's earlier passages. The rest are reserved
 * for memories matching the text being enriched now, so an edit that changes topic still
 * reaches the memories it is about.
 */
export const MEMORY_NEAR_LIMIT = 10;
/** A "new" memory this close to an existing one reinforces it instead. */
export const dedupeSimilarity = () => config.MEMORY_DEDUPE_SIMILARITY;
export const MAX_MEMORY_OPS = 8;

type MemoryRow = typeof memories.$inferSelect;

export const vectorLiteral = (v: number[]) => sql`${JSON.stringify(v)}::vector`;

// ───────────────────────── retrieval ─────────────────────────

export type ScoredMemory = { id: string; kind: MemoryKind; content: string; similarity: number };

/** Active memories nearest to `vector`, scoped to the user and the current embedding model. */
export async function similarMemories(
  userId: string,
  vector: number[],
  limit: number,
  minSimilarity = -1,
  q: DbOrTx = db,
  /** Kinds to leave out (teen accounts never see "person" memories, even legacy ones). */
  excludeKinds: readonly MemoryKind[] = [],
): Promise<ScoredMemory[]> {
  const v = vectorLiteral(vector);
  const rows = await q.execute<{
    id: string;
    kind: MemoryKind;
    content: string;
    similarity: number;
  }>(sql`
    select id, kind, content, 1 - (embedding <=> ${v}) as similarity
    from memories
    where user_id = ${userId} and status = 'active' and model = ${embedModel()} and embedding is not null
      ${excludeKinds.length ? sql`and kind not in (${sql.join(excludeKinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
    order by embedding <=> ${v}
    limit ${limit}`);
  return rows
    .map((r) => ({ ...r, similarity: Number(r.similarity) }))
    .filter((r) => r.similarity >= minSimilarity);
}

// ───────────────────────── context for the enrichment call ─────────────────────────

type ContextMemory = { id: string; kind: MemoryKind; content: string };

export type MemoryContext = {
  /** Handle (m1…m15) → memory id. Only ops naming one of these handles are ever applied. */
  handles: ReadonlyMap<string, string>;
  /** Delimited <memory> blocks for the prompt, labelled by handle, never by id. */
  blocks: string[];
};

/** Distinct words worth matching on (3+ letters or digits), capped to keep the query small. */
export function queryTerms(text: string, max = 400): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, max);
}

/** Active memories nearest the entry's stored passages (from an earlier enrichment). */
async function memoriesNearEntry(
  userId: string,
  entryId: string,
  limit: number,
): Promise<ContextMemory[]> {
  const rows = await db.execute<ContextMemory>(sql`
    with q as (
      select avg(embedding) as v from entry_chunks
      where entry_id = ${entryId} and user_id = ${userId} and model = ${embedModel()}
    )
    select m.id, m.kind, m.content
    from memories m, q
    where q.v is not null and m.user_id = ${userId} and m.status = 'active'
      and m.model = ${embedModel()} and m.embedding is not null
    order by m.embedding <=> q.v
    limit ${limit}`);
  return [...rows];
}

/** Active memories sharing the most words with `text`, then the most reinforced and recent. */
async function memoriesSharingWords(
  userId: string,
  text: string,
  limit: number,
  exclude: string[],
): Promise<ContextMemory[]> {
  if (limit <= 0) return [];
  const terms = queryTerms(text);
  const rank = terms.length
    ? sql`ts_rank(to_tsvector('english', ${memories.content}), websearch_to_tsquery('english', ${terms.join(' or ')}))`
    : sql`0`;
  return db
    .select({ id: memories.id, kind: memories.kind, content: memories.content })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.status, 'active'),
        exclude.length ? notInArray(memories.id, exclude) : undefined,
      ),
    )
    // No terms → no rank to sort by (a bare `order by 0` is a column position in Postgres).
    .orderBy(...(terms.length ? [desc(rank)] : []), desc(memories.salience), desc(memories.lastSeen))
    .limit(limit);
}

/**
 * The memories most related to an entry, at most MEMORY_CONTEXT_LIMIT. Picked without a
 * fresh embedding so a whole enrichment needs one embedding request: by meaning when an
 * earlier version of the entry was embedded, otherwise (and to fill up) by shared words,
 * salience and recency. A "create" that duplicates a memory not shown here still merges
 * into it (see `applyOp`).
 */
export async function memoryContext(
  userId: string,
  entry: { id: string; text: string },
): Promise<MemoryContext> {
  const near = await memoriesNearEntry(userId, entry.id, MEMORY_NEAR_LIMIT);
  const more = await memoriesSharingWords(
    userId,
    entry.text,
    MEMORY_CONTEXT_LIMIT - near.length,
    near.map((m) => m.id),
  );
  const picked = [...near, ...more];
  return {
    handles: new Map(picked.map((m, i) => [`m${i + 1}`, m.id])),
    blocks: picked.map((m, i) =>
      dataBlock('memory', { id: `m${i + 1}`, kind: m.kind }, m.content, 400),
    ),
  };
}

// ───────────────────────── ops ─────────────────────────

/** One op as the model writes it. Flat is easier for the model; `parseOp` checks the rest. */
export const rawMemoryOp = z.object({
  op: z.enum(['create', 'reinforce', 'update', 'archive']),
  id: z.string().optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  content: z.string().optional(),
  confidence: z.number().optional(),
});
type RawOp = z.infer<typeof rawMemoryOp>;

/** The memory part of the enrichment instructions (the reply field is `memoryOps`). */
export const MEMORY_INSTRUCTIONS = `- memoryOps: changes to a small set of long-term memories about the writer: durable facts, people, places, goals, habits, recurring patterns and feelings that will still matter weeks from now. The existing memories most related to this entry are given in <memory> blocks, each labelled with an id such as "m1".
  - {"op":"create","kind":<one of ${MEMORY_KINDS.join(', ')}>,"content":<one short sentence in second person, e.g. "You are training for a half marathon in May.">,"confidence":<0..1, how clearly the entry supports it>} for something durable that no existing memory covers.
  - {"op":"reinforce","id":<memory id>} when the entry supports an existing memory.
  - {"op":"update","id":<memory id>,"content":<corrected sentence>} when an existing memory is now outdated or imprecise.
  - {"op":"archive","id":<memory id>} only when the entry clearly shows an existing memory is no longer true.
  Use only ids from the <memory> blocks you were given. Skip trivia, one-off events and anything you would have to guess. Do not record sensitive inferences (health conditions, sexuality, religion, politics) unless the writer states them plainly as important to them. At most ${MAX_MEMORY_OPS} ops; an empty list is fine.`;

export type MemoryOp =
  | { op: 'create'; kind: MemoryKind; content: string; confidence: number }
  | { op: 'reinforce'; id: string }
  | { op: 'update'; id: string; content: string }
  | { op: 'archive'; id: string };

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.6));
const cleanContent = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

/** Validate one model op; handles not in `handles` (memories we didn't show) are rejected. */
export function parseOp(raw: RawOp, handles: ReadonlyMap<string, string>): MemoryOp | null {
  const content = raw.content ? cleanContent(raw.content) : '';
  if (raw.op === 'create') {
    if (!raw.kind || !content) return null;
    return { op: 'create', kind: raw.kind, content, confidence: clamp01(raw.confidence ?? 0.6) };
  }
  const id = raw.id ? handles.get(raw.id.trim()) : undefined;
  if (!id) return null;
  if (raw.op === 'update') return content ? { op: 'update', id, content } : null;
  return { op: raw.op, id };
}

/** The model's ops that are valid and name a memory we showed it, in order, at most MAX_MEMORY_OPS. */
export function planMemoryOps(raw: RawOp[], handles: ReadonlyMap<string, string>): MemoryOp[] {
  return raw.flatMap((r) => parseOp(r, handles) ?? []).slice(0, MAX_MEMORY_OPS);
}

/** What has to be embedded for these ops, in order: the content of every create and update. */
export function opTexts(ops: MemoryOp[]): string[] {
  return ops.flatMap((o) => (o.op === 'create' || o.op === 'update' ? [o.content] : []));
}

/**
 * Apply ops one by one; a failing op is logged and skipped, never aborting the rest.
 * `vectors` are the embeddings of `opTexts(ops)` (enrichment embeds them in the same
 * request as the entry's passages).
 */
export async function applyMemoryOps(
  userId: string,
  entryId: string,
  ops: MemoryOp[],
  vectors: number[][],
): Promise<number> {
  if (vectors.length !== opTexts(ops).length) {
    throw new Error('applyMemoryOps needs one vector per created or updated memory');
  }
  let v = 0;
  let applied = 0;
  for (const op of ops) {
    const vector = op.op === 'create' || op.op === 'update' ? vectors[v++]! : undefined;
    try {
      if (await applyOp(userId, entryId, op, vector)) applied++;
    } catch (err) {
      logger.warn({ err, op: op.op }, 'memory op failed');
    }
  }
  return applied;
}

async function applyOp(
  userId: string,
  entryId: string,
  op: MemoryOp,
  vector?: number[],
): Promise<boolean> {
  switch (op.op) {
    case 'create': {
      const [nearest] = await similarMemories(userId, vector!, 1, dedupeSimilarity());
      if (nearest) return reinforce(userId, entryId, nearest.id);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(memories)
          .values({
            userId,
            kind: op.kind,
            content: op.content,
            confidence: op.confidence,
            embedding: vector!,
            model: embedModel(),
          })
          .returning({ id: memories.id });
        await tx.insert(memorySources).values({ memoryId: row!.id, entryId }).onConflictDoNothing();
        return true;
      });
    }
    case 'reinforce':
      return reinforce(userId, entryId, op.id);
    case 'update': {
      const rows = await db
        .update(memories)
        .set({ content: op.content, embedding: vector!, model: embedModel(), lastSeen: sql`now()` })
        .where(
          and(
            eq(memories.id, op.id),
            eq(memories.userId, userId),
            eq(memories.userEdited, false),
            eq(memories.status, 'active'),
          ),
        )
        .returning({ id: memories.id });
      if (rows.length) await linkSource(db, userId, op.id, entryId);
      return rows.length > 0;
    }
    case 'archive': {
      const rows = await db
        .update(memories)
        .set({ status: 'archived' })
        .where(
          and(eq(memories.id, op.id), eq(memories.userId, userId), eq(memories.userEdited, false)),
        )
        .returning({ id: memories.id });
      return rows.length > 0;
    }
  }
}

/** Link (memory, entry) if the memory belongs to the user. Returns true when the link is new. */
async function linkSource(
  q: DbOrTx,
  userId: string,
  memoryId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await q.execute(sql`
    insert into memory_sources (memory_id, entry_id)
    select id, ${entryId} from memories where id = ${memoryId} and user_id = ${userId}
    on conflict do nothing
    returning memory_id`);
  return rows.length > 0;
}

/** Salience grows once per supporting entry, so re-enriching the same entry is idempotent. */
async function reinforce(userId: string, entryId: string, memoryId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await linkSource(tx, userId, memoryId, entryId))) return false;
    await tx
      .update(memories)
      .set({
        salience: sql`${memories.salience} + 1`,
        confidence: sql`least(1, ${memories.confidence} + 0.05)`,
        lastSeen: sql`now()`,
      })
      .where(and(eq(memories.id, memoryId), eq(memories.userId, userId)));
    return true;
  });
}

// ───────────────────────── CRUD ─────────────────────────

const withSources = {
  ...getTableColumns(memories),
  sourceEntryIds: sql<
    string[]
  >`coalesce(array_agg(${memorySources.entryId}) filter (where ${memorySources.entryId} is not null), '{}')`,
};
type MemoryWithSources = MemoryRow & { sourceEntryIds: string[] };

export function toMemory(row: MemoryWithSources): Memory {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    confidence: clamp01(row.confidence),
    status: row.status,
    sourceEntryIds: row.sourceEntryIds,
    firstSeen: row.firstSeen.toISOString(),
    lastSeen: row.lastSeen.toISOString(),
  };
}

export async function listMemories(
  userId: string,
  filter: { status: 'active' | 'archived'; kind?: MemoryKind },
): Promise<Memory[]> {
  const rows = await db
    .select(withSources)
    .from(memories)
    .leftJoin(memorySources, eq(memorySources.memoryId, memories.id))
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.status, filter.status),
        filter.kind ? eq(memories.kind, filter.kind) : undefined,
      ),
    )
    .groupBy(memories.id)
    .orderBy(desc(memories.salience), desc(memories.lastSeen))
    .limit(500);
  return rows.map(toMemory);
}

async function getMemory(userId: string, id: string): Promise<Memory | null> {
  const [row] = await db
    .select(withSources)
    .from(memories)
    .leftJoin(memorySources, eq(memorySources.memoryId, memories.id))
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .groupBy(memories.id);
  return row ? toMemory(row) : null;
}

/**
 * User edit. Marks the memory user_edited so the AI never overwrites it. New content is
 * re-embedded; if that isn't possible right now the old vector is dropped (the memory stays
 * listed but leaves semantic recall) rather than keeping a vector for text that no longer exists.
 */
export async function updateMemory(
  userId: string,
  id: string,
  input: UpdateMemoryInput,
  opts: AiOptions = {},
): Promise<Memory> {
  const [existing] = await db
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  if (!existing) throw new HttpError(404, 'Memory not found.', 'not_found');

  const patch: Partial<typeof memories.$inferInsert> = { userEdited: true };
  if (input.kind) patch.kind = input.kind;
  if (input.status) patch.status = input.status;
  if (input.content !== undefined && input.content !== existing.content) {
    patch.content = input.content;
    const vector = await embedEdited(userId, input.content, opts);
    patch.embedding = vector;
    patch.model = vector ? embedModel() : null;
  }
  await db
    .update(memories)
    .set(patch)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  return (await getMemory(userId, id))!;
}

async function embedEdited(
  userId: string,
  content: string,
  opts: AiOptions,
): Promise<number[] | null> {
  // Known to fail right now: keep the person's budget rather than spend it on a refusal.
  if (!aiConfigured(opts.apiKey) || aiPausedMs('embed', opts.apiKey) > 0) return null;
  try {
    await consumeAiQuota(userId, { usingOwnKey: Boolean(opts.apiKey) });
    return await embedText(content, 'RETRIEVAL_DOCUMENT', { ...opts, userId });
  } catch (err) {
    if (
      err instanceof AiUnavailableError ||
      err instanceof AiBadOutputError ||
      err instanceof HttpError
    ) {
      logger.warn({ err: (err as Error).message }, 'memory re-embed skipped');
      return null;
    }
    throw err;
  }
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}
