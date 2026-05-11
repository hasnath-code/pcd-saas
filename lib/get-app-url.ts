/**
 * Returns the public origin of the running app (no trailing slash, no path).
 *
 * Resolution priority:
 *   1. Vercel production: NEXT_PUBLIC_APP_URL (custom domain) ?? https://VERCEL_URL
 *   2. Vercel preview/dev: https://VERCEL_BRANCH_URL ?? https://VERCEL_URL
 *      (NEXT_PUBLIC_APP_URL ignored on preview/dev — see DEBT-026)
 *   3. Local: NEXT_PUBLIC_APP_URL ?? http://localhost:3000
 *
 * Why preview prefers VERCEL_BRANCH_URL over VERCEL_URL: Vercel sets VERCEL_URL
 * to the per-deploy hostname (e.g. pcd-saas-abc123.vercel.app); VERCEL_BRANCH_URL
 * is the per-branch stable alias (pcd-saas-git-<branch>-…vercel.app). PKCE
 * cookies set on form submit at the branch alias don't survive a magic-link
 * round-trip that lands on the per-deploy hostname — different cookie domains.
 * DEBT-043 closes that gap by routing all preview email links at the stable
 * branch alias so the cookie domain matches. Production is unaffected
 * (VERCEL_URL there resolves to the production alias, single hostname).
 *
 * Why preview ignores NEXT_PUBLIC_APP_URL: stale or wrong values (e.g. localhost
 * leaking from .env.local, or a misset Vercel env var) silently produced broken
 * magic links pointing at localhost from preview domains. DEBT-026 closes that
 * footgun by always trusting Vercel's auto-set vars on non-prod deploys.
 *
 * Why this helper reads `process.env` directly (not via `@/env`): the Vercel
 * vars (VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_ENV) are runtime-injected and
 * not part of `env.ts`'s Zod schema. Reading process.env directly also lets
 * tests stub via vi.stubEnv without bypassing the global env validator.
 * NEXT_PUBLIC_APP_URL stays required by env.ts (validated at app boot); this
 * helper is the single authority for *constructing* origins, not for
 * *validating* config.
 */
export function getAppUrl(): string {
  if (process.env.VERCEL_ENV === 'production') {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return 'http://localhost:3000';
}
