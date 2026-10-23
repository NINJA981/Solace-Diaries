/**
 * The single gateway to Gemini. Every model call in the API goes through here and gets the
 * same policy: per-task model routing, per-key clients, a hard timeout, bounded retries with
 * jittered exponential backoff on transient failures (honouring Gemini's retry delay),
 * caller-driven cancellation, validated outputs and typed errors. There are no fallbacks: a
 * failed call is an error, never a made-up answer.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { EMBEDDING_DIMS } from '../db/schema';
import { logger } from '../logger';
import { recordTokens } from '../services/quota';
import { AiBadOutputError, AiUnavailableError, SPENT_QUOTA_WAIT_MS } from './errors';
import { googleTransport } from './google-transport';
import {
  msUntilQuotaReset,
  pauseModel,
  pauseOf,
  pausedFor,
  recordRequest,
  resetLedger,
  usageByLane,
  type Lane,
} from './ledger';
import type {
  AiTransport,
  EmbedTaskType,
  GenerateRequest,
  Part,
  TransportFactory,
  Turn,
} from './transport';

export type { EmbedTaskType, Part, Turn } from './transport';
export type { Lane } from './ledger';

/**
 * What a generation is for. Each task runs on its own configurable model, so on Gemini's
 * free tier (a daily request quota per model) the tasks don't eat into each other's allowance.
 */
export type AiTask = 'enrich' | 'chat' | 'batch' | 'vision';

export type AiOptions = {
  /** Bring-your-own key from `x-gemini-key`; falls back to the server key. */
  apiKey?: string;
  /** Attribute token usage to this user. */
  userId?: string;
  /** Cancels the call (and any pending retry). */
  signal?: AbortSignal;
  /** Per-attempt timeout; defaults to AI_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Most time spent sleeping between retries, across the whole call (default 5s). A 429
   * asking for longer is thrown at once, so interactive callers can fall back and jobs can
   * defer instead of sleeping on a refusal.
   */
  maxInlineWaitMs?: number;
  /** Streams: abort if no text arrives within this long; defaults to AI_FIRST_TOKEN_MS. */
  firstTokenMs?: number;
};

export type Prompt = {
  /** Picks the model (see `modelFor`). */
  task: AiTask;
  system?: string;
  history?: Turn[];
  user: string | Part[];
  /** Ignored on Gemini 3+ models, which are tuned for their default temperature. */
  temperature?: number;
  /** Budget for the visible answer; thinking gets its own headroom on top (see below). */
  maxOutputTokens?: number;
};

const MAX_ATTEMPTS = 3;
const EMBED_BATCH = 100;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

let transportFactory: TransportFactory = googleTransport;
let retryBaseMs = 500;
const transports = new Map<string, AiTransport>();
const MAX_CACHED_CLIENTS = 64;

/**
 * Test seam: swap the provider transport and shorten backoff. Clears cached clients, the
 * per-task usage and any quota pauses.
 */
export function configureAi(opts: { transport?: TransportFactory; retryBaseMs?: number }): void {
  if (opts.transport) transportFactory = opts.transport;
  if (opts.retryBaseMs !== undefined) retryBaseMs = opts.retryBaseMs;
  transports.clear();
  resetLedger();
}

/** The model a task runs on: its GEMINI_MODEL_* override, else GEMINI_CHAT_MODEL. */
export function modelFor(task: AiTask): string {
  const routed: Record<AiTask, string> = {
    enrich: config.GEMINI_MODEL_ENRICH,
    chat: config.GEMINI_MODEL_CHAT,
    batch: config.GEMINI_MODEL_BATCH,
    vision: config.GEMINI_MODEL_VISION,
  };
  return routed[task].trim() || config.GEMINI_CHAT_MODEL;
}
export const embedModel = () => config.GEMINI_EMBED_MODEL;
const modelOf = (lane: Lane) => (lane === 'embed' ? embedModel() : modelFor(lane));

/** True when some key (BYOK or server) is available. */
export function aiConfigured(apiKey?: string): boolean {
  return Boolean(apiKey?.trim() || config.GEMINI_API_KEY);
}

// Keyed by hash so raw keys never sit in a map that could end up in a heap dump or log.
const keyIdOf = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Milliseconds until `lane`'s model may be called again with this key (0 = go ahead): set
 * when Gemini refused with a retry delay, e.g. a spent free-tier daily quota. Lets callers
 * degrade before they spend the user's budget or open a stream.
 */
