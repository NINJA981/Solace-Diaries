/**
 * In-process job worker: N loops claim jobs with FOR UPDATE SKIP LOCKED, run the handler
 * from the registry with a timeout, then mark done / retry with backoff / dead-letter.
 * Safe to run in several processes at once.
 */
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { logger } from '../logger';
import * as registry from './handlers/index';
import { DeferJobError, PermanentJobError, type JobHandler } from './types';
import { idleWait, notifyWorker } from './wake';

export { notifyWorker };

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export type OnJobDead = (type: string, payload: Record<string, unknown>) => unknown;

export type WorkerOptions = {
  handlers: Partial<Record<string, JobHandler>>;
  /** Called once when a job is dead-lettered (e.g. to mark its entry as failed). */
  onJobDead?: OnJobDead;
  concurrency?: number;
  timeoutMs?: number;
};

export type JobOutcome = 'done' | 'retry' | 'dead' | 'released' | 'deferred';

const JOB_TIMEOUT_MS = 2 * 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 10 * 60_000;
const ERROR_MAX = 2_000;
const IDLE_MIN_MS = 250;
const IDLE_MAX_MS = 5_000;
const DRAIN_MS = 20_000;

// ── queue primitives (exported for tests) ──────────────────────────────

/**
 * Claim the oldest due job, fairly across users: a job is skipped while another job for
 * the same `payload.userId` is running, so one user's backlog can't occupy every worker
 * slot and starve everyone else. Jobs without a userId are never held back.
 * (Best effort under a race: two claimers in the same instant can each start a job for
 * one user. That only costs a little fairness, never correctness.)
 */
export async function claimJob(): Promise<ClaimedJob | null> {
  const rows = await db.execute<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    update jobs set status = 'running', locked_at = now(), updated_at = now(), attempts = attempts + 1
    where id = (
      select j.id from jobs j
      where j.status = 'queued' and j.run_after <= now()
        and not exists (
          select 1 from jobs r
          where r.status = 'running' and r.payload->>'userId' = j.payload->>'userId')
      order by j.run_after for update of j skip locked limit 1)
    returning id, type, payload, attempts, max_attempts`);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        type: row.type,
        payload: row.payload,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      }
    : null;
}

/** Exponential backoff with ±20% jitter: 5s, 10s, 20s … capped at 10 minutes. */
export function backoffMs(attempts: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
  return Math.min(Math.round(base * (0.8 + Math.random() * 0.4)), BACKOFF_CAP_MS);
}

/** Success. If a duplicate was enqueued while running (updated_at moved past locked_at), run again. */
async function markDone(id: string): Promise<void> {
  await db.execute(sql`
    update jobs set
      status = case when updated_at > locked_at then 'queued' else 'done' end,
      attempts = case when updated_at > locked_at then 0 else attempts end,
      locked_at = null, last_error = null, updated_at = now()
    where id = ${id} and status = 'running'`);
}

/**
 * Record a failed run. Returns true when the job was requeued because a newer payload was
 * enqueued while it ran (updated_at moved past locked_at): that payload has never been
 * tried, so it gets a fresh run with fresh attempts instead of dying with the old one.
 */
async function markFailed(
  id: string,
  dead: boolean,
  error: string,
  delayMs: number,
): Promise<boolean> {
  const rows = await db.execute<{ superseded: boolean }>(sql`
    update jobs set
      status = case when ${dead}::boolean and p.newer then 'queued' else ${dead ? 'dead' : 'queued'}::text end,
      attempts = case when ${dead}::boolean and p.newer then 0 else jobs.attempts end,
      run_after = case when ${dead}::boolean and p.newer then now()
                       else now() + ${delayMs} * interval '1 millisecond' end,
      last_error = ${error.slice(0, ERROR_MAX)}, locked_at = null, updated_at = now()
    from (select id, updated_at > locked_at as newer from jobs where id = ${id} for update) p
    where jobs.id = p.id and jobs.status = 'running'
    returning (${dead}::boolean and p.newer) as superseded`);
  return rows[0]?.superseded === true;
}

/** Requeue until `until` without counting the attempt (the handler asked to wait). */
async function defer(id: string, until: Date, reason: string): Promise<void> {
  await db.execute(sql`
    update jobs set status = 'queued', attempts = greatest(attempts - 1, 0),
      run_after = greatest(run_after, ${until.toISOString()}::timestamptz),
      last_error = ${reason.slice(0, ERROR_MAX)}, locked_at = null, updated_at = now()
    where id = ${id} and status = 'running'`);
}

/** Hand a job back untouched (shutdown interrupted it); the attempt doesn't count. */
async function release(id: string): Promise<void> {
  await db.execute(sql`
    update jobs set status = 'queued', attempts = greatest(attempts - 1, 0), locked_at = null, updated_at = now()
    where id = ${id} and status = 'running'`);
}

/**
 * Jobs left 'running' by a crashed process go back to the queue, or die if out of attempts.
 * Newly dead jobs get the same `onJobDead` hook as in-process failures (so their entry is
 * marked failed instead of staying 'processing' forever).
 */
export async function reapStaleJobs(
  staleAfterMs = 10 * 60_000,
  onJobDead?: OnJobDead,
): Promise<number> {
  const rows = await db.execute<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    status: string;
  }>(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'dead' else 'queued' end,
      last_error = coalesce(last_error, 'Worker stopped while running this job'),
      locked_at = null, run_after = now(), updated_at = now()
    where status = 'running' and locked_at < now() - ${staleAfterMs} * interval '1 millisecond'
    returning id, type, payload, status`);
  for (const row of rows) {
    if (row.status !== 'dead') continue;
    logger.error({ jobId: row.id, jobType: row.type }, 'stale job dead-lettered');
    try {
      await onJobDead?.(row.type, row.payload);
    } catch (hookErr) {
      logger.error(
        { jobId: row.id, error: errorText(hookErr).slice(0, 300) },
        'onJobDead hook failed',
      );
    }
  }
  return rows.length;
}

