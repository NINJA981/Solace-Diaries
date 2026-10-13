import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import {
  aiUsage,
  attachments,
  entries,
  entryChunks,
  graphNodes,
  jobs,
  memories,
} from '../../src/db/schema';
import { enqueue } from '../../src/jobs/queue';
import { claimJob, runJob } from '../../src/jobs/worker';
import { consumeAiQuota, nextUtcDay } from '../../src/services/quota';
import { handlers, onJobDead } from '../../src/jobs/handlers/index';
import { JOB, PermanentJobError } from '../../src/jobs/types';
import { putObject } from '../../src/storage/index';
import { config } from '../../src/config';
import { resetDb } from '../helpers';
import { httpError, installFakeAi, type FakeAi } from './fake-ai';
import { seedEntry, seedUser } from './seed';

let fake: FakeAi;
beforeEach(async () => {
  await resetDb();
  fake = installFakeAi();
});
afterAll(() => {
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = '';
});

const ctx = { id: 'job', attempt: 1, signal: new AbortController().signal };
const enrich = (payload: Record<string, unknown>) => handlers[JOB.enrichEntry]!(payload, ctx);
const reload = async (id: string) =>
  (await db.select().from(entries).where(eq(entries.id, id)))[0]!;
const chunksOf = (id: string) => db.select().from(entryChunks).where(eq(entryChunks.entryId, id));

const LONG_BODY = Array.from(
  { length: 60 },
  (_, i) =>
    `On day ${i} I walked along the river with Maya and thought about the marathon training plan.`,
).join(' ');

