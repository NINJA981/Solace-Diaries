/**
 * Deterministic stand-in for Gemini, injected through the gateway's transport seam.
 * Embeddings are hash-seeded bag-of-words vectors, so texts that share content words are
 * genuinely closer than unrelated ones (unrelated texts land near cosine 0).
 */
import { configureAi } from '../../src/ai/gemini';
import type { AiTransport, EmbedRequest, GenerateRequest } from '../../src/ai/transport';
import { config } from '../../src/config';

const STOP = new Set(
  "the and for are but not you your with this that have had was were what when where which who how why did does from into about over under then than they them their there here been being also just very really some more most much many such only own same too can will would could should shall may might must its it's i'm title date photo untitled".split(
    ' ',
  ),
);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

export function fakeEmbedding(text: string, dims = 768): number[] {
  const v = new Array<number>(dims).fill(0);
  v[0] = 1e-3; // never the zero vector
  for (const w of contentWords(text)) {
    const rnd = mulberry32(fnv1a(w));
    for (let i = 0; i < dims; i++) v[i]! += rnd() * 2 - 1;
  }
  return v;
}

export type Task = 'enrich' | 'weekly' | 'dailyPrompt' | 'photo' | 'chat' | 'other';

/** Identify which of our prompts a request came from (by a phrase in its system instruction). */
export function taskOf(req: GenerateRequest): Task {
  const s = req.system ?? '';
  if (s.includes('You enrich one private journal entry')) return 'enrich';
  if (s.includes('weekly letter')) return 'weekly';
  if (s.includes('journaling prompt')) return 'dailyPrompt';
  if (s.includes('describe a photo')) return 'photo';
  if (s.includes('companion inside the user')) return 'chat';
  return 'other';
}

export const userText = (req: GenerateRequest) =>
  req.contents
    .at(-1)!
    .parts.map((p) => ('text' in p ? p.text : ''))
    .join('\n');

type Reply = (req: GenerateRequest) => string | Promise<string>;

/** The one structured enrichment answer (see services/enrichment.ts). */
export type EnrichAnswer = {
  mood: string;
  tags: string[];
  summary: string;
  memoryOps: Array<Record<string, unknown> | unknown>;
  entities: Array<{ name: string; kind: string } | unknown>;
  relations: Array<{ from: string; to: string } | unknown>;
};

/** An enrichment reply: a calm, quiet day with nothing to remember, unless overridden. */
export const enrichReply = (over: Partial<EnrichAnswer> = {}) =>
  JSON.stringify({
    mood: 'calm',
    tags: ['Daily Life'],
    summary: 'You had a quiet day.',
    memoryOps: [],
    entities: [],
    relations: [],
    ...over,
  });

/** The memory blocks the model was shown, as `handle → content`. */
export function memoryHandles(req: GenerateRequest): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of userText(req).matchAll(
    /<memory id="(m\d+)" kind="\w+">\n([^\n]*)\n<\/memory>/g,
  )) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

const DEFAULT_REPLIES: Record<Task, Reply> = {
  enrich: () => enrichReply(),
  weekly: () => '### Your week\nYou showed up for yourself this week.',
  dailyPrompt: () => 'How is your training going this week?',
  photo: () => 'A dog running along a sandy beach at sunset.',
  chat: () => 'Here is what I found [1].',
  other: () => 'ok',
};

/** Like a real transport, a slow stream stops waiting the moment its request is aborted. */
const sleepUnlessAborted = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class FakeAi {
  generateCalls: GenerateRequest[] = [];
  streamCalls: GenerateRequest[] = [];
  embedCalls: EmbedRequest[] = [];
  replies: Partial<Record<Task, Reply>> = {};
  /** Text pieces for streamed answers; defaults to the chat reply split on spaces. */
  streamPieces?: (req: GenerateRequest) => string[];
  /** Delay between streamed pieces (ms). */
  streamDelayMs = 0;
  /** Errors to throw on the next generate/stream/embed calls (consumed in order). */
  failures: unknown[] = [];
  /** Last signal handed to a stream call, to assert cancellation. */
  lastStreamSignal?: AbortSignal;

  readonly transport: AiTransport = {
    generate: async (req) => {
      this.generateCalls.push(req);
      this.maybeFail();
      const reply = this.replies[taskOf(req)] ?? DEFAULT_REPLIES[taskOf(req)];
      return { text: await reply(req), tokens: 10 };
    },
    stream: (req) => this.stream(req),
    embed: async (req) => {
      this.embedCalls.push(req);
      this.maybeFail();
      return req.texts.map((t) => fakeEmbedding(t, req.dimensions));
    },
  };

  private async *stream(req: GenerateRequest) {
    this.streamCalls.push(req);
    this.lastStreamSignal = req.signal;
    this.maybeFail();
    const full = await (this.replies.chat ?? DEFAULT_REPLIES.chat)(req);
    const pieces = this.streamPieces?.(req) ?? full.split(/(?<= )/);
    for (const text of pieces) {
      if (this.streamDelayMs) await sleepUnlessAborted(this.streamDelayMs, req.signal);
      req.signal.throwIfAborted();
      yield { text, tokens: 5 };
    }
  }

  private maybeFail() {
    const err = this.failures.shift();
    if (err !== undefined) throw err;
  }

  calls(task: Task): GenerateRequest[] {
    return this.generateCalls.filter((r) => taskOf(r) === task);
  }

  reset(): void {
    this.generateCalls = [];
    this.streamCalls = [];
    this.embedCalls = [];
    this.replies = {};
    this.streamPieces = undefined;
    this.streamDelayMs = 0;
    this.failures = [];
  }
}

/** Install a fresh fake as the gateway transport, with a server key set and instant retries. */
export function installFakeAi(): FakeAi {
  const fake = new FakeAi();
  (config as { GEMINI_API_KEY: string }).GEMINI_API_KEY = 'test-server-key';
  configureAi({ transport: () => fake.transport, retryBaseMs: 1 });
  return fake;
}

export const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

/** The @google/genai error for a spent free-tier daily quota: 429 with a RetryInfo delay. */
export const quotaSpent = (retryDelaySeconds: number) =>
  Object.assign(
    new Error(
      `got status: 429 Too Many Requests. {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${retryDelaySeconds}s"}]}}`,
    ),
    { status: 429 },
  );

/**
 * A free-tier per-day quota 429 as Google reports it: a QuotaFailure naming the per-day
 * quota, often with a SHORT RetryInfo ("retry in 22s") or none at all.
 */
export const quotaPerDay = (retryDelaySeconds?: number) =>
  Object.assign(
    new Error(
      `got status: 429 Too Many Requests. {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}${
        retryDelaySeconds === undefined
          ? ''
          : `,{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${retryDelaySeconds}s"}`
      }]}}`,
    ),
    { status: 429 },
  );

/** A burst (per-minute) 429 that asks for a short wait. */
export const burstLimited = (retryDelaySeconds: number) =>
  Object.assign(new Error(`Please retry in ${retryDelaySeconds}s.`), { status: 429 });
