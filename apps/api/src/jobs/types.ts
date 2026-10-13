/**
 * Job queue contract. The platform layer (jobs/queue.ts) owns storage, claiming, retries
 * and backoff; the intelligence layer (jobs/handlers/*) owns what each job does.
 */
export const JOB = {
  /** payload: { entryId, userId, version } — analyze + chunk + embed + memories + graph. */
  enrichEntry: 'entry.enrich',
  /** payload: { attachmentId, userId } — describe a photo, then re-enrich its entry. */
  describeAttachment: 'attachment.describe',
} as const;
export type JobType = (typeof JOB)[keyof typeof JOB];

export type JobContext = { id: string; attempt: number; signal: AbortSignal };

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<void>;

/** Throw this to fail a job permanently (no retries), e.g. the entry was deleted. */
export class PermanentJobError extends Error {}

/**
 * Throw this to put a job back in the queue until `until` without counting the attempt
 * (e.g. the user's daily enrichment budget is spent). Not a failure: no retry backoff,
 * no dead-lettering.
 */
export class DeferJobError extends Error {
  constructor(
    readonly until: Date,
    message = 'Deferred',
  ) {
    super(message);
    this.name = 'DeferJobError';
  }
}
