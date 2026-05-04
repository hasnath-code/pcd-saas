import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session cookie on every request and returns the current user.
// Called from middleware.ts at the project root. Critical for keeping the JWT fresh
// in cookies so RLS in subsequent requests sees a valid auth.uid().
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() triggers refresh-if-stale and writes new cookies via setAll.
  // Don't replace with getSession() — that reads from cookies without revalidating.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
