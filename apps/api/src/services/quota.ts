/**
 * Per-user daily AI budget (UTC days). Calls on the server's Gemini key are capped at
 * `AI_DAILY_QUOTA`; bring-your-own-key calls are counted but never limited.
 */
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { quotaExceeded } from '../http/errors';

const TODAY = sql`(now() at time zone 'utc')::date`;

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

export async function recordTokens(userId: string, tokens: number): Promise<void> {
  const n = Math.max(0, Math.round(tokens));
  if (n === 0) return;
  await db.execute(sql`
    insert into ai_usage (user_id, day, tokens) values (${userId}, ${TODAY}, ${n})
    on conflict (user_id, day) do update set tokens = ai_usage.tokens + ${n}`);
}
