/** Job handler registry (intelligence layer). The platform worker claims jobs and calls these. */
import { logger } from '../../logger';
import { describeAttachment, enrichEntry, markEnrichmentFailed } from '../../services/enrichment';
import { JOB, type JobHandler, type JobType } from '../types';

export const handlers: Partial<Record<JobType, JobHandler>> = {
  [JOB.enrichEntry]: (payload, ctx) => enrichEntry(payload, ctx.signal),
  [JOB.describeAttachment]: (payload, ctx) => describeAttachment(payload, ctx.signal),
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
