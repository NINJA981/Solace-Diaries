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

/** Remove the Supabase auth user (final step of account deletion). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
  // Already gone (e.g. a retried deletion) counts as success.
  if (error && error.status !== 404) throw error;
}