export async function purgeOldJobs(): Promise<number> {
  const rows = await db.execute(sql`
    delete from jobs where status = 'done' and updated_at < now() - interval '7 days' returning id`);
  return rows.length;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** Run one claimed job to completion and record the outcome. */
export async function runJob(
  job: ClaimedJob,
  opts: WorkerOptions,
  shutdown: AbortSignal = new AbortController().signal,
): Promise<JobOutcome> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? JOB_TIMEOUT_MS);
  const signal = AbortSignal.any([timeout, shutdown]);
  const log = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
  try {
    const handler = opts.handlers[job.type];
    if (!handler) throw new PermanentJobError(`No handler registered for job type "${job.type}"`);
    // Racing the abort enforces the timeout even if a handler ignores its signal.
    await Promise.race([
      handler(job.payload, { id: job.id, attempt: job.attempts, signal }),
      rejectOnAbort(signal),
    ]);
    await markDone(job.id);
    return 'done';
  } catch (err) {
    if (shutdown.aborted) {
      await release(job.id);
      return 'released';
    }
    if (err instanceof DeferJobError) {
      await defer(job.id, err.until, errorText(err));
      log.info({ until: err.until.toISOString(), reason: err.message }, 'job deferred');
      return 'deferred';
    }
    const dead = err instanceof PermanentJobError || job.attempts >= job.maxAttempts;
    const text = timeout.aborted ? 'Job timed out' : errorText(err);
    const superseded = await markFailed(job.id, dead, text, dead ? 0 : backoffMs(job.attempts));
    if (superseded) {
      log.info({ error: text.slice(0, 300) }, 'job failed, but newer content is queued');
      return 'retry';
    }
    if (!dead) {
      log.warn({ error: text.slice(0, 300) }, 'job failed, will retry');
      return 'retry';
    }
    log.error({ error: text.slice(0, 300) }, 'job dead-lettered');
    try {
      await opts.onJobDead?.(job.type, job.payload);
    } catch (hookErr) {
      log.error({ error: errorText(hookErr).slice(0, 300) }, 'onJobDead hook failed');
    }
    return 'dead';
  }
}

// ── worker runtime ─────────────────────────────────────────────────────

export type Worker = { start(): void; stop(): Promise<void> };

export function createWorker(opts: WorkerOptions): Worker {
  const shutdown = new AbortController();
  let stopping = false;
  let loops: Promise<void>[] = [];
  let timers: NodeJS.Timeout[] = [];

  async function loop(): Promise<void> {
    let idle = IDLE_MIN_MS;
    while (!stopping) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimJob();
        if (job) await runJob(job, opts, shutdown.signal);
      } catch (err) {
        logger.error({ error: errorText(err).slice(0, 300) }, 'worker loop error');
      }
      if (job) {
        idle = IDLE_MIN_MS;
        continue;
      }
      if (stopping) break;
      const woken = await idleWait(idle);
      idle = woken ? IDLE_MIN_MS : Math.min(idle * 2, IDLE_MAX_MS);
    }
  }

  function maintain(task: () => Promise<number>, name: string, everyMs: number): void {
    const run = () =>
      task()
        .then((n) => n && logger.info({ count: n }, `jobs: ${name}`))
        .catch((err) =>
          logger.error({ error: errorText(err).slice(0, 300) }, `jobs: ${name} failed`),
        );
    void run();
    const timer = setInterval(run, everyMs);
    timer.unref();
    timers.push(timer);
  }

  return {
    start() {
      if (loops.length) return;
      maintain(() => reapStaleJobs(undefined, opts.onJobDead), 'reaped stale', 60_000);
      maintain(purgeOldJobs, 'purged done', 60 * 60_000);
      const n = opts.concurrency ?? config.WORKER_CONCURRENCY;
      loops = Array.from({ length: n }, () => loop());
      logger.info({ concurrency: n }, 'job worker started');
    },
    async stop() {
      stopping = true;
      timers.forEach(clearInterval);
      timers = [];
      notifyWorker();
      const all = Promise.all(loops);
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<false>(
        (resolve) => (timer = setTimeout(() => resolve(false), DRAIN_MS)),
      );
      const drained = await Promise.race([all.then(() => true as const), deadline]);
      clearTimeout(timer);
      if (!drained) {
        // Interrupt handlers still running; their jobs are released back to the queue.
        shutdown.abort(new Error('Worker shutting down'));
        await all;
      }
      loops = [];
      logger.info('job worker stopped');
    },
  };
}

// ── process-wide default worker ────────────────────────────────────────

let defaultWorker: Worker | undefined;

export function startWorker(): void {
  const onJobDead = (registry as Record<string, unknown>)['onJobDead'] as OnJobDead | undefined;
  defaultWorker ??= createWorker({ handlers: registry.handlers, onJobDead });
  defaultWorker.start();
}

export async function stopWorker(): Promise<void> {
  await defaultWorker?.stop();
  defaultWorker = undefined;
}
