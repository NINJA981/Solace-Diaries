import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import { jobs } from '../src/db/schema';
import { enqueue } from '../src/jobs/queue';
import { DeferJobError, JOB, PermanentJobError, type JobHandler } from '../src/jobs/types';
import {
  backoffMs,
  claimJob,
  createWorker,
  purgeOldJobs,
  reapStaleJobs,
  runJob,
  type WorkerOptions,
} from '../src/jobs/worker';
import { resetDb } from './helpers';

beforeEach(resetDb);

const allJobs = () => db.select().from(jobs);
const jobById = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
const ok: JobHandler = async () => {};
const opts = (handler: JobHandler, extra: Partial<WorkerOptions> = {}): WorkerOptions => ({
  handlers: { [JOB.enrichEntry]: handler },
  ...extra,
});

async function claimOrFail() {
  const job = await claimJob();
  if (!job) throw new Error('expected a claimable job');
  return job;
}

describe('enqueue', () => {
  it('dedupes on key, refreshing the payload and pushing a later runAfter', async () => {
    const soon = new Date(Date.now() + 5_000);
    const later = new Date(Date.now() + 20_000);
    await enqueue(db, JOB.enrichEntry, { v: 1 }, { dedupeKey: 'enrich:a', runAfter: soon });
    await enqueue(db, JOB.enrichEntry, { v: 2 }, { dedupeKey: 'enrich:a', runAfter: later });
    await enqueue(db, JOB.enrichEntry, { v: 3 }, { dedupeKey: 'enrich:a', runAfter: soon });
    const rows = await allJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ v: 3 });
    expect(Math.abs(rows[0]!.runAfter.getTime() - later.getTime())).toBeLessThan(5);
  });

  it('keeps jobs without a dedupe key separate and only enqueues on commit', async () => {
    await enqueue(db, JOB.enrichEntry, { n: 1 });
    await enqueue(db, JOB.enrichEntry, { n: 2 });
    await db
      .transaction(async (tx) => {
        await enqueue(tx, JOB.enrichEntry, { n: 3 });
        throw new Error('rollback');
      })
      .catch(() => {});
    expect(await allJobs()).toHaveLength(2);
  });

  it('a duplicate enqueued while running makes the job run again afterwards', async () => {
    await enqueue(db, JOB.enrichEntry, { version: 1 }, { dedupeKey: 'enrich:b' });
    const job = await claimOrFail();
    await enqueue(db, JOB.enrichEntry, { version: 2 }, { dedupeKey: 'enrich:b' });
    expect(await allJobs()).toHaveLength(1);

    expect(await runJob(job, opts(ok))).toBe('done');
    const requeued = await jobById(job.id);
    expect(requeued).toMatchObject({ status: 'queued', attempts: 0, payload: { version: 2 } });

    const again = await claimOrFail();
    await runJob(again, opts(ok));
    expect((await jobById(job.id)).status).toBe('done');
    // A finished job frees the key for new work.
    await enqueue(db, JOB.enrichEntry, { version: 3 }, { dedupeKey: 'enrich:b' });
    expect(await allJobs()).toHaveLength(2);
  });
});

