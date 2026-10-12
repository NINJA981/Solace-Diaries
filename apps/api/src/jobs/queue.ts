/**
 * Durable job queue on the `jobs` table. `enqueue` is called inside the caller's
 * transaction so a job exists if and only if the write that needs it committed.
 */
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import type { JobType } from './types';
import { notifyWorker } from './wake';

export type EnqueueOptions = { dedupeKey?: string; runAfter?: Date; maxAttempts?: number };

export const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * Insert a job (inside the caller's transaction when `tx` is given).
 *
 * With a `dedupeKey`, at most one queued/running job exists per key. A duplicate does not
 * add a row; instead it refreshes the live job's payload and pushes a later `runAfter`
 * (debouncing autosave bursts). If the live job is already *running*, bumping its
 * `updated_at` past `locked_at` tells the worker to run it once more after it finishes,
 * so the newest content is never skipped.
 */
export async function enqueue(
  tx: DbOrTx,
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<void> {
  const runAfter = opts.runAfter ? sql`${opts.runAfter.toISOString()}::timestamptz` : sql`now()`;
  await tx.execute(sql`
    insert into jobs (type, payload, dedupe_key, run_after, max_attempts)
    values (${type}, ${JSON.stringify(payload)}::jsonb, ${opts.dedupeKey ?? null}, ${runAfter},
            ${opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS})
    on conflict (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null
    do update set payload = excluded.payload,
                  run_after = greatest(jobs.run_after, excluded.run_after),
                  updated_at = clock_timestamp()`);
  notifyWorker();
}
