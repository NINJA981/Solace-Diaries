/**
 * Background enrichment of journal entries, at a fixed AI cost of one generation request and
 * one embedding request per entry: pick related memories → one structured call (mood, tags,
 * summary, memory ops, entities, relations) → one embedding batch (passages + new memory
 * sentences) → one version-checked transaction → best-effort memories and graph. Also photo
 * description, which feeds the entry's searchable attachment text.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MOODS, countWords } from '@solace/shared';
import { AiUnavailableError } from '../ai/errors';
import {
  aiPausedMs,
  embedModel,
  embedTexts,
  generateJson,
  generateText,
  type AiOptions,
  type Lane,
} from '../ai/gemini';
import { DATA_POLICY, dataBlock, sanitize } from '../ai/untrusted';
import { db } from '../db/client';
import { attachments, entries, entryChunks, profiles } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { DeferJobError, JOB, PermanentJobError } from '../jobs/types';
import { logger } from '../logger';
import { getObject } from '../storage/index';
import { chunkEntry, type Chunk } from './chunker';
import {
  GRAPH_INSTRUCTIONS,
  entitySchema,
  recordEntities,
  relationSchema,
  type Entity,
  type Relation,
} from './graph';
import {
  MEMORY_INSTRUCTIONS,
  applyMemoryOps,
  memoryContext,
  opTexts,
  planMemoryOps,
  rawMemoryOp,
  type MemoryContext,
  type MemoryOp,
} from './memories';
import { consumeEnrichmentBudget, nextUtcDay, refundEnrichmentBudget } from './quota';

/** Below this many words there is nothing meaningful to analyze or embed. */
export const MIN_WORDS_FOR_AI = 4;
const MAX_TAGS = 6;
const MAX_DEFER_MS = 24 * 60 * 60_000;

type EntryRow = typeof entries.$inferSelect;

const enrichPayload = z.object({
  entryId: z.string().uuid(),
  userId: z.string().uuid(),
  version: z.number().int(),
});
const describePayload = z.object({ attachmentId: z.string().uuid(), userId: z.string().uuid() });

/**
 * Background AI runs on the server key, so each one spends from the user's daily
 * enrichment budget. When it is spent the job waits for the next UTC day (DeferJobError:
 * no failure, no retry backoff) and the entry simply stays 'pending' until then.
 */
async function spendBudgetOrDefer(userId: string, what: Record<string, string>): Promise<void> {
  if (await consumeEnrichmentBudget(userId)) return;
  const until = nextUtcDay();
  logger.info({ ...what, until: until.toISOString() }, 'enrichment budget spent; deferring');
  throw new DeferJobError(until, 'Daily enrichment budget spent');
}

/**
 * When Gemini has already said a model's quota is spent (see aiPausedMs), wait it out
 * before spending the person's budget on a request that would only be refused.
 */
function deferWhilePaused(lanes: Lane[], what: Record<string, string>): void {
  const wait = Math.min(MAX_DEFER_MS, Math.max(0, ...lanes.map((lane) => aiPausedMs(lane))));
  if (wait <= 0) return;
  const until = new Date(Date.now() + wait);
  logger.info({ ...what, until: until.toISOString() }, 'gemini quota spent; deferring');
  throw new DeferJobError(until, 'AI provider quota spent');
}

/**
 * A run Gemini refused with a 429 did no work: give the unit back, so the job's deferred
 * re-run (or a pause on the model) never drains the person's daily enrichment budget.
 */
async function refundIfRefused(userId: string, err: unknown): Promise<void> {
  if (!(err instanceof AiUnavailableError) || err.status !== 429) return;
  await refundEnrichmentBudget(userId).catch((e: unknown) =>
    logger.warn({ err: e }, 'could not refund enrichment budget'),
  );
}

function parsePayload<S extends z.ZodType>(schema: S, payload: unknown): z.output<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError(`Invalid job payload: ${parsed.error.message}`);
  return parsed.data;
}

// ───────────────────────── the enrichment call ─────────────────────────

/**
 * Keep the items that validate and drop the rest: one malformed memory op or entity must
 * not sink the mood, summary and passages (or cost a repair request).
 */
const validItems = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    // A list the model left out or wrote as null/an object is "nothing", not a failed answer.
    (v) => (Array.isArray(v) ? v : []),
    z
      .array(item.optional().catch(undefined))
      .transform((items) => items.filter((x): x is NonNullable<typeof x> => x !== undefined)),
  );

