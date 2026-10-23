/**
 * Environment configuration, validated once at boot. Anything missing or malformed
 * stops the process with a readable message instead of failing later at runtime.
 */
import { z } from 'zod';

/** Env flag: 'true'/'1' → true, 'false'/'0' → false, unset/empty → `fallback`. */
const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  /** Max pooled connections (keep low on small Postgres plans). */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_JWT_SECRET: z.string().default(''),
  STORAGE_BUCKET: z.string().default('attachments'),

  WEB_ORIGIN: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),

  GEMINI_API_KEY: z.string().default(''),
  /**
   * Gemini API tier of the server key. On `free`, Google may use what is sent to improve its
   * products and every model has a small daily request quota per project, shared by all
   * users. Reported to signed-in users by GET /me/usage; the public web pages (landing,
   * privacy) read the web build's own VITE_AI_TIER instead, so change both together.
   */
  AI_TIER: z.enum(['free', 'paid']).default('free'),
  /** Default generation model: used by every task that has no GEMINI_MODEL_* of its own. */
  GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
  // Per-task models (empty = GEMINI_CHAT_MODEL). Free-tier quotas are per model, so routing
  // tasks to different models gives each task its own daily allowance.
  /** Entry enrichment: one structured call per entry (mood, tags, summary, memories, graph). */
  GEMINI_MODEL_ENRICH: z.string().default(''),
  /** Reflect answers (streamed). */
  GEMINI_MODEL_CHAT: z.string().default(''),
  /** Cached, periodic writing: weekly letters, daily prompts, later chapters and notes. */
  GEMINI_MODEL_BATCH: z.string().default(''),
  /** Photo descriptions (image input). */
  GEMINI_MODEL_VISION: z.string().default(''),
  GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  /** Interactive AI calls (search, Reflect, letters, prompts) per user per UTC day on the server key. */
  AI_DAILY_QUOTA: z.coerce.number().int().min(0).default(200),
  /**
   * Background enrichment runs (entry analysis, photo descriptions) per user per UTC day,
   * always on the server key, counted in ai_usage.enrich_runs: separate from the interactive
   * budget, so heavy Reflect use never pauses analysis of new entries (and vice versa).
   * When it is spent, jobs wait for the next UTC day instead of failing.
   */
  ENRICH_DAILY_QUOTA: z.coerce.number().int().min(0).default(150),
  /**
   * Quiet time after the last save before an entry is (re-)enriched. Autosave fires every
   * few seconds while typing; a longer wait means fewer enrichment calls per writing session.
   */
  ENRICH_DEBOUNCE_MS: z.coerce.number().int().min(0).default(20_000),
  /**
   * Retrieval thresholds, calibrated for gemini-embedding-001 at 768 dims, whose cosine
   * scores sit high: unrelated journal text lands around 0.55–0.62, relevant around 0.62+.
   * Re-calibrate if GEMINI_EMBED_MODEL changes.
   */
  SEARCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.6),
  /** Also drop vector hits more than this far below the query's best match. */
  SEARCH_RELATIVE_BAND: z.coerce.number().min(0).max(1).default(0.08),
  /** A new memory this similar to an existing one reinforces it instead of duplicating. */
  MEMORY_DEDUPE_SIMILARITY: z.coerce.number().min(0).max(1).default(0.93),
  /** Hard timeout for a single Gemini call. */
  AI_TIMEOUT_MS: z.coerce.number().int().default(45_000),
  /**
   * Streamed answers (Reflect): give up when no text has arrived after this long (0 = off),
   * so a stalled model ends in an error within seconds rather than at the stream timeout.
   */
  AI_FIRST_TOKEN_MS: z.coerce.number().int().min(0).default(20_000),

  RUN_WORKER: flag(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Trust N reverse-proxy hops for client IPs (Render = 1). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    const missing = [
      !cfg.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
      !cfg.GEMINI_API_KEY && 'GEMINI_API_KEY',
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing required production env: ${missing.join(', ')}`);
  }
  return cfg;
}

export const config = load();
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