describe('enrichEntry', () => {
  it('analyzes, chunks, embeds and stores everything in one go', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { title: 'River walks', body: LONG_BODY });
    fake.replies.analysis = () =>
      JSON.stringify({
        mood: 'hopeful',
        tags: ['Running', 'river walks', 'running', '!!'],
        summary: 'You **kept** going.',
      });

    await enrich({ entryId: e.id, userId: user.id, version: e.version });

    const after = await reload(e.id);
    expect(after).toMatchObject({
      mood: 'hopeful',
      moodSource: 'ai',
      tags: ['running', 'river-walks'],
      summary: 'You kept going.',
      enrichedVersion: 1,
      enrichmentStatus: 'ready',
    });
    expect(after.updatedAt.getTime()).toBe(e.updatedAt.getTime()); // enrichment is not an edit
    const chunks = await chunksOf(e.id);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every(
        (c) =>
          c.model === config.GEMINI_EMBED_MODEL && c.entryVersion === 1 && c.userId === user.id,
      ),
    ).toBe(true);
    expect(chunks[0]!.content.startsWith('On day 0')).toBe(true); // raw passage, no Title/Date header
    expect(fake.embedCalls[0]!.texts[0]).toMatch(/^Title: River walks\nDate: /);
    expect(fake.embedCalls[0]!.taskType).toBe('RETRIEVAL_DOCUMENT');
  });

  it('never overwrites a mood the user chose, nor tags the user set', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, {
      body: LONG_BODY,
      mood: 'sad',
      moodSource: 'user',
      tags: ['mine'],
    });
    fake.replies.analysis = () =>
      JSON.stringify({ mood: 'joyful', tags: ['other'], summary: 'You walked.' });
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    expect(await reload(e.id)).toMatchObject({
      mood: 'sad',
      moodSource: 'user',
      tags: ['mine'],
      summary: 'You walked.',
    });
  });

  it('aborts quietly when the entry changed during enrichment (version race)', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    fake.replies.analysis = async () => {
      // The user edits while the model is thinking.
      await db.update(entries).set({ version: 2, body: 'edited' }).where(eq(entries.id, e.id));
      return JSON.stringify({ mood: 'calm', tags: [], summary: 'You rested.' });
    };
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    const after = await reload(e.id);
    expect(after.summary).toBeNull();
    expect(after.enrichedVersion).toBeNull();
    expect(await chunksOf(e.id)).toHaveLength(0);
  });

  it('enriches the current version even when the payload version lags', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    await db.update(entries).set({ version: 3 }).where(eq(entries.id, e.id));
    await enrich({ entryId: e.id, userId: user.id, version: 2 });
    expect(await reload(e.id)).toMatchObject({ enrichedVersion: 3, enrichmentStatus: 'ready' });
    expect((await chunksOf(e.id))[0]!.entryVersion).toBe(3);
  });

  it('replaces chunks on re-enrichment instead of accumulating them', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    const first = await chunksOf(e.id);
    await db
      .update(entries)
      .set({ version: 2, body: 'A much shorter entry about the river today.' })
      .where(eq(entries.id, e.id));
    await enrich({ entryId: e.id, userId: user.id, version: 2 });
    const second = await chunksOf(e.id);
    expect(first.length).toBeGreaterThan(1);
    expect(second).toHaveLength(1);
    expect(second[0]!.entryVersion).toBe(2);
  });

  it('skips the AI for very short entries and marks them ready', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'ok' });
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    expect(fake.generateCalls).toHaveLength(0);
    expect(fake.embedCalls).toHaveLength(0);
    expect(await reload(e.id)).toMatchObject({
      enrichmentStatus: 'ready',
      enrichedVersion: 1,
      summary: null,
    });
  });

  it('fails permanently for a missing entry or another user’s entry', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const e = await seedEntry(owner.id, { body: LONG_BODY });
    await expect(enrich({ entryId: e.id, userId: other.id, version: 1 })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    await expect(enrich({ entryId: 'nope', userId: owner.id, version: 1 })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });

  it('throws on AI failure (so the worker retries) and resets status to pending', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    fake.failures = [httpError(503), httpError(503), httpError(503)];
    await expect(enrich({ entryId: e.id, userId: user.id, version: 1 })).rejects.toThrow();
    expect((await reload(e.id)).enrichmentStatus).toBe('pending');
    expect(await chunksOf(e.id)).toHaveLength(0);

    // A later attempt succeeds.
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    expect((await reload(e.id)).enrichmentStatus).toBe('ready');
  });

  it('marks the entry failed when the job is dead-lettered', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    await onJobDead(JOB.enrichEntry, { entryId: e.id, userId: user.id, version: 1 });
    expect((await reload(e.id)).enrichmentStatus).toBe('failed');

    // …but not when the current version was already enriched by a later job.
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    await onJobDead(JOB.enrichEntry, { entryId: e.id, userId: user.id, version: 1 });
    expect((await reload(e.id)).enrichmentStatus).toBe('ready');
  });

  it('runs memory and graph extraction after commit, and their failure does not fail the job', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    fake.replies.memories = () =>
      JSON.stringify({
        ops: [
          {
            op: 'create',
            kind: 'goal',
            content: 'You are training for a marathon.',
            confidence: 0.8,
          },
        ],
      });
    fake.replies.graph = () =>
      JSON.stringify({
        entities: [
          { name: 'Maya', kind: 'person' },
          { name: 'river', kind: 'place' },
        ],
      });
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    expect(await db.select().from(memories).where(eq(memories.userId, user.id))).toHaveLength(1);
    expect(await db.select().from(graphNodes).where(eq(graphNodes.userId, user.id))).toHaveLength(
      2,
    );

    const e2 = await seedEntry(user.id, { body: LONG_BODY });
    fake.replies.memories = () => 'garbage';
    fake.replies.graph = () => {
      throw httpError(400);
    };
    await expect(enrich({ entryId: e2.id, userId: user.id, version: 1 })).resolves.toBeUndefined();
    expect((await reload(e2.id)).enrichmentStatus).toBe('ready');
  });
});

