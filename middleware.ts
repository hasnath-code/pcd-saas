import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Routes that don't require an authenticated session.
// - exactPaths: the URL itself (login, signup, etc.)
// - prefixes: any URL starting with one of these (auth callbacks, public tokens, sentry-test)
//
// Anything else under the matcher below requires a session — unauthed users redirect to /login.
// Note: route groups (auth)/(org)/(client) aren't part of URLs (Next.js convention),
// so the lists below name URL paths.
const PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/signup',
  '/magic-link',
  '/forgot-password',
  '/reset-password',
]);

const PUBLIC_PREFIXES = [
  '/auth/', // /auth/callback (PKCE return) and any future auth flows
  '/q/', // public quote view (Phase 2 fills; Phase 1a 404s)
  '/i/', // public invoice view (Phase 2)
  '/r/', // public receipt view (Phase 2)
  '/api/sentry-test', // sanity-check route used during Phase 1a Session 1 setup
  '/api/webhooks/', // webhook ingestion (Phase 1a Session 4)
  '/invitations/', // public team-invitation landing (Phase 1a Session 3)
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  // Always refresh the Supabase session cookie, even for public routes —
  // keeps the JWT fresh in case the user is authed and just visiting /.
  const { response, user } = await updateSession(request);

  if (!isPublic(request.nextUrl.pathname) && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run on everything except static assets. Image/font/etc. extensions excluded
  // so middleware doesn't burn CPU on every favicon hit.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)$).*)',
  ],
};