export function aiPausedMs(lane: Lane, apiKey?: string): number {
  const key = apiKey?.trim() || config.GEMINI_API_KEY;
  return key ? pausedFor(keyIdOf(key), modelOf(lane)) : 0;
}

/**
 * Fail now, the way Gemini would (429 with its retry delay), when any of these lanes is
 * paused: callers check before spending a person's budget or opening a stream.
 */
export function assertAiNotPaused(lanes: Lane[], apiKey?: string): void {
  const key = apiKey?.trim() || config.GEMINI_API_KEY;
  if (!key) return;
  const keyId = keyIdOf(key);
  const paused = lanes.flatMap((lane) => pauseOf(keyId, modelOf(lane)) ?? []);
  if (paused.length === 0) return;
  throw new AiUnavailableError('Gemini asked us to wait before calling again.', 429, {
    retryAfterMs: Math.max(...paused.map((p) => p.ms)),
    spent: paused.some((p) => p.spent),
  });
}

/** Today's server-key requests and tokens per task, with the model each ran on. */
export const aiTaskUsage = usageByLane;

/** One logical call: which client, model and quota it runs against. */
type Call = { transport: AiTransport; keyId: string; model: string; lane: Lane; ownKey: boolean };

function callFor(lane: Lane, opts: AiOptions): Call {
  const own = opts.apiKey?.trim();
  const key = own || config.GEMINI_API_KEY;
  if (!key) throw new AiUnavailableError('No Gemini API key is configured.');
  const keyId = keyIdOf(key);
  const model = modelOf(lane);
  const paused = pauseOf(keyId, model);
  if (paused) {
    throw new AiUnavailableError(`Gemini asked us to wait before calling ${model} again.`, 429, {
      retryAfterMs: paused.ms,
      spent: paused.spent,
    });
  }
  let transport = transports.get(keyId);
  if (!transport) {
    if (transports.size >= MAX_CACHED_CLIENTS) transports.delete(transports.keys().next().value!);
    transport = transportFactory(key);
    transports.set(keyId, transport);
  }
  return { transport, keyId, model, lane, ownKey: Boolean(own) };
}

// ───────────────────────── retry policy ─────────────────────────

type Attempt = { signal: AbortSignal; timedOut: () => boolean; dispose: () => void };