describe('describeAttachment', () => {
  it('describes the photo, updates attachment text and re-queues enrichment', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'Beach day with the dog.' });
    const path = `${user.id}/${e.id}/photo.jpg`;
    await putObject(path, Buffer.from('fake-jpeg'), 'image/jpeg');
    const [att] = await db
      .insert(attachments)
      .values({ entryId: e.id, userId: user.id, storagePath: path, mime: 'image/jpeg', bytes: 9 })
      .returning();

    await handlers[JOB.describeAttachment]!({ attachmentId: att!.id, userId: user.id }, ctx);

    const photoCall = fake.calls('photo')[0]!;
    expect(photoCall.contents[0]!.parts[0]).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') },
    });
    const [updated] = await db.select().from(attachments).where(eq(attachments.id, att!.id));
    expect(updated!.description).toBe('A dog running along a sandy beach at sunset.');
    expect((await reload(e.id)).attachmentText).toBe(
      'A dog running along a sandy beach at sunset.',
    );
    const queued = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, JOB.enrichEntry), eq(jobs.dedupeKey, `enrich:${e.id}`)));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({ entryId: e.id, userId: user.id, version: e.version });

    // The description is now searchable through the entry's generated tsvector.
    const [hit] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from entries where id = ${e.id} and search @@ websearch_to_tsquery('english', 'sunset')`,
    );
    expect(hit!.n).toBe(1);
  });

  it('fails permanently for another user’s attachment', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const e = await seedEntry(owner.id, { body: 'x' });
    const [att] = await db
      .insert(attachments)
      .values({ entryId: e.id, userId: owner.id, storagePath: 'p', mime: 'image/png', bytes: 1 })
      .returning();
    await expect(
      handlers[JOB.describeAttachment]!({ attachmentId: att!.id, userId: other.id }, ctx),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe('daily enrichment budget', () => {
  const usage = async (userId: string) =>
    (await db.select().from(aiUsage).where(eq(aiUsage.userId, userId)))[0]?.enrichRuns ?? 0;
  const spendAll = (userId: string) =>
    db.insert(aiUsage).values({
      userId,
      day: new Date().toISOString().slice(0, 10),
      enrichRuns: config.ENRICH_DAILY_QUOTA,
    });
  const worker = { handlers, onJobDead };

  it('counts one run per enrichment, and none for text too short to analyze', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    await enrich({ entryId: e.id, userId: user.id, version: 1 });
    expect(await usage(user.id)).toBe(1);
    const short = await seedEntry(user.id, { body: 'ok' });
    await enrich({ entryId: short.id, userId: user.id, version: 1 });
    expect(await usage(user.id)).toBe(1);
  });

  it('reschedules to the next UTC day instead of running the AI, leaving the entry pending', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: LONG_BODY });
    await spendAll(user.id);
    await enqueue(db, JOB.enrichEntry, { entryId: e.id, userId: user.id, version: 1 });

    const job = (await claimJob())!;
    expect(await runJob(job, worker)).toBe('deferred');

    expect(fake.calls('analysis')).toHaveLength(0);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row).toMatchObject({ status: 'queued', attempts: 0 });
    expect(row!.runAfter.getTime()).toBe(nextUtcDay().getTime());
    expect(row!.runAfter.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(await reload(e.id)).toMatchObject({ enrichmentStatus: 'pending', summary: null });
    expect(await usage(user.id)).toBe(config.ENRICH_DAILY_QUOTA); // never overshoots
  });

  it('also defers photo descriptions', async () => {
    const user = await seedUser();
    const e = await seedEntry(user.id, { body: 'Beach day with the dog.' });
    const [att] = await db
      .insert(attachments)
      .values({ entryId: e.id, userId: user.id, storagePath: 'p', mime: 'image/png', bytes: 1 })
      .returning();
    await spendAll(user.id);
    await enqueue(db, JOB.describeAttachment, { attachmentId: att!.id, userId: user.id });
    expect(await runJob((await claimJob())!, worker)).toBe('deferred');
    expect(fake.calls('photo')).toHaveLength(0);
  });

  it('keeps enrichment and chat/search budgets independent', async () => {
    const user = await seedUser();
    await spendAll(user.id);
    // A spent enrichment budget leaves the interactive budget untouched…
    await expect(consumeAiQuota(user.id, { usingOwnKey: false })).resolves.toBeUndefined();
    const [row] = await db.select().from(aiUsage).where(eq(aiUsage.userId, user.id));
    expect(row).toMatchObject({ calls: 1, enrichRuns: config.ENRICH_DAILY_QUOTA });

    // …and heavy Reflect/search use never pauses analysis of new entries.
    const other = await seedUser();
    await db.insert(aiUsage).values({
      userId: other.id,
      day: new Date().toISOString().slice(0, 10),
      calls: config.AI_DAILY_QUOTA,
    });
    const e = await seedEntry(other.id, { body: LONG_BODY });
    await enrich({ entryId: e.id, userId: other.id, version: 1 });
    expect(await reload(e.id)).toMatchObject({ enrichmentStatus: 'ready' });
  });
});
