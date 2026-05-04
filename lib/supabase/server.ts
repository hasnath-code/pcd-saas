import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/env';

// Session-bound Supabase client for Server Components, Route Handlers, and Server Actions.
// Cookies flow through Next's cookies() helper so RLS sees the calling user via auth.uid().
//
// `cookieStore.set` throws when called from a Server Component (RSCs cannot mutate
// response cookies). That's expected — middleware refreshes cookies on every request,
// so dropping the write here is safe.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component context — middleware handles refresh.
          }
        },
      },
    },
  );
}