function startAttempt(opts: AiOptions, scale = 1): Attempt {
  const timer = new AbortController();
  const handle = setTimeout(
    () => timer.abort(new DOMException('AI call timed out', 'TimeoutError')),
    (opts.timeoutMs ?? config.AI_TIMEOUT_MS) * scale,
  );
  const signal = opts.signal ? AbortSignal.any([opts.signal, timer.signal]) : timer.signal;
  return { signal, timedOut: () => timer.signal.aborted, dispose: () => clearTimeout(handle) };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

/** Default for AiOptions.maxInlineWaitMs. */
const INLINE_WAIT_BUDGET_MS = 5_000;

const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : '';

/** Gemini's 429 carries google.rpc.RetryInfo, e.g. "retryDelay": "19469s", inside the message. */
export function retryDelayOf(err: unknown): number | undefined {
  const text = messageOf(err);
  const m =
    text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ??
    text.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/**
 * The quotas a 429 names (google.rpc.QuotaFailure), e.g.
 * "GenerateRequestsPerDayPerProjectPerModel-FreeTier".
 */
export function quotaIdsOf(err: unknown): string[] {
  return [...messageOf(err).matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * How a 429 should be treated. A per-day quota is spent until Gemini's daily reset whatever
 * its RetryInfo says (free-tier daily refusals often ask for well under a minute), and so is
 * any quota that asks for a long wait. Anything else is a burst limit.
 */
export function rateLimitOf(
  err: unknown,
  now = Date.now(),
): { retryAfterMs?: number; spent: boolean } {
  const delay = retryDelayOf(err);
  if (quotaIdsOf(err).some((id) => /PerDay|Daily/i.test(id))) {
    return { retryAfterMs: Math.max(delay ?? 0, msUntilQuotaReset(now)), spent: true };
  }
  return { retryAfterMs: delay, spent: (delay ?? 0) >= SPENT_QUOTA_WAIT_MS };
}

/** Turn whatever a transport threw into our error vocabulary, plus whether to retry. */
function classify(err: unknown, timedOut: boolean): { error: Error; retryable: boolean } {
  if (err instanceof AiBadOutputError || err instanceof AiUnavailableError) {
    return { error: err, retryable: false };
  }
  if (timedOut)
    return {
      error: new AiUnavailableError('The AI call timed out.', undefined, { cause: err }),
      retryable: false,
    };
  const status =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
  if (status !== undefined) {
    const message =
      status === 400 || status === 401 || status === 403
        ? 'Gemini rejected the request (check the API key).'
        : `Gemini responded with HTTP ${status}.`;
    const limit = status === 429 ? rateLimitOf(err) : { spent: false };
    return {
      error: new AiUnavailableError(message, status, { cause: err, ...limit }),
      // A spent quota isn't worth retrying; how long a burst limit may be slept on is up to
      // the caller's inline-wait budget (see inlineWaits).
      retryable: RETRYABLE_STATUS.has(status) && !limit.spent,
    };
  }
  const code =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code;
  const network =
    (code !== undefined && NETWORK_CODES.has(code)) ||
    (err instanceof TypeError && /fetch failed/i.test(err.message));
  return {
    error: new AiUnavailableError(
      network ? 'Could not reach Gemini.' : 'The AI call failed.',
      undefined,
      { cause: err },
    ),
    retryable: network,
  };
}

function backoffMs(attempt: number): number {
  // Full jitter: uniform in [base·2^(n-1) / 2, base·2^(n-1)].
  const cap = retryBaseMs * 2 ** (attempt - 1);
  return cap / 2 + Math.random() * (cap / 2);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Per-task accounting for one request that reached (or may have reached) Gemini. */
function account(call: Call, outcome: { tokens?: number; error?: Error }): void {
  if (call.ownKey) return; // a person's own key spends their quota, not Solace's
  const rateLimited = outcome.error instanceof AiUnavailableError && outcome.error.status === 429;
  const u = recordRequest(call.lane, call.model, { tokens: outcome.tokens, rateLimited });
  if (!outcome.error) {
    logger.info(
      {
        task: call.lane,
        model: call.model,
        tokens: outcome.tokens ?? 0,
        requestsToday: u.requests,
      },
      'ai request',
    );
  }
}

/**
 * A final 429 that came with a retry delay pauses this key + model until then, so nothing
 * else is sent just to be refused (a spent free-tier daily quota asks for hours).
 */
function noteRefusal(call: Call, error: Error): void {
  if (!(error instanceof AiUnavailableError) || error.status !== 429) return;
  if (!error.retryAfterMs) return;
  pauseModel(call.keyId, call.model, error.retryAfterMs, Date.now(), {
    spent: error.spent,
    // The shared server key's pauses are never evicted to make room for people's own keys.
    pinned: !call.ownKey,
  });
  logger.warn(
    {
      task: call.lane,
      model: call.model,
      retryAfterMs: error.retryAfterMs,
      spent: error.spent,
      ownKey: call.ownKey,
    },
    'gemini refused; pausing this model',
  );
}

/** Whether the provider plausibly received the attempt (anything but a connection failure). */
const reachedProvider = (error: Error, timedOut: boolean) =>
  timedOut || (error instanceof AiUnavailableError && error.status !== undefined);

/** Wait before the next attempt: the backoff, or longer if Gemini said when to come back. */
function retryWaitMs(attempt: number, error: Error): number {
  const asked = error instanceof AiUnavailableError ? (error.retryAfterMs ?? 0) : 0;
  return Math.max(backoffMs(attempt), asked);
}

/**
 * Sleeps between retries, bounded by the call's inline-wait budget. `next` returns the wait
 * before another attempt, or null when that wait would overrun the budget (the error is then
 * surfaced at once, so the caller can fall back or defer instead of sleeping on it).
 */
function inlineWaits(opts: AiOptions) {
  let left = opts.maxInlineWaitMs ?? INLINE_WAIT_BUDGET_MS;
  return {
    next(attempt: number, error: Error): number | null {
      const wait = retryWaitMs(attempt, error);
      if (wait > left) return null;
      left -= wait;
      return wait;
    },
  };
}

async function withRetry<T>(
  call: Call,
  opts: AiOptions,
  run: (signal: AbortSignal) => Promise<T>,
  tokensOf: (value: T) => number = () => 0,
): Promise<T> {
  const waits = inlineWaits(opts);
  for (let attempt = 1; ; attempt++) {
    const a = startAttempt(opts);
    try {
      const value = await run(a.signal);
      account(call, { tokens: tokensOf(value) });
      return value;
    } catch (err) {
      if (opts.signal?.aborted) throw abortReason(opts.signal);
      const { error, retryable } = classify(err, a.timedOut());
      if (reachedProvider(error, a.timedOut())) account(call, { error });
      const wait = retryable && attempt < MAX_ATTEMPTS ? waits.next(attempt, error) : null;
      if (wait === null) {
        noteRefusal(call, error);
        throw error;
      }
      logger.warn({ attempt, task: call.lane, err: error.message }, 'ai call failed, retrying');
      await sleep(wait, opts.signal);
    } finally {
      a.dispose();
    }
  }
}

function track(opts: AiOptions, tokens: number): void {
  if (!opts.userId || tokens <= 0) return;
  recordTokens(opts.userId, tokens).catch((err: unknown) =>
    logger.warn({ err }, 'recordTokens failed'),
  );
}

/**
 * Gemini 3 and later are tuned for their default temperature; Google warns that lowering it
 * can cause looping or degraded output (ai.google.dev/gemini-api/docs/gemini-3), and newer
 * models ignore it. Rolling `-latest` aliases point at current models, so they count too.
 */
export function usesDefaultSampling(model: string): boolean {
  const version = /^(?:models\/)?gemini-(\d+)/.exec(model);
  return version ? Number(version[1]) >= 3 : /-latest$/.test(model);
}

/**
 * Thought tokens count toward maxOutputTokens (ai.google.dev/gemini-api/docs/thinking), and
 * current Flash models think by default, so a tight cap can be spent on thinking and come
 * back empty — a wasted request. Caps exist to bound runaway output, so they get headroom.
 */
export const THINKING_HEADROOM_TOKENS = 8_192;

function requestOf(call: Call, prompt: Prompt, signal: AbortSignal): GenerateRequest {
  const user: Part[] = typeof prompt.user === 'string' ? [{ text: prompt.user }] : prompt.user;
  return {
    model: call.model,
    system: prompt.system,
    contents: [...(prompt.history ?? []), { role: 'user', parts: user }],
    temperature: usesDefaultSampling(call.model) ? undefined : prompt.temperature,
    maxOutputTokens:
      prompt.maxOutputTokens === undefined
        ? undefined
        : prompt.maxOutputTokens + THINKING_HEADROOM_TOKENS,
    signal,
  };
}

// ───────────────────────── public API ─────────────────────────

const tokensOfResult = (r: { tokens: number }) => r.tokens;
/** Embedding endpoints don't report usage; ~4 chars per token is the documented rule of thumb. */
const approxTokens = (texts: string[]) => Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);

/** Plain text generation. Empty output is an error. */
export async function generateText(prompt: Prompt, opts: AiOptions = {}): Promise<string> {
  const call = callFor(prompt.task, opts);
  const res = await withRetry(
    call,
    opts,
    (signal) => call.transport.generate(requestOf(call, prompt, signal)),
    tokensOfResult,
  );
  track(opts, res.tokens);
  const text = res.text.trim();
  if (!text) throw new AiBadOutputError('The model returned an empty response.');
  return text;
}

/**
 * JSON-mode generation validated with zod. One repair round-trip on invalid output (the
 * model sees its own answer and the validation errors), then AiBadOutputError.
 */
export async function generateJson<S extends z.ZodType>(
  schema: S,
  prompt: Prompt,
  opts: AiOptions = {},
): Promise<z.output<S>> {
  const call = callFor(prompt.task, opts);
  const jsonSchema = toProviderSchema(schema);
  let current = prompt;
  for (let round = 1; round <= 2; round++) {
    const res = await withRetry(
      call,
      opts,
      (signal) => call.transport.generate({ ...requestOf(call, current, signal), jsonSchema }),
      tokensOfResult,
    );
    track(opts, res.tokens);
    const problem = validate(schema, res.text);
    if (problem.ok) return problem.value;
    if (round === 2)
      throw new AiBadOutputError(`Model output failed validation: ${problem.reason}`);
    current = {
      ...prompt,
      history: [
        ...(prompt.history ?? []),
        {
          role: 'user',
          parts: typeof prompt.user === 'string' ? [{ text: prompt.user }] : prompt.user,
        },
        { role: 'model', parts: [{ text: res.text.slice(0, 4000) }] },
      ],
      user: `That output was invalid (${problem.reason}). Reply again with only JSON that matches the schema exactly.`,
    };
  }
  throw new AiBadOutputError('unreachable');
}

function validate<S extends z.ZodType>(
  schema: S,
  text: string,
): { ok: true; value: z.output<S> } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, reason };
}

/** Keywords Gemini's `responseJsonSchema` understands; everything else is stripped. */
const SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  '$ref',
  '$defs',
]);

