import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../../src/ai/errors';
import { retryDelayOf } from '../../src/ai/gemini';
import { deferOnRateLimit } from '../../src/jobs/handlers/index';
import { DeferJobError } from '../../src/jobs/types';

const ctx = { id: 'job', attempt: 1, signal: new AbortController().signal };

// Shape of the @google/genai ApiError message for a free-tier daily quota.
const quotaMessage =
  'got status: 429 Too Many Requests. {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[' +
  '{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"19469s"}]}}';

describe('Gemini rate limits', () => {
  it('reads the retry delay Google sends with a 429', () => {
    expect(retryDelayOf(new Error(quotaMessage))).toBe(19_469_000);
    expect(retryDelayOf(new Error('Please retry in 41.5s.'))).toBe(41_500);
    expect(retryDelayOf(new Error('HTTP 429'))).toBeUndefined();
  });

  it('defers a rate-limited job until the quota resets instead of failing it', async () => {
    const handler = deferOnRateLimit(async () => {
      throw new AiUnavailableError('Gemini responded with HTTP 429.', 429, { retryAfterMs: 19_469_000 });
    });
    const before = Date.now();
    const err = await handler({}, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeferJobError);
    const wait = (err as DeferJobError).until.getTime() - before;
    expect(wait).toBeGreaterThanOrEqual(19_469_000);
    expect(wait).toBeLessThan(19_469_000 + 5_000);
  });

  it('waits at least a minute when Google gives no delay, and never more than a day', async () => {
    const noDelay = deferOnRateLimit(async () => {
      throw new AiUnavailableError('Gemini responded with HTTP 429.', 429);
    });
    const huge = deferOnRateLimit(async () => {
      throw new AiUnavailableError('x', 429, { retryAfterMs: 9 * 24 * 3_600_000 });
    });
    const now = Date.now();
    const a = (await noDelay({}, ctx).catch((e: unknown) => e)) as DeferJobError;
    const b = (await huge({}, ctx).catch((e: unknown) => e)) as DeferJobError;
    expect(a.until.getTime() - now).toBeGreaterThanOrEqual(60_000);
    expect(b.until.getTime() - now).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
  });

  it('lets every other failure through unchanged', async () => {
    const boom = new AiUnavailableError('Gemini responded with HTTP 503.', 503);
    const handler = deferOnRateLimit(async () => {
      throw boom;
    });
    await expect(handler({}, ctx)).rejects.toBe(boom);
  });
});
