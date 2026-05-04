import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client (RLS bypassed). Used in fixtures to set up cross-org
// state and clean it up. Never used inside the assertions themselves —
// those use asUser() / asAnon() to test what an authenticated/anon caller
// can see.
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
