/**
 * Journal entries and their photo attachments. Every query is scoped by `userId`; a row
 * owned by someone else is indistinguishable from a missing one (404).
 */
import { randomUUID } from 'node:crypto';
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  countWords,
  ERROR_CODES,
  isoDate,
  LIMITS,
  localDate,
  uuid,
  type Attachment,
  type CreateEntryInput,
  type Entry,
  type EntryPage,
  type ListEntriesQuery,
  type UpdateEntryInput,
} from '@solace/shared';
import { db, type DbOrTx, type Tx } from '../db/client';
import {
  attachments,
  entries,
  graphNodeSources,
  graphNodes,
  jobs,
  memories,
  memorySources,
  prompts,
} from '../db/schema';
import { badRequest, conflict, HttpError, notFound } from '../http/errors';
import { enqueue } from '../jobs/queue';
import { JOB } from '../jobs/types';
import { logger } from '../logger';
import { deleteObjects, putObject, signUrls } from '../storage';
import type { ProcessedImage } from '../storage/image';
import { toAttachment, toEntry, toEntrySummary } from './entry-dto';
import { getTimezone } from './profiles';

/** Autosave fires every few seconds while typing; wait for a pause before re-enriching. */
const ENRICH_DEBOUNCE_MS = 20_000;

// Every entry column except the generated tsvector, which is large and never sent.
const { search: _search, ...entryColumns } = getTableColumns(entries);
const entryFields = { ...entryColumns, search: sql<string | null>`null` };
type EntryRow = typeof entries.$inferSelect;

const entryNotFound = () => notFound('Entry not found');
const ownEntry = (userId: string, id: string) =>
  and(eq(entries.id, id), eq(entries.userId, userId));
const uniqueTags = (tags: string[]) => [...new Set(tags)];

function enqueueEnrichment(
  tx: DbOrTx,
  row: Pick<EntryRow, 'id' | 'userId' | 'version'>,
  runAfter?: Date,
) {
  return enqueue(
    tx,
    JOB.enrichEntry,
    { entryId: row.id, userId: row.userId, version: row.version },
    { dedupeKey: `enrich:${row.id}`, ...(runAfter ? { runAfter } : {}) },
  );
}

async function attachmentsOf(userId: string, entryId: string): Promise<Attachment[]> {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entryId, entryId), eq(attachments.userId, userId)))
    .orderBy(attachments.createdAt);
  const urls = await signUrls(rows.map((r) => r.storagePath));
  return rows.map((r, i) => toAttachment(r, urls[i]!));
}

async function withAttachments(row: EntryRow): Promise<Entry> {
  return toEntry(row, await attachmentsOf(row.userId, row.id));
}

// ── listing ────────────────────────────────────────────────────────────

/**
 * Opaque keyset cursor over (entry_date, created_at, id). created_at travels as Postgres
 * text so its microseconds survive the round trip (a JS Date would truncate them).
 */
const pgTimestamp =
  /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?[+-](0\d|1[0-5])(:[0-5]\d)?$/;
/** Every part is range-checked, so a tampered cursor is a 400, never a Postgres error (500). */
const cursorTimestamp = z
  .string()
  .regex(pgTimestamp)
  .refine((ts) => isoDate.safeParse(ts.slice(0, 10)).success, 'Not a real date');
const cursorShape = z.tuple([isoDate, cursorTimestamp, uuid]);
type Cursor = z.infer<typeof cursorShape>;

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string): Cursor {
  try {
    return cursorShape.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw badRequest('Invalid cursor.', { cursor: 'Invalid cursor' });
  }
}

const createdAtText = sql<string>`${entries.createdAt}::text`;
const newestFirst = [desc(entries.entryDate), desc(entries.createdAt), desc(entries.id)];
const before = (c: Cursor) =>
  sql`(${entries.entryDate}, ${entries.createdAt}, ${entries.id}) < (${c[0]}::date, ${c[1]}::timestamptz, ${c[2]}::uuid)`;

