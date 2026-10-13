/**
 * The supabase-js client. Imported dynamically (via `getSupabase`) everywhere so the
 * public landing page doesn't download the auth SDK until it's needed.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';

export const supabase: SupabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // /auth/callback exchanges the code itself so it can show precise errors.
    detectSessionInUrl: false,
  },
});
