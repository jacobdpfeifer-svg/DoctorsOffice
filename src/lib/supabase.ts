import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared Supabase client singleton.
 *
 * Using a single instance ensures that any authenticated session established
 * via Supabase Auth is automatically carried through to Realtime channel
 * subscriptions, so the JWT used for Realtime RLS policies is always current.
 */

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anonKey) {
      throw new Error(
        "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY environment variables",
      );
    }
    _client = createClient(url, anonKey);
  }
  return _client;
}
