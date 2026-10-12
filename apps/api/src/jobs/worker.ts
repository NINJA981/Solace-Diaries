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
import { PermanentJobError, type JobHandler } from './types';
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

export type JobOutcome = 'done' | 'retry' | 'dead' | 'released';

const JOB_TIMEOUT_MS = 2 * 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 10 * 60_000;
const ERROR_MAX = 2_000;
const IDLE_MIN_MS = 250;
const IDLE_MAX_MS = 5_000;
const DRAIN_MS = 20_000;

// ── queue primitives (exported for tests) ──────────────────────────────

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
      select id from jobs where status = 'queued' and run_after <= now()
      order by run_after for update skip locked limit 1)
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

async function markFailed(
  id: string,
  dead: boolean,
  error: string,
  delayMs: number,
): Promise<void> {
  await db.execute(sql`
    update jobs set status = ${dead ? 'dead' : 'queued'},
      run_after = now() + ${delayMs} * interval '1 millisecond',
      last_error = ${error.slice(0, ERROR_MAX)}, locked_at = null, updated_at = now()
    where id = ${id} and status = 'running'`);
}

/** Hand a job back untouched (shutdown interrupted it); the attempt doesn't count. */
async function release(id: string): Promise<void> {
  await db.execute(sql`
    update jobs set status = 'queued', attempts = greatest(attempts - 1, 0), locked_at = null, updated_at = now()
    where id = ${id} and status = 'running'`);
}

/** Jobs left 'running' by a crashed process go back to the queue (or die if out of attempts). */
export async function reapStaleJobs(staleAfterMs = 10 * 60_000): Promise<number> {
  const rows = await db.execute(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'dead' else 'queued' end,
      last_error = coalesce(last_error, 'Worker stopped while running this job'),
      locked_at = null, run_after = now(), updated_at = now()
    where status = 'running' and locked_at < now() - ${staleAfterMs} * interval '1 millisecond'
    returning id`);
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
    const dead = err instanceof PermanentJobError || job.attempts >= job.maxAttempts;
    const text = timeout.aborted ? 'Job timed out' : errorText(err);
    await markFailed(job.id, dead, text, dead ? 0 : backoffMs(job.attempts));
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
      maintain(() => reapStaleJobs(), 'reaped stale', 60_000);
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
