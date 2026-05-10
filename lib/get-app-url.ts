/**
 * Returns the public origin of the running app (no trailing slash, no path).
 *
 * Resolution priority:
 *   1. Vercel production: NEXT_PUBLIC_APP_URL (custom domain) ?? https://VERCEL_URL
 *   2. Vercel preview/dev: https://VERCEL_URL (always — never NEXT_PUBLIC_APP_URL)
 *   3. Local: NEXT_PUBLIC_APP_URL ?? http://localhost:3000
 *
 * Why preview ignores NEXT_PUBLIC_APP_URL: stale or wrong values (e.g. localhost
 * leaking from .env.local, or a misset Vercel env var) silently produced broken
 * magic links pointing at localhost from preview domains. DEBT-026 closes that
 * footgun by always trusting Vercel's auto-set VERCEL_URL on non-prod deploys.
 *
 * Why this helper reads `process.env` directly (not via `@/env`): the Vercel
 * vars (VERCEL_URL, VERCEL_ENV) are runtime-injected and not part of `env.ts`'s
 * Zod schema. Reading process.env directly also lets tests stub via vi.stubEnv
 * without bypassing the global env validator. NEXT_PUBLIC_APP_URL stays
 * required by env.ts (validated at app boot); this helper is the single
 * authority for *constructing* origins, not for *validating* config.
 */
export function getAppUrl(): string {
  if (process.env.VERCEL_ENV === 'production') {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return 'http://localhost:3000';
}
