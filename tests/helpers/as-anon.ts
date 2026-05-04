import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Anon client — no Authorization header. Tests how unauthenticated callers
// see the schema (they should see nothing on RLS-enabled tables, but reference
// data like org_types/plans should be visible).
export function asAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