describe('claim', () => {
  it('only claims due jobs, oldest first', async () => {
    await enqueue(
      db,
      JOB.enrichEntry,
      { n: 'future' },
      { runAfter: new Date(Date.now() + 60_000) },
    );
    expect(await claimJob()).toBeNull();
    await enqueue(db, JOB.enrichEntry, { n: 'now' });
    const job = await claimOrFail();
    expect(job).toMatchObject({ payload: { n: 'now' }, attempts: 1 });
    expect((await jobById(job.id)).status).toBe('running');
  });

  it('skips rows locked by another claimer instead of waiting', async () => {
    await enqueue(db, JOB.enrichEntry, { n: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await enqueue(db, JOB.enrichEntry, { n: 2 });
    const [first] = await db.select().from(jobs).orderBy(jobs.runAfter).limit(1);

    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from jobs where id = ${first!.id} for update`);
      const other = await claimOrFail();
      expect(other.id).not.toBe(first!.id);
    });
  });

  it('never hands the same job to two concurrent claimers', async () => {
    for (let i = 0; i < 30; i++) await enqueue(db, JOB.enrichEntry, { n: i });
    const drain = async () => {
      const ids: string[] = [];
      for (let job = await claimJob(); job; job = await claimJob()) ids.push(job.id);
      return ids;
    };
    const [a, b, c] = await Promise.all([drain(), drain(), drain()]);
    const all = [...a, ...b, ...c];
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
  });
});

describe('fair claiming', () => {
  it("one user's backlog doesn't block another user's job", async () => {
    const [heavy, light] = [randomUUID(), randomUUID()];
    for (let i = 0; i < 20; i++) {
      await enqueue(db, JOB.enrichEntry, { userId: heavy, n: i });
    }
    await db.execute(
      sql`update jobs set run_after = now() - interval '1 minute' + (payload->>'n')::int * interval '1 second'`,
    );
    await enqueue(db, JOB.enrichEntry, { userId: light, n: 'light' });

    const first = await claimOrFail();
    expect(first.payload.userId).toBe(heavy);
    // Heavy already has a job running, so the newer job of another user goes next…
    const second = await claimOrFail();
    expect(second.payload).toEqual({ userId: light, n: 'light' });
    // …and nothing else is claimable until one of them finishes.
    expect(await claimJob()).toBeNull();

    // Jobs without a userId are never held back.
    await enqueue(db, JOB.enrichEntry, { n: 'system' });
    expect((await claimOrFail()).payload).toEqual({ n: 'system' });

    await runJob(first, opts(ok));
    const next = await claimOrFail();
    expect(next.payload.userId).toBe(heavy);
    expect(next.payload.n).toBe(1); // still oldest first within the user
  });
});

describe('deferral', () => {
  it('requeues until the given time without counting the attempt or failing', async () => {
    const until = new Date(Date.now() + 3_600_000);
    const onJobDead = vi.fn();
    await enqueue(db, JOB.enrichEntry, { userId: randomUUID() }, { maxAttempts: 1 });
    const job = await claimOrFail();
    const outcome = await runJob(
      job,
      opts(
        async () => {
          throw new DeferJobError(until, 'budget spent');
        },
        { onJobDead },
      ),
    );
    expect(outcome).toBe('deferred');
    const row = await jobById(job.id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0, lockedAt: null });
    expect(row.runAfter.getTime()).toBe(until.getTime());
    expect(onJobDead).not.toHaveBeenCalled();
    expect(await claimJob()).toBeNull();
  });
});

describe('failures', () => {
  it('retries with exponential backoff and records the error', async () => {
    await enqueue(db, JOB.enrichEntry, {});
    const job = await claimOrFail();
    const outcome = await runJob(
      job,
      opts(async () => {
        throw new Error('Gemini 503');
      }),
    );
    expect(outcome).toBe('retry');
    const row = await jobById(job.id);
    expect(row).toMatchObject({
      status: 'queued',
      attempts: 1,
      lastError: 'Error: Gemini 503',
      lockedAt: null,
    });
    const delay = row.runAfter.getTime() - Date.now();
    expect(delay).toBeGreaterThan(3_000);
    expect(delay).toBeLessThan(6_500);
  });

  it('backoff doubles and caps at ten minutes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffMs(30)).toBe(600_000);
    vi.restoreAllMocks();
  });

  it('dead-letters after max attempts and calls onJobDead once', async () => {
    const onJobDead = vi.fn();
    await enqueue(db, JOB.enrichEntry, { entryId: 'e1' }, { maxAttempts: 2 });
    const failing = opts(
      async () => {
        throw new Error('still broken');
      },
      { onJobDead },
    );

    expect(await runJob(await claimOrFail(), failing)).toBe('retry');
    await db.update(jobs).set({ runAfter: new Date(Date.now() - 1000) });
    expect(await runJob(await claimOrFail(), failing)).toBe('dead');

    const [row] = await allJobs();
    expect(row).toMatchObject({ status: 'dead', attempts: 2, lastError: 'Error: still broken' });
    expect(onJobDead).toHaveBeenCalledExactlyOnceWith(JOB.enrichEntry, { entryId: 'e1' });
  });

  it('dead-letters immediately on PermanentJobError or a missing handler', async () => {
    await enqueue(db, JOB.enrichEntry, {});
    const outcome = await runJob(
      await claimOrFail(),
      opts(async () => {
        throw new PermanentJobError('entry was deleted');
      }),
    );
    expect(outcome).toBe('dead');

    await enqueue(db, JOB.describeAttachment, {});
    expect(await runJob(await claimOrFail(), opts(ok))).toBe('dead');
    const rows = await allJobs();
    expect(rows.every((r) => r.status === 'dead')).toBe(true);
  });

  it('times out a hung handler', async () => {
    await enqueue(db, JOB.enrichEntry, {});
    let sawAbort = false;
    const hung: JobHandler = (_p, ctx) =>
      new Promise(() => ctx.signal.addEventListener('abort', () => (sawAbort = true)));
    const job = await claimOrFail();
    expect(await runJob(job, opts(hung, { timeoutMs: 50 }))).toBe('retry');
    expect(sawAbort).toBe(true);
    expect((await jobById(job.id)).lastError).toBe('Job timed out');
  });

  it('truncates long errors', async () => {
    await enqueue(db, JOB.enrichEntry, {});
    const job = await claimOrFail();
    await runJob(
      job,
      opts(async () => {
        throw new Error('x'.repeat(10_000));
      }),
    );
    expect((await jobById(job.id)).lastError!.length).toBe(2_000);
  });
});

describe('maintenance', () => {
  it('reaps stale running jobs and purges old done jobs', async () => {
    await enqueue(db, JOB.enrichEntry, { n: 'stale' });
    const stale = await claimOrFail();
    await db
      .update(jobs)
      .set({ lockedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(jobs.id, stale.id));
    expect(await reapStaleJobs()).toBe(1);
    expect((await jobById(stale.id)).status).toBe('queued');

    await enqueue(db, JOB.enrichEntry, { n: 'old' });
    await db.execute(
      sql`update jobs set status = 'done', updated_at = now() - interval '8 days' where payload->>'n' = 'old'`,
    );
    expect(await purgeOldJobs()).toBe(1);
    expect(await allJobs()).toHaveLength(1);
  });

  it('calls onJobDead for stale jobs it dead-letters, and only for those', async () => {
    const onJobDead = vi.fn();
    await enqueue(db, JOB.enrichEntry, { n: 'last-try' }, { maxAttempts: 1 });
    await enqueue(db, JOB.enrichEntry, { n: 'has-retries' }, { maxAttempts: 3 });
    await claimOrFail();
    await claimOrFail();
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 11 * 60_000) });

    expect(await reapStaleJobs(undefined, onJobDead)).toBe(2);
    expect(onJobDead).toHaveBeenCalledExactlyOnceWith(JOB.enrichEntry, { n: 'last-try' });
    const rows = await allJobs();
    expect(rows.find((r) => r.payload.n === 'last-try')!.status).toBe('dead');
    expect(rows.find((r) => r.payload.n === 'has-retries')!.status).toBe('queued');
  });
});

describe('worker runtime', () => {
  it('picks up enqueued jobs promptly and stops cleanly', async () => {
    const seen: unknown[] = [];
    const worker = createWorker({
      handlers: { [JOB.enrichEntry]: async (payload) => void seen.push(payload) },
      concurrency: 2,
    });
    worker.start();
    try {
      await new Promise((r) => setTimeout(r, 50));
      await enqueue(db, JOB.enrichEntry, { n: 1 });
      await enqueue(db, JOB.enrichEntry, { n: 2 });
      await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 3_000, interval: 25 });
      await vi.waitFor(async () =>
        expect((await allJobs()).every((j) => j.status === 'done')).toBe(true),
      );
    } finally {
      await worker.stop();
    }
  });
});