export async function listEntries(userId: string, q: ListEntriesQuery): Promise<EntryPage> {
  const conds: (SQL | undefined)[] = [eq(entries.userId, userId)];
  if (q.from) conds.push(gte(entries.entryDate, q.from));
  if (q.to) conds.push(lte(entries.entryDate, q.to));
  if (q.mood) conds.push(eq(entries.mood, q.mood));
  if (q.tag?.trim()) conds.push(arrayContains(entries.tags, [q.tag.trim().toLowerCase()]));
  if (q.cursor) conds.push(before(decodeCursor(q.cursor)));

  const rows = await db
    .select({
      ...entryFields,
      // The list only needs an excerpt, so don't ship whole bodies out of Postgres.
      body: sql<string>`left(${entries.body}, 600)`,
      cursorTs: createdAtText,
    })
    .from(entries)
    .where(and(...conds))
    .orderBy(...newestFirst)
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const counts = await attachmentCounts(
    userId,
    page.map((r) => r.id),
  );
  const last = page.at(-1);
  return {
    items: page.map(({ cursorTs: _c, ...row }) => toEntrySummary(row, counts.get(row.id) ?? 0)),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor([last.entryDate, last.cursorTs, last.id]) : null,
  };
}

async function attachmentCounts(userId: string, entryIds: string[]): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db
    .select({ entryId: attachments.entryId, n: count() })
    .from(attachments)
    .where(and(eq(attachments.userId, userId), inArray(attachments.entryId, entryIds)))
    .groupBy(attachments.entryId);
  return new Map(rows.map((r) => [r.entryId, r.n]));
}

/** Every entry of a user, newest first, in pages (used by export). */
export async function* entryPages(userId: string, pageSize = 100): AsyncGenerator<Entry[]> {
  let cursor: Cursor | undefined;
  for (;;) {
    const rows = await db
      .select({ ...entryFields, cursorTs: createdAtText })
      .from(entries)
      .where(and(eq(entries.userId, userId), cursor ? before(cursor) : undefined))
      .orderBy(...newestFirst)
      .limit(pageSize);
    if (rows.length === 0) return;

    const atts = await db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, userId),
          inArray(
            attachments.entryId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(attachments.createdAt);
    const urls = await signUrls(atts.map((a) => a.storagePath));
    const byEntry = new Map<string, Attachment[]>();
    atts.forEach((a, i) =>
      byEntry.set(a.entryId, [...(byEntry.get(a.entryId) ?? []), toAttachment(a, urls[i]!)]),
    );

    yield rows.map(({ cursorTs: _c, ...row }) => toEntry(row, byEntry.get(row.id) ?? []));
    if (rows.length < pageSize) return;
    const last = rows.at(-1)!;
    cursor = [last.entryDate, last.cursorTs, last.id];
  }
}

// ── single entry ───────────────────────────────────────────────────────

export async function getEntry(userId: string, id: string): Promise<Entry> {
  const [row] = await db.select(entryFields).from(entries).where(ownEntry(userId, id));
  if (!row) throw entryNotFound();
  return withAttachments(row);
}

export type CreateResult = { entry: Entry; created: boolean };

/** Create an entry. A repeated client `id` returns the existing entry (offline retry safety). */
export async function createEntry(userId: string, input: CreateEntryInput): Promise<CreateResult> {
  const entryDate = input.entryDate ?? localDate(new Date(), await getTimezone(userId));
  const shouldEnrich = countWords(`${input.title} ${input.body}`) > 0;

  const row = await db.transaction(async (tx) => {
    const promptId = input.promptId ? await ownPromptId(tx, userId, input.promptId) : null;
    const [inserted] = await tx
      .insert(entries)
      .values({
        ...(input.id ? { id: input.id } : {}),
        userId,
        title: input.title,
        body: input.body,
        entryDate,
        mood: input.mood ?? null,
        moodSource: input.mood ? 'user' : null,
        tags: uniqueTags(input.tags ?? []),
        wordCount: countWords(input.body),
        promptId,
        // Nothing to analyze in an empty draft; it becomes 'pending' once text arrives.
        enrichmentStatus: shouldEnrich ? 'pending' : 'ready',
      })
      .onConflictDoNothing({ target: entries.id })
      .returning(entryFields);

    if (!inserted) {
      const [existing] = await tx
        .select({ userId: entries.userId })
        .from(entries)
        .where(eq(entries.id, input.id!));
      if (existing?.userId !== userId)
        throw conflict('That entry id is already in use.', ERROR_CODES.forbidden);
      return null;
    }
    if (promptId) {
      await tx
        .update(prompts)
        .set({ status: 'answered', entryId: inserted.id })
        .where(and(eq(prompts.id, promptId), eq(prompts.userId, userId)));
    }
    if (shouldEnrich) await enqueueEnrichment(tx, inserted);
    return inserted;
  });

  if (!row) return { entry: await getEntry(userId, input.id!), created: false };
  return { entry: toEntry(row, []), created: true };
}

async function ownPromptId(tx: Tx, userId: string, promptId: string): Promise<string | null> {
  const [p] = await tx
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.userId, userId)));
  return p?.id ?? null;
}

