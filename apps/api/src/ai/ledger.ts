/**
 * What the server's Gemini key is spending, per task, and which models are out of quota.
 *
 * - Usage: requests and tokens per task (and the model it runs on) for the current quota
 *   day, so the logs show which task spends which model's allowance. Gemini's free-tier
 *   quotas are per project *and per model*, which is why tasks are routed to models at all.
 * - Pauses: when Gemini answers 429 with a retry delay (a spent daily quota says "come back
 *   in 5 hours"), that key + model is paused until then. Nothing else is sent just to be
 *   refused, and callers can degrade before spending anything (see `pausedFor`).
 *
 * State is per process (Solace runs a single API instance) and is lost on restart: Google's
 * own 429 stays the authority, this only stops us asking again too early.
 */
import { localDate } from '@solace/shared';

/** A generation task, or the embedding model (which has its own quota). */
export type Lane = 'enrich' | 'chat' | 'batch' | 'vision' | 'embed';

export type LaneUsage = {
  model: string;
  /** Requests that reached Gemini on the server key today (refused ones included). */
  requests: number;
  tokens: number;
  /** Requests Gemini refused with 429. */
  rateLimited: number;
};

/** Gemini's per-day quotas reset at midnight Pacific time. */
const QUOTA_TIMEZONE = 'America/Los_Angeles';
const MAX_PAUSES = 256;

let day = '';
let lanes = new Map<Lane, LaneUsage>();
type Pause = { until: number; spent: boolean; pinned: boolean };
/** `${keyId}:${model}` → epoch ms until which calls are pointless. */
const pauses = new Map<string, Pause>();

/** Start a fresh tally when the quota day has turned. */
function rollOver(): void {
  const today = localDate(new Date(), QUOTA_TIMEZONE);
  if (today !== day) {
    day = today;
    lanes = new Map();
  }
}

function laneToday(lane: Lane, model: string): LaneUsage {
  rollOver();
  let u = lanes.get(lane);
  if (!u || u.model !== model) {
    u = { model, requests: 0, tokens: 0, rateLimited: 0 };
    lanes.set(lane, u);
  }
  return u;
}

/** Count one server-key request for `lane`; returns that lane's usage so far today. */
export function recordRequest(
  lane: Lane,
  model: string,
  outcome: { tokens?: number; rateLimited?: boolean },
): LaneUsage {
  const u = laneToday(lane, model);
  u.requests += 1;
  u.tokens += Math.max(0, Math.round(outcome.tokens ?? 0));
  if (outcome.rateLimited) u.rateLimited += 1;
  return { ...u };
}

/** Today's server-key usage per task (quota day = Pacific time, like Gemini's). */
export function usageByLane(): { day: string; lanes: Partial<Record<Lane, LaneUsage>> } {
  rollOver();
  return { day, lanes: Object.fromEntries([...lanes].map(([k, v]) => [k, { ...v }])) };
}

/** Longest pause we keep: past a day, a quota has reset (or the delay was malformed). */
export const MAX_PAUSE_MS = 25 * 60 * 60_000;

/**
 * Milliseconds until Gemini's per-day quotas reset: midnight Pacific time. DST days are
 * off by at most an hour, which is fine for a pause that only saves refused requests.
 */
export function msUntilQuotaReset(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TIMEZONE,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnight =
    (part('hour') * 3600 + part('minute') * 60 + part('second')) * 1000 + (now % 1000);
  return Math.max(1000, 24 * 3_600_000 - sinceMidnight);
}

/**
 * Pause `model` on this key for `ms`. A later, shorter pause never shortens a longer one.
 * `pinned` pauses (the server key's, at most one per model) are never evicted to make room:
 * a flood of short pauses on people's own keys must not unpause the key everyone shares.
 */
export function pauseModel(
  keyId: string,
  model: string,
  ms: number,
  now = Date.now(),
  opts: { spent?: boolean; pinned?: boolean } = {},
): void {
  if (!(ms > 0)) return;
  const id = `${keyId}:${model}`;
  if (!pauses.has(id) && pauses.size >= MAX_PAUSES) makeRoom(now);
  const prev = pauses.get(id);
  const until = now + Math.min(ms, MAX_PAUSE_MS);
  if (prev && prev.until >= until) return;
  pauses.set(id, {
    until,
    spent: Boolean(opts.spent),
    pinned: Boolean(opts.pinned) || Boolean(prev?.pinned),
  });
}

/** Drop expired pauses; if still full, the unpinned pause that ends soonest. */
function makeRoom(now: number): void {
  for (const [id, p] of pauses) if (p.until <= now) pauses.delete(id);
  if (pauses.size < MAX_PAUSES) return;
  let victim: string | undefined;
  let soonest = Infinity;
  for (const [id, p] of pauses) {
    if (!p.pinned && p.until < soonest) {
      soonest = p.until;
      victim = id;
    }
  }
  pauses.delete(victim ?? pauses.keys().next().value!);
}

/** The pause on `model` for this key, if any: how long is left and whether a quota is spent. */
export function pauseOf(
  keyId: string,
  model: string,
  now = Date.now(),
): { ms: number; spent: boolean } | null {
  const id = `${keyId}:${model}`;
  const p = pauses.get(id);
  if (!p) return null;
  if (p.until <= now) {
    pauses.delete(id);
    return null;
  }
  return { ms: p.until - now, spent: p.spent };
}

/** Milliseconds until `model` may be called again on this key (0 = go ahead). */
export function pausedFor(keyId: string, model: string, now = Date.now()): number {
  return pauseOf(keyId, model, now)?.ms ?? 0;
}

/** Test seam: forget all usage and pauses. */
export function resetLedger(): void {
  day = '';
  lanes = new Map();
  pauses.clear();
}
