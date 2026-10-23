/**
 * Per-user daily AI budget (UTC days). Calls on the server's Gemini key are capped at
 * `AI_DAILY_QUOTA`; bring-your-own-key calls are counted but never limited.
 */
import { sql } from 'drizzle-orm';
import type { AiUsage } from '@solace/shared';
import { config } from '../config';
import { db } from '../db/client';
import { quotaExceeded } from '../http/errors';

const TODAY = sql`(now() at time zone 'utc')::date`;

/**
 * Today's budgets for the Settings meter. `used` never reads above `limit` (calls made with
 * a person's own key are counted in the same row but are not capped).
 */
export async function getUsage(userId: string, opts: { ownKey: boolean }): Promise<AiUsage> {
  const rows = await db.execute<{ calls: number; enrich_runs: number }>(sql`
    select calls, enrich_runs from ai_usage where user_id = ${userId} and day = ${TODAY}`);
  const row = rows[0];
  const budget = (used: number, limit: number) => ({ used: Math.min(used, limit), limit });
  return {
    tier: config.AI_TIER,
    ownKey: opts.ownKey,
    interactive: budget(Number(row?.calls ?? 0), config.AI_DAILY_QUOTA),
    enrichment: budget(Number(row?.enrich_runs ?? 0), config.ENRICH_DAILY_QUOTA),
    resetsAt: nextUtcDay().toISOString(),
  };
}

/** Count one AI call; throws `quotaExceeded()` (429) when the server-key budget is spent. */
export async function consumeAiQuota(
  userId: string,
  opts: { usingOwnKey: boolean },
): Promise<void> {
  const limit = config.AI_DAILY_QUOTA;
  if (!opts.usingOwnKey && limit === 0) throw quotaExceeded();
  // The conditional upsert increments only while under the limit, so concurrent calls can't overshoot.
  const rows = await db.execute(sql`
    insert into ai_usage (user_id, day, calls) values (${userId}, ${TODAY}, 1)
    on conflict (user_id, day) do update set calls = ai_usage.calls + 1
    ${opts.usingOwnKey ? sql`` : sql`where ai_usage.calls < ${limit}`}
    returning calls`);
  if (rows.length === 0) throw quotaExceeded();
}

/**
 * Count one background enrichment run (entry analysis or photo description) against the
 * user's day. Kept on its own counter so heavy Reflect/search use never stops new entries
 * from being analysed, and vice versa. Returns false, without counting, when spent.
 */
export async function consumeEnrichmentBudget(userId: string): Promise<boolean> {
  const limit = config.ENRICH_DAILY_QUOTA;
  if (limit === 0) return false;
  const rows = await db.execute(sql`
    insert into ai_usage (user_id, day, enrich_runs) values (${userId}, ${TODAY}, 1)
    on conflict (user_id, day) do update set enrich_runs = ai_usage.enrich_runs + 1
    where ai_usage.enrich_runs < ${limit}
    returning enrich_runs`);
  return rows.length > 0;
}

/** Give back one enrichment run that Gemini refused (never below zero). */
export async function refundEnrichmentBudget(userId: string): Promise<void> {
  await db.execute(sql`
    update ai_usage set enrich_runs = greatest(enrich_runs - 1, 0)
    where user_id = ${userId} and day = ${TODAY}`);
}

/** Midnight UTC at the start of the next UTC day (when daily budgets reset). */
export function nextUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export async function recordTokens(userId: string, tokens: number): Promise<void> {
  const n = Math.max(0, Math.round(tokens));
  if (n === 0) return;
  await db.execute(sql`
    insert into ai_usage (user_id, day, tokens) values (${userId}, ${TODAY}, ${n})
    on conflict (user_id, day) do update set tokens = ai_usage.tokens + ${n}`);
}