/**
 * Optimistic-concurrency update: applies only if the stored version equals `expectedVersion`.
 * Title/body changes bump the version and schedule (debounced) re-enrichment; mood, tags and
 * date are metadata and leave the version alone.
 */
export async function updateEntry(
  userId: string,
  id: string,
  expectedVersion: number,
  input: UpdateEntryInput,
): Promise<Entry> {
  const set: PgUpdateSetSource<typeof entries> = { updatedAt: sql`now()` };
  const contentChanges: SQL[] = [];
  if (input.title !== undefined) {
    set.title = input.title;
    contentChanges.push(sql`${entries.title} is distinct from ${input.title}`);
  }
  if (input.body !== undefined) {
    set.body = input.body;
    set.wordCount = countWords(input.body);
    contentChanges.push(sql`${entries.body} is distinct from ${input.body}`);
  }
  if (input.entryDate !== undefined) set.entryDate = input.entryDate;
  if (input.mood !== undefined) {
    set.mood = input.mood;
    set.moodSource = input.mood === null ? null : 'user';
  }
  if (input.tags !== undefined) set.tags = uniqueTags(input.tags);
  if (contentChanges.length) {
    // Compared against the stored row, so an autosave that resends identical text is a no-op.
    const changed = or(...contentChanges)!;
    set.version = sql`case when ${changed} then ${entries.version} + 1 else ${entries.version} end`;
    set.enrichmentStatus = sql`case when ${changed} then 'pending' else ${entries.enrichmentStatus} end`;
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(entries)
      .set(set)
      .where(and(ownEntry(userId, id), eq(entries.version, expectedVersion)))
      .returning(entryFields);
    if (!updated) {
      const [current] = await tx
        .select({ version: entries.version })
        .from(entries)
        .where(ownEntry(userId, id));
      if (!current) throw entryNotFound();
      throw new HttpError(
        409,
        `This entry was changed elsewhere (now version ${current.version}).`,
        ERROR_CODES.versionConflict,
        { version: String(current.version) },
      );
    }
    if (updated.version !== expectedVersion) {
      await enqueueEnrichment(tx, updated, new Date(Date.now() + ENRICH_DEBOUNCE_MS));
    }
    return updated;
  });
  return withAttachments(row);
}

/**
 * Delete an entry and everything derived from it. Idempotent by design: an id that doesn't
 * exist, was already deleted, or belongs to someone else is a silent no-op (the route
 * answers 204 in every case), so client retries are safe and nothing leaks about whether
 * another user's id exists.
 */
export async function deleteEntry(userId: string, id: string): Promise<void> {
  const paths = await db.transaction(async (tx) => {
    // Lock the entry so a concurrent upload can't add an object we would miss.
    const [locked] = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(ownEntry(userId, id))
      .for('update');
    if (!locked) return [];
    const atts = await tx
      .select({ id: attachments.id, path: attachments.storagePath })
      .from(attachments)
      .where(eq(attachments.entryId, id));
    await forgetDerivedData(tx, userId, id);
    await tx.delete(entries).where(ownEntry(userId, id));
    const keys = [`enrich:${id}`, ...atts.map((a) => `describe:${a.id}`)];
    await tx.delete(jobs).where(and(inArray(jobs.dedupeKey, keys), eq(jobs.status, 'queued')));
    return atts.map((a) => a.path);
  });
  await removeObjectsQuietly(paths);
}

/**
 * Remove what the AI learned only from this entry, before the entry row (and by cascade its
 * chunks, attachments, memory_sources and graph_node_sources links) goes:
 * - memories whose sole source is this entry, unless the user edited them;
 * - graph nodes: one unit of weight off each node the entry contributed to, and nodes no
 *   other entry supports are deleted (their edges cascade).
 */
async function forgetDerivedData(tx: Tx, userId: string, entryId: string): Promise<void> {
  await tx.delete(memories).where(
    and(
      eq(memories.userId, userId),
      eq(memories.userEdited, false),
      sql`exists (select 1 from ${memorySources} s
                    where s.memory_id = ${memories.id} and s.entry_id = ${entryId})`,
      sql`not exists (select 1 from ${memorySources} s
                        where s.memory_id = ${memories.id} and s.entry_id <> ${entryId})`,
    ),
  );

  const linked = tx
    .select({ id: graphNodeSources.nodeId })
    .from(graphNodeSources)
    .where(eq(graphNodeSources.entryId, entryId));
  await tx.delete(graphNodes).where(
    and(
      eq(graphNodes.userId, userId),
      inArray(graphNodes.id, linked),
      sql`not exists (select 1 from ${graphNodeSources} s
                        where s.node_id = ${graphNodes.id} and s.entry_id <> ${entryId})`,
    ),
  );
  await tx
    .update(graphNodes)
    .set({ weight: sql`greatest(${graphNodes.weight} - 1, 1)` })
    .where(and(eq(graphNodes.userId, userId), inArray(graphNodes.id, linked)));
}