function prune(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(prune);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'const') out.enum = [v];
    if (!SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties' || k === '$defs') {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, prune(s)]),
      );
    } else {
      out[k] = prune(v);
    }
  }
  return out;
}

export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  return prune(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as Record<
    string,
    unknown
  >;
}

/**
 * Streamed text. Retries only happen before the first token reaches the caller; once text
 * has been yielded a failure is surfaced, because replaying would duplicate output.
 * A stream that produces no text within AI_FIRST_TOKEN_MS is abandoned (a hung or stalled
 * model would otherwise hold the person for the whole stream timeout).
 */
export async function* streamText(prompt: Prompt, opts: AiOptions = {}): AsyncGenerator<string> {
  const call = callFor(prompt.task, opts);
  const waits = inlineWaits(opts);
  for (let attempt = 1; ; attempt++) {
    // Streams get double the budget: the timeout covers the whole answer, not just the first byte.
    const a = startAttempt(opts, 2);
    const first = firstTokenWatch(opts);
    let yielded = false;
    let tokens = 0;
    let finished = false;
    try {
      const signal = AbortSignal.any([a.signal, first.signal]);
      for await (const chunk of call.transport.stream(requestOf(call, prompt, signal))) {
        if (chunk.tokens) tokens = chunk.tokens;
        if (chunk.text) {
          first.arrived();
          yielded = true;
          yield chunk.text;
        }
      }
      finished = true;
      account(call, { tokens });
      track(opts, tokens);
      if (!yielded) throw new AiBadOutputError('The model returned an empty response.');
      return;
    } catch (err) {
      if (finished) throw err;
      // A stream the caller abandoned (or that failed after text arrived) still cost a request.
      if (opts.signal?.aborted) {
        if (yielded) account(call, { tokens });
        throw abortReason(opts.signal);
      }
      const { error, retryable } = first.expired()
        ? {
            error: new AiUnavailableError('Gemini did not start answering in time.', undefined, {
              cause: err,
            }),
            retryable: false,
          }
        : classify(err, a.timedOut());
      if (yielded || first.expired() || reachedProvider(error, a.timedOut())) {
        account(call, { error });
      }
      const wait =
        !yielded && retryable && attempt < MAX_ATTEMPTS ? waits.next(attempt, error) : null;
      if (wait === null) {
        noteRefusal(call, error);
        throw error;
      }
      await sleep(wait, opts.signal);
    } finally {
      a.dispose();
      first.dispose();
    }
  }
}

