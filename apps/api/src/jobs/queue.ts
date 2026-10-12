// Owned by the platform layer. STUB — replaced in Phase 1 (agent A).
import type { DbOrTx } from '../db/client';
import type { JobType } from './types';

export type EnqueueOptions = { dedupeKey?: string; runAfter?: Date; maxAttempts?: number };

/** Insert a job (inside the caller's transaction when `tx` is given). Duplicate dedupeKey = no-op. */
export async function enqueue(
  _tx: DbOrTx,
  _type: JobType,
  _payload: Record<string, unknown>,
  _opts: EnqueueOptions = {},
): Promise<void> {
  throw new Error('enqueue: not implemented');
}
