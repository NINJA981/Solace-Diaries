/** Job handler registry (intelligence layer). The platform worker claims jobs and calls these. */
import { AiBadOutputError, AiUnavailableError } from '../../ai/errors';
import { logger } from '../../logger';
import { buildChapters } from '../../services/chapters';
import { buildGrowthNote } from '../../services/growth';
import { describeAttachment, enrichEntry, markEnrichmentFailed } from '../../services/enrichment';
import { DeferJobError, JOB, PermanentJobError, type JobHandler, type JobType } from '../types';

const MIN_RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_WAIT_MS = 24 * 60 * 60_000;

/**
 * A provider rate limit isn't a failure of the job: wait as long as the provider asked
 * (bounded), without spending one of the job's attempts, then run it again.
 */
export function deferOnRateLimit(handler: JobHandler): JobHandler {
  return async (payload, ctx) => {
    try {
      await handler(payload, ctx);
    } catch (err) {
      if (!(err instanceof AiUnavailableError) || err.status !== 429) throw err;
      const wait = Math.min(
        MAX_RATE_LIMIT_WAIT_MS,
        Math.max(MIN_RATE_LIMIT_WAIT_MS, err.retryAfterMs ?? MIN_RATE_LIMIT_WAIT_MS * 2),
      );
      throw new DeferJobError(new Date(Date.now() + wait), 'AI provider rate limit');
    }
  };
}

/** Attempts after which an answer the model keeps getting wrong stops being retried. */
export const BAD_OUTPUT_ATTEMPTS = 2;

/**
 * Output that failed validation even after the gateway's repair round rarely fixes itself,
 * and each attempt costs up to two requests from a small daily quota. Give it one more try,
 * then fail for good (the entry shows as failed and can be retried by hand).
 */
export function giveUpOnBadOutput(handler: JobHandler): JobHandler {
  return async (payload, ctx) => {
    try {
      await handler(payload, ctx);
    } catch (err) {
      if (err instanceof AiBadOutputError && ctx.attempt >= BAD_OUTPUT_ATTEMPTS) {
        throw new PermanentJobError(`Unusable model output: ${err.message}`);
      }
      throw err;
    }
  };
}

const aiJob = (handler: JobHandler) => deferOnRateLimit(giveUpOnBadOutput(handler));

export const handlers: Partial<Record<JobType, JobHandler>> = {
  [JOB.enrichEntry]: aiJob((payload, ctx) => enrichEntry(payload, ctx.signal)),
  [JOB.describeAttachment]: aiJob((payload, ctx) => describeAttachment(payload, ctx.signal)),
  [JOB.buildChapters]: aiJob((payload, ctx) => buildChapters(payload, { signal: ctx.signal })),
  [JOB.buildGrowth]: aiJob((payload, ctx) => buildGrowthNote(payload, { signal: ctx.signal })),
};

/** Called by the worker once a job is dead-lettered. */
export async function onJobDead(type: string, payload: Record<string, unknown>): Promise<void> {
  if (type === JOB.enrichEntry) {
    await markEnrichmentFailed(payload);
  } else {
    // A photo that couldn't be described simply stays undescribed; the entry itself is fine.
    logger.warn({ type }, 'job dead-lettered');
  }
}
