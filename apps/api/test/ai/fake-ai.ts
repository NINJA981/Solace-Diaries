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

export type Task =
  'analysis' | 'memories' | 'graph' | 'weekly' | 'dailyPrompt' | 'photo' | 'chat' | 'other';

/** Identify which of our prompts a request came from (by a phrase in its system instruction). */
export function taskOf(req: GenerateRequest): Task {
  const s = req.system ?? '';
  if (s.includes('light-touch analysis')) return 'analysis';
  if (s.includes('long-term memories')) return 'memories';
  if (s.includes('constellation')) return 'graph';
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

const DEFAULT_REPLIES: Record<Task, Reply> = {
  analysis: () =>
    JSON.stringify({ mood: 'calm', tags: ['Daily Life'], summary: 'You had a quiet day.' }),
  memories: () => JSON.stringify({ ops: [] }),
  graph: () => JSON.stringify({ entities: [] }),
  weekly: () => '### Your week\nYou showed up for yourself this week.',
  dailyPrompt: () => 'How is your training going this week?',
  photo: () => 'A dog running along a sandy beach at sunset.',
  chat: () => 'Here is what I found [1].',
  other: () => 'ok',
};

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
      if (this.streamDelayMs) await new Promise((r) => setTimeout(r, this.streamDelayMs));
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