/** Background AI calls never sleep long on a 429: it is rethrown and the job is deferred. */
const JOB_INLINE_WAIT_MS = 2_000;

const enrichmentSchema = z.object({
  mood: z.enum(MOODS),
  tags: z.array(z.string()),
  summary: z.string().min(1),
  memoryOps: validItems(rawMemoryOp),
  entities: validItems(entitySchema),
  relations: validItems(relationSchema),
});

export type Analysis = { mood: (typeof MOODS)[number]; tags: string[]; summary: string };

/** Everything one enrichment call yields, already validated and mapped back from handles. */
export type EntryReading = {
  analysis: Analysis;
  memoryOps: MemoryOp[];
  entities: Entity[];
  relations: Relation[];
};

const ENRICH_SYSTEM = `You enrich one private journal entry for the person who wrote it. You receive the entry and the existing memories most related to it. Reply with one JSON object with these fields:
- mood: the single best fit from: ${MOODS.join(', ')}.
- tags: up to ${MAX_TAGS} short lowercase topic tags (1-2 words each, e.g. "work", "family", "sleep", "running") describing what the entry is about. No mood words, no full sentences.
- summary: exactly one gentle sentence in second person ("You…"), at most 30 words, describing what happened and how it felt. No advice, no judgement, no diagnosis.
${MEMORY_INSTRUCTIONS}
${GRAPH_INSTRUCTIONS}
${DATA_POLICY}`;

export function cleanTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const tag = t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 24);
    if (tag) out.add(tag);
    if (out.size === MAX_TAGS) break;
  }
  return [...out];
}

export function cleanSummary(summary: string): string {
  const flat = summary
    .replace(/[*_#`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > 280 ? `${flat.slice(0, 279)}…` : flat;
}

export function entryText(row: Pick<EntryRow, 'body' | 'attachmentText'>): string {
  const photos = row.attachmentText.trim();
  return photos ? `${row.body}\n\nPhotos:\n${photos}` : row.body;
}

/**
 * Teen accounts (13-17): the entry may only teach Solace about the writer's own goals,
 * habits and feelings, never about other people. Stated to the model and enforced below.
 */
export const TEEN_POLICY = `This writer is a teenager. Only record things about the writer themself: their own goals, habits, patterns and feelings. Never create or update a memory about another person (friends, family, teachers, classmates), never use the memory kind "person", and never list a person as an entity.`;

/** Server-side enforcement of TEEN_POLICY, whatever the model returned. */
export function restrictForTeen(reading: EntryReading): EntryReading {
  const people = new Set(
    reading.entities.filter((e) => e.kind === 'person').map((e) => e.name.toLowerCase()),
  );
  return {
    ...reading,
    memoryOps: reading.memoryOps.filter((op) => !(op.op === 'create' && op.kind === 'person')),
    entities: reading.entities.filter((e) => e.kind !== 'person'),
    relations: reading.relations.filter(
      (r) => !people.has(r.from.toLowerCase()) && !people.has(r.to.toLowerCase()),
    ),
  };
}

/**
 * The single generation request for an entry. The entry and memories travel as delimited
 * data blocks; memories carry handles (m1…), and only ops naming one of them survive.
 */
export async function analyzeEntry(
  row: EntryRow,
  context: MemoryContext,
  opts: AiOptions,
  teen = false,
): Promise<EntryReading> {
  const raw = await generateJson(
    enrichmentSchema,
    {
      task: 'enrich',
      system: teen ? `${ENRICH_SYSTEM}
${TEEN_POLICY}` : ENRICH_SYSTEM,
      temperature: 0.2,
      user: [
        `Existing memories related to this entry (${context.blocks.length}):`,
        context.blocks.join('\n') || '(none yet)',
        'New journal entry:',
        dataBlock('entry', { date: row.entryDate }, `${row.title}\n\n${entryText(row)}`, 12_000),
      ].join('\n\n'),
    },
    opts,
  );
  const reading: EntryReading = {
    analysis: { mood: raw.mood, tags: cleanTags(raw.tags), summary: cleanSummary(raw.summary) },
    memoryOps: planMemoryOps(raw.memoryOps, context.handles),
    entities: raw.entities,
    relations: raw.relations,
  };
  return teen ? restrictForTeen(reading) : reading;
}

// ───────────────────────── enrichEntry job ─────────────────────────

async function setStatus(
  userId: string,
  entryId: string,
  version: number,
  from: string,
  to: 'processing' | 'pending',
) {
  await db
    .update(entries)
    .set({ enrichmentStatus: to, updatedAt: sql`${entries.updatedAt}` })
    .where(
      and(
        eq(entries.id, entryId),
        eq(entries.userId, userId),
        eq(entries.version, version),
        sql`${entries.enrichmentStatus} = ${from}`,
      ),
    );
}

/**
 * Persist the result atomically, but only if the entry is still at `version`. Returns false
 * (quietly) when the entry changed meanwhile — the job for the newer version will redo it.
 * A user-chosen mood is never overwritten, and AI tags only fill an untagged entry.
 * `updated_at` is left alone: enrichment is not an edit.
 */
async function commit(
  row: EntryRow,
  analysis: Analysis | null,
  chunks: Chunk[],
  vectors: number[][],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ moodSource: entries.moodSource, tags: entries.tags })
      .from(entries)
      .where(
        and(
          eq(entries.id, row.id),
          eq(entries.userId, row.userId),
          eq(entries.version, row.version),
        ),
      )
      .for('update');
    if (!locked) return false;

    await tx
      .delete(entryChunks)
      .where(and(eq(entryChunks.entryId, row.id), eq(entryChunks.userId, row.userId)));
    if (chunks.length) {
      await tx.insert(entryChunks).values(
        chunks.map((c, i) => ({
          entryId: row.id,
          userId: row.userId,
          idx: c.idx,
          content: c.content,
          embedding: vectors[i]!,
          model: embedModel(),
          entryVersion: row.version,
        })),
      );
    }

    const userMood = locked.moodSource === 'user';
    await tx
      .update(entries)
      .set({
        ...(userMood
          ? {}
          : { mood: analysis?.mood ?? null, moodSource: analysis ? ('ai' as const) : null }),
        ...(analysis && locked.tags.length === 0 ? { tags: analysis.tags } : {}),
        summary: analysis?.summary ?? null,
        enrichedVersion: row.version,
        enrichmentStatus: 'ready',
        updatedAt: sql`${entries.updatedAt}`,
      })
      .where(and(eq(entries.id, row.id), eq(entries.userId, row.userId)));
    return true;
  });
}

