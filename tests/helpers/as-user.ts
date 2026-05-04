import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Returns a Supabase client signed in as the given user (real session JWT).
// RLS evaluates auth.uid() exactly as in production — no shortcuts via raw
// JWT signing. Per Session 2 plan confirmation #8.
export async function asUser(email: string, password: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`asUser(${email}): signInWithPassword failed: ${error.message}`);
  return client;
}