/** Aborts a stream attempt when no text has arrived within the first-token limit. */
function firstTokenWatch(opts: AiOptions) {
  const ms = opts.firstTokenMs ?? config.AI_FIRST_TOKEN_MS;
  const controller = new AbortController();
  let expired = false;
  const handle =
    ms > 0
      ? setTimeout(() => {
          expired = true;
          controller.abort(new DOMException('No first token in time', 'TimeoutError'));
        }, ms)
      : undefined;
  return {
    signal: controller.signal,
    arrived: () => clearTimeout(handle),
    expired: () => expired,
    dispose: () => clearTimeout(handle),
  };
}

/**
 * Embeds texts in provider-sized batches. Vectors are requested at EMBEDDING_DIMS and
 * L2-normalised (truncated Matryoshka outputs are not unit length), so cosine distance
 * and dot product agree.
 */
export async function embedTexts(
  texts: string[],
  taskType: EmbedTaskType,
  opts: AiOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const call = callFor('embed', opts);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const vectors = await withRetry(
      call,
      opts,
      (signal) =>
        call.transport.embed({
          model: call.model,
          texts: batch,
          taskType,
          dimensions: EMBEDDING_DIMS,
          signal,
        }),
      () => approxTokens(batch),
    );
    if (vectors.length !== batch.length) {
      throw new AiBadOutputError(`Expected ${batch.length} embeddings, got ${vectors.length}.`);
    }
    for (const v of vectors) out.push(normalize(v));
  }
  track(opts, approxTokens(texts));
  return out;
}

export async function embedText(
  text: string,
  taskType: EmbedTaskType,
  opts: AiOptions = {},
): Promise<number[]> {
  const [v] = await embedTexts([text], taskType, opts);
  return v!;
}

export function normalize(v: number[]): number[] {
  if (v.length !== EMBEDDING_DIMS) {
    throw new AiBadOutputError(`Expected a ${EMBEDDING_DIMS}-d embedding, got ${v.length}.`);
  }
  let sum = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) throw new AiBadOutputError('Embedding contains non-finite values.');
    sum += x * x;
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) throw new AiBadOutputError('Embedding is the zero vector.');
  return v.map((x) => x / norm);
}