export async function enrichEntry(payload: unknown, signal?: AbortSignal): Promise<void> {
  const p = parsePayload(enrichPayload, payload);
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, p.entryId), eq(entries.userId, p.userId)));
  if (!row) throw new PermanentJobError('Entry no longer exists');
  // Always enrich the entry as it is now: the payload's version may lag behind the row.

  const words = countWords(`${row.title} ${row.body} ${row.attachmentText}`);
  const needsAi = words >= MIN_WORDS_FOR_AI;
  if (needsAi) {
    try {
      deferWhilePaused(['enrich', 'embed'], { entryId: row.id });
      await spendBudgetOrDefer(row.userId, { entryId: row.id });
    } catch (err) {
      // A crash may have left it 'processing'; waiting for the budget is 'pending'.
      await setStatus(row.userId, row.id, row.version, 'processing', 'pending');
      throw err;
    }
  }

  await setStatus(row.userId, row.id, row.version, row.enrichmentStatus, 'processing');
  const ai: AiOptions = { userId: row.userId, signal, maxInlineWaitMs: JOB_INLINE_WAIT_MS };
  let committed: boolean;
  let reading: EntryReading | null = null;
  let opVectors: number[][] = [];
  try {
    if (!needsAi) {
      committed = await commit(row, null, [], []);
    } else {
      const chunks = chunkEntry({
        title: row.title,
        entryDate: row.entryDate,
        body: row.body,
        attachmentText: row.attachmentText,
      });
      const context = await memoryContext(row.userId, {
        id: row.id,
        text: `${row.title}\n${entryText(row)}`,
      });
      const [who] = await db
        .select({ mode: profiles.mode })
        .from(profiles)
        .where(eq(profiles.id, row.userId));
      reading = await analyzeEntry(row, context, ai, who?.mode === 'teen');
      // The passages and any new or corrected memory sentences share one embedding request.
      const vectors = await embedTexts(
        [...chunks.map((c) => c.embedText), ...opTexts(reading.memoryOps)],
        'RETRIEVAL_DOCUMENT',
        ai,
      );
      opVectors = vectors.slice(chunks.length);
      committed = await commit(row, reading.analysis, chunks, vectors.slice(0, chunks.length));
    }
  } catch (err) {
    // Let the UI show "pending" between retries rather than a stuck "processing".
    await setStatus(row.userId, row.id, row.version, 'processing', 'pending').catch(() => {});
    await refundIfRefused(row.userId, err);
    throw err;
  }
  if (!committed || !reading) return;

  // Best effort, no further AI calls: the entry is already analysed and searchable;
  // memories and graph can catch up on the next edit.
  const results = await Promise.allSettled([
    applyMemoryOps(row.userId, row.id, reading.memoryOps, opVectors),
    recordEntities(row.userId, row.id, reading.entities, reading.relations),
  ]);
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      logger.warn(
        { err: r.reason, entryId: row.id, step: i === 0 ? 'memories' : 'graph' },
        'post-enrichment step failed',
      );
    }
  }
}

