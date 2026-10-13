import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let client: SupabaseClient | undefined;

/** Service-role Supabase client (storage + auth admin). Server-side only; never expose the key. */
export function supabaseAdmin(): SupabaseClient {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  client ??= createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/**
 * Does the Supabase auth user still exist? false only on a definite "not found"; any other
 * failure (network, 5xx, misconfiguration) throws so the caller can answer 503.
 */
export async function authUserExists(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().auth.admin.getUserById(userId);
  if (!error) return Boolean(data.user);
  if (error.status === 404) return false;
  throw error;
}

/** Remove the Supabase auth user (final step of account deletion). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
  // Already gone (e.g. a retried deletion) counts as success.
  if (error && error.status !== 404) throw error;
}
