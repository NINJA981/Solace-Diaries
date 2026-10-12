import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { db } from '../src/db/client';
import { aiUsage, profiles } from '../src/db/schema';
import { HttpError } from '../src/http/errors';
import { consumeAiQuota, recordTokens } from '../src/services/quota';
import { resetDb } from './helpers';

beforeEach(resetDb);

async function newUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(profiles).values({ id, email: `${id}@example.test` });
  return id;
}

const today = () => new Date().toISOString().slice(0, 10);
const usage = async (userId: string) =>
  (
    await db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, today())))
  )[0];

describe('AI quota', () => {
  it('counts calls and stops at the daily limit on the server key', async () => {
    const userId = await newUser();
    await consumeAiQuota(userId, { usingOwnKey: false });
    expect((await usage(userId))!.calls).toBe(1);

    await db
      .update(aiUsage)
      .set({ calls: config.AI_DAILY_QUOTA - 1 })
      .where(eq(aiUsage.userId, userId));
    await consumeAiQuota(userId, { usingOwnKey: false });
    const err = await consumeAiQuota(userId, { usingOwnKey: false }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 429, code: 'ai_quota_exceeded' });
    expect((await usage(userId))!.calls).toBe(config.AI_DAILY_QUOTA);
  });

  it('never lets concurrent calls overshoot the limit', async () => {
    const userId = await newUser();
    await consumeAiQuota(userId, { usingOwnKey: false });
    await db
      .update(aiUsage)
      .set({ calls: config.AI_DAILY_QUOTA - 3 })
      .where(eq(aiUsage.userId, userId));
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => consumeAiQuota(userId, { usingOwnKey: false })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect((await usage(userId))!.calls).toBe(config.AI_DAILY_QUOTA);
  });

  it('counts but never limits bring-your-own-key calls', async () => {
    const userId = await newUser();
    await consumeAiQuota(userId, { usingOwnKey: false });
    await db
      .update(aiUsage)
      .set({ calls: config.AI_DAILY_QUOTA })
      .where(eq(aiUsage.userId, userId));
    await expect(consumeAiQuota(userId, { usingOwnKey: true })).resolves.toBeUndefined();
    expect((await usage(userId))!.calls).toBe(config.AI_DAILY_QUOTA + 1);
  });

  it('accumulates token counts', async () => {
    const userId = await newUser();
    await recordTokens(userId, 120);
    await recordTokens(userId, 30.4);
    await recordTokens(userId, 0);
    expect(await usage(userId)).toMatchObject({ tokens: 150, calls: 0 });
  });
});
