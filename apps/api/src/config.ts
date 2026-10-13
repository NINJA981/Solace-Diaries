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
  GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  AI_DAILY_QUOTA: z.coerce.number().int().min(0).default(200),
  /**
   * Background enrichment runs (entry analysis, photo descriptions) per user per UTC day,
   * always on the server key. They count in the same ai_usage.calls counter as interactive
   * calls, but only run while that counter is below this lower ceiling, so interactive
   * features keep AI_DAILY_QUOTA - ENRICH_DAILY_QUOTA calls in reserve. When it is spent,
   * jobs wait for the next UTC day instead of failing.
   */
  ENRICH_DAILY_QUOTA: z.coerce.number().int().min(0).default(150),
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
