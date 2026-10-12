/**
 * Background enrichment of journal entries: analyze (mood, tags, summary) → chunk →
 * batch-embed → one version-checked transaction → best-effort memories and graph. Also
 * photo description, which feeds the entry's searchable attachment text.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MOODS, countWords } from '@solace/shared';
import { embedModel, embedTexts, generateJson, generateText, type AiOptions } from '../ai/gemini';
import { DATA_POLICY, dataBlock, sanitize } from '../ai/untrusted';
import { db } from '../db/client';
import { attachments, entries, entryChunks } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { JOB, PermanentJobError } from '../jobs/types';
import { logger } from '../logger';
import { getObject } from '../storage/index';
import { chunkEntry, type Chunk } from './chunker';
import { extractGraph } from './graph';
import { extractMemories } from './memories';

/** Below this many words there is nothing meaningful to analyze or embed. */
export const MIN_WORDS_FOR_AI = 4;
const MAX_TAGS = 6;

type EntryRow = typeof entries.$inferSelect;

const enrichPayload = z.object({
  entryId: z.string().uuid(),
  userId: z.string().uuid(),
  version: z.number().int(),
});
const describePayload = z.object({ attachmentId: z.string().uuid(), userId: z.string().uuid() });

function parsePayload<S extends z.ZodType>(schema: S, payload: unknown): z.output<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError(`Invalid job payload: ${parsed.error.message}`);
  return parsed.data;
}

// ───────────────────────── analysis ─────────────────────────

const analysisSchema = z.object({
  mood: z.enum(MOODS),
  tags: z.array(z.string()).max(12),
  summary: z.string().min(1),
});
export type Analysis = { mood: (typeof MOODS)[number]; tags: string[]; summary: string };

const ANALYZE_SYSTEM = `You read one private journal entry and return a light-touch analysis as JSON.
- mood: the single best fit from: ${MOODS.join(', ')}.
- tags: up to ${MAX_TAGS} short lowercase topic tags (1-2 words each, e.g. "work", "family", "sleep", "running") describing what the entry is about. No mood words, no full sentences.
- summary: exactly one gentle sentence in second person ("You…"), at most 30 words, describing what happened and how it felt. No advice, no judgement, no diagnosis.
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

export async function analyzeEntry(row: EntryRow, opts: AiOptions): Promise<Analysis> {
  const raw = await generateJson(
    analysisSchema,
    {
      system: ANALYZE_SYSTEM,
      temperature: 0.2,
      user: dataBlock(
        'entry',
        { date: row.entryDate },
        `${row.title}\n\n${entryText(row)}`,
        12_000,
      ),
    },
    opts,
  );
  return { mood: raw.mood, tags: cleanTags(raw.tags), summary: cleanSummary(raw.summary) };
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

function meanVector(vectors: number[][]): number[] {
  const out = new Array<number>(vectors[0]!.length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i]! += v[i]!;
  const norm = Math.hypot(...out) || 1;
  return out.map((x) => x / norm);
}

export async function enrichEntry(payload: unknown, signal?: AbortSignal): Promise<void> {
  const p = parsePayload(enrichPayload, payload);
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, p.entryId), eq(entries.userId, p.userId)));
  if (!row) throw new PermanentJobError('Entry no longer exists');
  // Always enrich the entry as it is now: the payload's version may lag behind the row.

  await setStatus(row.userId, row.id, row.version, row.enrichmentStatus, 'processing');
  const ai: AiOptions = { userId: row.userId, signal };
  let committed: boolean;
  let vectors: number[][] = [];
  try {
    const words = countWords(`${row.title} ${row.body} ${row.attachmentText}`);
    if (words < MIN_WORDS_FOR_AI) {
      committed = await commit(row, null, [], []);
    } else {
      const analysis = await analyzeEntry(row, ai);
      const chunks = chunkEntry({
        title: row.title,
        entryDate: row.entryDate,
        body: row.body,
        attachmentText: row.attachmentText,
      });
      vectors = await embedTexts(
        chunks.map((c) => c.embedText),
        'RETRIEVAL_DOCUMENT',
        ai,
      );
      committed = await commit(row, analysis, chunks, vectors);
    }
  } catch (err) {
    // Let the UI show "pending" between retries rather than a stuck "processing".
    await setStatus(row.userId, row.id, row.version, 'processing', 'pending').catch(() => {});
    throw err;
  }
  if (!committed || vectors.length === 0) return;

  // Best effort: the entry is already searchable; memories and graph can catch up next edit.
  const input = {
    userId: row.userId,
    entryId: row.id,
    entryDate: row.entryDate,
    title: row.title,
    text: entryText(row),
  };
  const results = await Promise.allSettled([
    extractMemories({ ...input, entryVector: meanVector(vectors) }, ai),
    extractGraph(input, ai),
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
        sql`(${entries.enrichedVersion} is null or ${entries.enrichedVersion} < ${entries.version})`,
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

  const bytes = await getObject(att.storagePath);
  const text = await generateText(
    {
      system: PHOTO_SYSTEM,
      temperature: 0.2,
      maxOutputTokens: 200,
      user: [
        { inlineData: { mimeType: att.mime, data: bytes.toString('base64') } },
        { text: 'Describe this photo.' },
      ],
    },
    { userId: p.userId, signal },
  );
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