/** Re-queue enrichment after a failure. Any other status is left alone (idempotent retry). */
export async function retryEnrichment(userId: string, id: string): Promise<Entry> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(entries)
      .set({ enrichmentStatus: 'pending' })
      .where(and(ownEntry(userId, id), eq(entries.enrichmentStatus, 'failed')))
      .returning({ id: entries.id, userId: entries.userId, version: entries.version });
    if (row) await enqueueEnrichment(tx, row);
  });
  return getEntry(userId, id);
}

// ── attachments ────────────────────────────────────────────────────────

/** Cheap pre-check before accepting an upload body: entry exists and has room. */
export async function assertCanAttach(userId: string, entryId: string): Promise<void> {
  const [row] = await db
    .select({
      n: sql<number>`(select count(*)::int from attachments a where a.entry_id = ${entries.id})`,
    })
    .from(entries)
    .where(ownEntry(userId, entryId));
  if (!row) throw entryNotFound();
  if (row.n >= LIMITS.attachmentsPerEntry) throw tooManyAttachments();
}

const tooManyAttachments = () =>
  badRequest(`An entry can hold up to ${LIMITS.attachmentsPerEntry} photos.`, {
    file: 'Photo limit reached',
  });

export async function addAttachment(
  userId: string,
  entryId: string,
  image: ProcessedImage,
): Promise<Attachment> {
  const attachmentId = randomUUID();
  const storagePath = `${userId}/${entryId}/${attachmentId}.webp`;
  await putObject(storagePath, image.bytes, image.mime);

  let row: typeof attachments.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(ownEntry(userId, entryId))
        .for('update');
      if (!locked) throw entryNotFound();
      const [existing] = await tx
        .select({ n: count() })
        .from(attachments)
        .where(eq(attachments.entryId, entryId));
      if ((existing?.n ?? 0) >= LIMITS.attachmentsPerEntry) throw tooManyAttachments();
      const [inserted] = await tx
        .insert(attachments)
        .values({
          id: attachmentId,
          entryId,
          userId,
          storagePath,
          mime: image.mime,
          width: image.width,
          height: image.height,
          bytes: image.bytes.length,
        })
        .returning();
      await enqueue(
        tx,
        JOB.describeAttachment,
        { attachmentId, userId },
        { dedupeKey: `describe:${attachmentId}` },
      );
      return inserted!;
    });
  } catch (err) {
    await removeObjectsQuietly([storagePath]);
    throw err;
  }
  const [url] = await signUrls([storagePath]);
  return toAttachment(row, url!);
}

export async function deleteAttachment(
  userId: string,
  entryId: string,
  attachmentId: string,
): Promise<void> {
  const path = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.entryId, entryId),
          eq(attachments.userId, userId),
        ),
      )
      .returning({ path: attachments.storagePath, description: attachments.description });
    if (!row) throw notFound('Photo not found');
    if (row.description) {
      // Keep keyword search from matching a photo that no longer exists, and re-enrich so the
      // chunks (meaning search, Reflect) and the summary forget its description too.
      const [entry] = await tx
        .update(entries)
        .set({
          attachmentText: sql`coalesce((select string_agg(a.description, E'\n' order by a.created_at)
            from attachments a where a.entry_id = ${entryId} and a.description is not null), '')`,
          enrichmentStatus: 'pending',
        })
        .where(ownEntry(userId, entryId))
        .returning({ id: entries.id, userId: entries.userId, version: entries.version });
      if (entry) await enqueueEnrichment(tx, entry);
    }
    await tx
      .delete(jobs)
      .where(and(eq(jobs.dedupeKey, `describe:${attachmentId}`), eq(jobs.status, 'queued')));
    return row.path;
  });
  await removeObjectsQuietly([path]);
}

/** Storage cleanup after a committed delete: failures leave an orphan object, never an error. */
async function removeObjectsQuietly(paths: string[]): Promise<void> {
  try {
    await deleteObjects(paths);
  } catch (err) {
    logger.warn({ err, count: paths.length }, 'failed to delete storage objects');
  }
}
