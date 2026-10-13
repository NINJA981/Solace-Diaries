/**
 * Runtime configuration from Vite env. Validated once at startup (see main.tsx):
 * a production build without the required values fails loudly instead of silently
 * talking to localhost.
 */

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

const rawApi = clean(import.meta.env.VITE_API_URL);
const rawSupabaseUrl = clean(import.meta.env.VITE_SUPABASE_URL);
const rawSupabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const config = {
  /** API origin, no trailing slash. Routes are mounted under `${apiUrl}/api`. */
  apiUrl: rawApi || 'http://localhost:8787',
  supabaseUrl: rawSupabaseUrl || 'http://127.0.0.1:55321',
  supabaseAnonKey: rawSupabaseKey || 'missing-anon-key',
  /** False in dev when Supabase env is missing: auth screens explain instead of failing. */
  supabaseConfigured: Boolean(rawSupabaseUrl && rawSupabaseKey),
  /**
   * Which Gemini API tier the server key is on. It decides what we may promise about AI
   * data use, so it defaults to 'free' (the cautious claim) unless VITE_AI_TIER=paid.
   */
  aiTier: (import.meta.env.VITE_AI_TIER === 'paid' ? 'paid' : 'free') as 'free' | 'paid',
} as const;

/** Throws a ConfigError describing every missing value. Only enforced in production builds. */
export function assertConfig(isProd: boolean = import.meta.env.PROD): void {
  if (!isProd) return;
  const missing: string[] = [];
  if (!rawApi) missing.push('VITE_API_URL');
  if (!rawSupabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!rawSupabaseKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length) {
    throw new ConfigError(
      `Solace was built without ${missing.join(', ')}. Set ${missing.length > 1 ? 'them' : 'it'} in the hosting environment and rebuild.`,
    );
  }
}
