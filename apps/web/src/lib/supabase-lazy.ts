import type { SupabaseClient } from '@supabase/supabase-js';

let promise: Promise<SupabaseClient> | null = null;

/** Loads the Supabase client on first use (keeps it out of the landing bundle). */
export function getSupabase(): Promise<SupabaseClient> {
  promise ??= import('./supabase').then((m) => m.supabase);
  return promise;
}
