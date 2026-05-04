import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client. Use in client components for auth flows
// (signup, login, password reset, magic-link request) and any subscription work.
//
// Reads NEXT_PUBLIC_* env vars directly via process.env — Next.js inlines these
// at build time. Don't import @/env here: it requires server-only vars.
//
// Hard rule §7: no client-side database writes. Domain mutations always go through
// server actions, even though the browser client technically *could* write under RLS.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
