/**
 * The single gateway to Gemini. Every model call in the API goes through here and gets the
 * same policy: per-key clients, a hard timeout, bounded retries with jittered exponential
 * backoff on transient failures, caller-driven cancellation, validated outputs and typed
 * errors. There are no fallbacks: a failed call is an error, never a made-up answer.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { EMBEDDING_DIMS } from '../db/schema';
import { logger } from '../logger';
import { recordTokens } from '../services/quota';
import { AiBadOutputError, AiUnavailableError } from './errors';
import { googleTransport } from './google-transport';
import type {
  AiTransport,
  EmbedTaskType,
  GenerateRequest,
  Part,
  TransportFactory,
  Turn,
} from './transport';

export type { EmbedTaskType, Part, Turn } from './transport';

export type AiOptions = {
  /** Bring-your-own key from `x-gemini-key`; falls back to the server key. */
  apiKey?: string;
  /** Attribute token usage to this user. */
  userId?: string;
  /** Cancels the call (and any pending retry). */
  signal?: AbortSignal;
  /** Per-attempt timeout; defaults to AI_TIMEOUT_MS. */
  timeoutMs?: number;
};

export type Prompt = {
  system?: string;
  history?: Turn[];
  user: string | Part[];
  temperature?: number;
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

/** Test seam: swap the provider transport and shorten backoff. Clears cached clients. */
export function configureAi(opts: { transport?: TransportFactory; retryBaseMs?: number }): void {
  if (opts.transport) transportFactory = opts.transport;
  if (opts.retryBaseMs !== undefined) retryBaseMs = opts.retryBaseMs;
  transports.clear();
}

export const chatModel = () => config.GEMINI_CHAT_MODEL;
export const embedModel = () => config.GEMINI_EMBED_MODEL;

/** True when some key (BYOK or server) is available. */
export function aiConfigured(apiKey?: string): boolean {
  return Boolean(apiKey?.trim() || config.GEMINI_API_KEY);
}

function transportFor(apiKey?: string): AiTransport {
  const key = apiKey?.trim() || config.GEMINI_API_KEY;
  if (!key) throw new AiUnavailableError('No Gemini API key is configured.');
  // Keyed by hash so raw keys never sit in a map that could end up in a heap dump or log.
  const id = createHash('sha256').update(key).digest('hex');
  let t = transports.get(id);
  if (!t) {
    if (transports.size >= MAX_CACHED_CLIENTS) transports.delete(transports.keys().next().value!);
    t = transportFactory(key);
    transports.set(id, t);
  }
  return t;
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
    return {
      error: new AiUnavailableError(message, status, { cause: err }),
      retryable: RETRYABLE_STATUS.has(status),
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

async function withRetry<T>(opts: AiOptions, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const a = startAttempt(opts);
    try {
      return await run(a.signal);
    } catch (err) {
      if (opts.signal?.aborted) throw abortReason(opts.signal);
      const { error, retryable } = classify(err, a.timedOut());
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      logger.warn({ attempt, err: error.message }, 'ai call failed, retrying');
      await sleep(backoffMs(attempt), opts.signal);
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

function requestOf(prompt: Prompt, signal: AbortSignal): GenerateRequest {
  const user: Part[] = typeof prompt.user === 'string' ? [{ text: prompt.user }] : prompt.user;
  return {
    model: chatModel(),
    system: prompt.system,
    contents: [...(prompt.history ?? []), { role: 'user', parts: user }],
    temperature: prompt.temperature,
    maxOutputTokens: prompt.maxOutputTokens,
    signal,
  };
}

// ───────────────────────── public API ─────────────────────────

/** Plain text generation. Empty output is an error. */
export async function generateText(prompt: Prompt, opts: AiOptions = {}): Promise<string> {
  const transport = transportFor(opts.apiKey);
  const res = await withRetry(opts, (signal) => transport.generate(requestOf(prompt, signal)));
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
  const transport = transportFor(opts.apiKey);
  const jsonSchema = toProviderSchema(schema);
  let current = prompt;
  for (let round = 1; round <= 2; round++) {
    const res = await withRetry(opts, (signal) =>
      transport.generate({ ...requestOf(current, signal), jsonSchema }),
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
 */
export async function* streamText(prompt: Prompt, opts: AiOptions = {}): AsyncGenerator<string> {
  const transport = transportFor(opts.apiKey);
  for (let attempt = 1; ; attempt++) {
    // Streams get double the budget: the timeout covers the whole answer, not just the first byte.
    const a = startAttempt(opts, 2);
    let yielded = false;
    let tokens = 0;
    try {
      for await (const chunk of transport.stream(requestOf(prompt, a.signal))) {
        if (chunk.tokens) tokens = chunk.tokens;
        if (chunk.text) {
          yielded = true;
          yield chunk.text;
        }
      }
      track(opts, tokens);
      if (!yielded) throw new AiBadOutputError('The model returned an empty response.');
      return;
    } catch (err) {
      if (opts.signal?.aborted) throw abortReason(opts.signal);
      const { error, retryable } = classify(err, a.timedOut());
      if (yielded || !retryable || attempt >= MAX_ATTEMPTS) throw error;
      await sleep(backoffMs(attempt), opts.signal);
    } finally {
      a.dispose();
    }
  }
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
  const transport = transportFor(opts.apiKey);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const vectors = await withRetry(opts, (signal) =>
      transport.embed({
        model: embedModel(),
        texts: batch,
        taskType,
        dimensions: EMBEDDING_DIMS,
        signal,
      }),
    );
    if (vectors.length !== batch.length) {
      throw new AiBadOutputError(`Expected ${batch.length} embeddings, got ${vectors.length}.`);
    }
    for (const v of vectors) out.push(normalize(v));
  }
  // Embedding endpoints don't report usage; ~4 chars per token is the documented rule of thumb.
  track(opts, Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4));
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
