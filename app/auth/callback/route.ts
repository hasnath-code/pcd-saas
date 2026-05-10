import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pickDestination, resolvePostAuthIdentity } from '@/lib/auth/postAuthResolve';

// PKCE callback for: signup confirmation, magic link, password reset.
// Supabase Auth redirects users here with `?code=<exchange-code>&next=<path>`.
// We exchange the code for a session (sets cookies), resolve §8 identity
// (backfilling clients.auth_user_id when applicable — DEBT-037 fix), and
// route via pickDestination so all post-auth routing has one source of truth.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
    );
  }
  if (!data.user) {
    return NextResponse.redirect(new URL('/login?error=no_session', request.url));
  }

  const identity = await resolvePostAuthIdentity(data.user.id, data.user.email ?? '');
  const dest = pickDestination(identity, next);
  return NextResponse.redirect(new URL(dest, request.url));
}
