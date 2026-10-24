import { addDays, localDate } from '@solace/shared';
import type { GenerateRequest } from '../../src/ai/transport';
import { db } from '../../src/db/client';
import { jobs } from '../../src/db/schema';
import { handlers } from '../../src/jobs/handlers';
import type { JobType } from '../../src/jobs/types';
import { taskOf, type FakeAi } from '../ai/fake-ai';

export const today = () => localDate(new Date(), 'UTC');
export const daysAgo = (n: number) => addDays(today(), -n);

/** Generate calls that are not enrichment/chat/etc.: ours (letters, chapters, growth). */
export const featureCalls = (fake: FakeAi): GenerateRequest[] =>
  fake.generateCalls.filter((r) => taskOf(r) === 'other');

export const systemOf = (r: GenerateRequest) => r.system ?? '';

export async function runJob(type: JobType, payload: Record<string, unknown>) {
  await handlers[type]!(payload, { id: 'test', attempt: 1, signal: new AbortController().signal });
}

export const jobRows = (type: string) =>
  db.select().from(jobs).then((rows) => rows.filter((j) => j.type === type));