/** Dead-lettered enrichment: the current content could not be enriched. */
export async function markEnrichmentFailed(payload: unknown): Promise<void> {
  const parsed = enrichPayload.safeParse(payload);
  if (!parsed.success) return;
  const { entryId, userId } = parsed.data;
  await db
    .update(entries)
    .set({ enrichmentStatus: 'failed', updatedAt: sql`${entries.updatedAt}` })
    .where(
      and(
        eq(entries.id, entryId),
        eq(entries.userId, userId),
        // Untouched only when the current version is already enriched and ready (a later job
        // succeeded). A re-run of an enriched version (e.g. after a photo change) that died
        // shows 'failed' too, rather than a 'pending'/'processing' that never resolves.
        sql`(${entries.enrichmentStatus} <> 'ready' or ${entries.enrichedVersion} is null or ${entries.enrichedVersion} < ${entries.version})`,
      ),
    );
}

// ───────────────────────── describeAttachment job ─────────────────────────

const PHOTO_SYSTEM = `You describe a photo attached to someone's private journal so it can be found by search later.
Write one or two plain, factual sentences: the main subjects, the setting and what is happening. Mention legible text only if it matters.
Do not guess who anyone is, or their name, age, ethnicity, health or other personal traits, and do not interpret meaning. Plain text only.`;

export async function describeAttachment(payload: unknown, signal?: AbortSignal): Promise<void> {
  const p = parsePayload(describePayload, payload);
  const [att] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, p.attachmentId), eq(attachments.userId, p.userId)));
  if (!att) throw new PermanentJobError('Attachment no longer exists');
  if (att.description) return;
  deferWhilePaused(['vision'], { attachmentId: att.id });
  await spendBudgetOrDefer(p.userId, { attachmentId: att.id });

  const bytes = await getObject(att.storagePath);
  const text = await generateText(
    {
      task: 'vision',
      system: PHOTO_SYSTEM,
      temperature: 0.2,
      maxOutputTokens: 200,
      user: [
        { inlineData: { mimeType: att.mime, data: bytes.toString('base64') } },
        { text: 'Describe this photo.' },
      ],
    },
    { userId: p.userId, signal, maxInlineWaitMs: JOB_INLINE_WAIT_MS },
  ).catch(async (err: unknown) => {
    await refundIfRefused(p.userId, err);
    throw err;
  });
  const description = sanitize(text.replace(/\s+/g, ' '), 400);

  await db.transaction(async (tx) => {
    await tx
      .update(attachments)
      .set({ description })
      .where(and(eq(attachments.id, att.id), eq(attachments.userId, p.userId)));
    const [entry] = await tx
      .update(entries)
      .set({
        attachmentText: sql`(select coalesce(string_agg(a.description, E'\n' order by a.created_at), '')
          from ${attachments} a where a.entry_id = ${att.entryId} and a.description is not null)`,
        updatedAt: sql`${entries.updatedAt}`,
      })
      .where(and(eq(entries.id, att.entryId), eq(entries.userId, p.userId)))
      .returning({ version: entries.version });
    if (!entry) return;
    await enqueue(
      tx,
      JOB.enrichEntry,
      { entryId: att.entryId, userId: p.userId, version: entry.version },
      { dedupeKey: `enrich:${att.entryId}` },
    );
  });
}
