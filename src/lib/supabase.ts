// The one place that creates the Supabase client. It only ever receives the PUBLIC (anon) key.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envResult } from './env';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!envResult.ok) return null;
  if (!client) {
    client = createClient(envResult.env.supabaseUrl, envResult.env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Google sign-in returns with a one-time ?code= that must be exchanged (PKCE). With flowType 'pkce' the library
        // refuses the old #access_token links, so an old emailed link can never sign anyone in (AU-16).
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      global: { headers: { 'x-client-info': 'vinexpenses-web' } },
    });
  }
  return client;
}
