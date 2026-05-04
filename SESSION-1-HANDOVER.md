# Session 1 — Handover to Session 2

**Phase:** 1a (Foundation)
**Session:** 1 of 4 (Project scaffold + auth)
**Date closed:** 2026-05-04
**Status:** complete; all done-criteria met

---

## Production deploy

- **URL:** https://pcd-saas.vercel.app
- **Repo:** https://github.com/hasnath-code/pcd-saas
- **Cloud Supabase project:** `gcwdasdujivliplthpvv` (pcd-saas, eu-west-2 London)
- **Vercel:** auto-deploys on push to `main`. Preview env + Production env both populated with the Phase 1a env vars (plus Sentry build-time vars).

## Sentry production verification

- Test event captured: **issue `117426189`** at sentry.io/javascript-nextjs
- Title: `Sentry test error from /api/sentry-test`
- Environment tag: `vercel-production` (Vercel-Sentry integration prefixes; see open issue 7 below)
- URL tag: `https://pcd-saas.vercel.app/api/sentry-test`
- Release: `93a29a8a36f9` — matches commit on `main` at deploy time
- Stack trace points into `wrapRouteHandlerWithSentry` — instrumentation working as expected

---

## What shipped (12 work commits + this handover commit = 13 on `main`)

| # | SHA | Subject |
|---|---|---|
| 12 | `93a29a8` | chore: add Sentry onRouterTransitionStart hook |
| 11 | `43bd4ff` | feat: Sentry wiring (server/edge/client/instrumentation/global-error) |
| 10 | `ba877d4` | feat: middleware + auth routes + (org)/dashboard placeholder |
| 9 | `4deed0f` | feat: Supabase clients (browser/server/service/middleware) + auth helpers |
| 8 | `49ef570` | feat: drizzle config + db client (pooler) + verified smoke test |
| 7 | `2f32197` | chore: supabase init + db/ skeleton + symlink migrations -> db/migrations |
| 6 | `d59fa64` | chore: validate env at build start + add supabase CLI as dev dep |
| 5 | `dbe1095` | chore: env.ts (Zod-validated) + .env.example template |
| 4 | `bf19a01` | chore: initialize shadcn/ui (radix base, nova preset) + base components |
| 3 | `dc887b0` | chore: install runtime + dev packages |
| 2 | `abcd3e6` | chore: rename package to pcd-saas and pin Node 20 |
| 1 | `732f2e1` | Initial commit from Create Next App |

13th commit on `main` is this file — `docs: Session 1 handover note`. SHA visible via `git log`.

---

## Verified working

- Next.js 15.5.15 build clean (run repeatedly through Session 1)
- Cloud Supabase pooler (port 6543, `prepare:false`) reads `auth.users` cleanly via `npm run db:smoke`
- Local Supabase stack boots via `npx supabase start` (Studio :54323, Mailpit :54324, DB :54322, API :54321)
- `supabase link` to `gcwdasdujivliplthpvv` confirmed via `npx supabase migration list`
- All HTTP smoke tests green (every route returned its expected status):
  ```
  GET /                                → 307 → /login                    (no session)
  GET /login                           → 200
  GET /signup                          → 200
  GET /forgot-password                 → 200
  GET /magic-link                      → 200
  GET /reset-password                  → 200
  GET /dashboard                       → 307 → /login?next=/dashboard    (no session)
  GET /api/sentry-test                 → 500 (throws as expected)
  GET /q/<uuid> (Phase 1a placeholder) → 404
  ```
- Sentry production capture confirmed end-to-end (issue 117426189)
- GitHub origin/main matches local main: `93a29a8a36f9592dc894e8ec14655c2dcbdd177a`

---

## Inherited assumptions Session 2 must respect

1. **UUID v7 generated app-side** via `uuid` npm package (`uuidv7()`) — not via `pg_uuidv7` extension or SQL function. Imported as `import { v7 as uuidv7 } from 'uuid'`.
2. **Drizzle is the ORM**, postgres-js the driver. `db/index.ts` exports `db` configured for the pooler. Schema files go in `db/schema/*.ts` (Session 2 creates first batch).
3. **Migrations live in `db/migrations/`** via the symlink `supabase/migrations -> ../db/migrations`. Both `npx drizzle-kit generate` and `supabase db push` see the same files. Migration naming per ARCHITECTURE-saas.md §27 (sequential `0001_`, `0002_`...).
4. **Email templates are plain HTML strings** in `lib/email/templates/` (Session 4) — NOT React Email.
5. **Auth context default = org context** when a user has both org and stakeholder identities (Session 2/3 will implement context switcher; default landing = org).
6. **Financial gating uses Postgres views, not separate tables** (Phase 2 detail).
7. **All mutations go through server actions** in `actions/<resource>.ts`. Reads happen in `db/queries/<resource>.ts`. **No client-side database writes — ever.**
8. **Server actions return `{ success: true } | { error: '<code>' }`** per ARCHITECTURE-saas.md §20. Standard codes defined in `lib/auth/requireAuth.ts` as `ServerActionErrorCode`.
9. **`env.ts` is server-only.** Schema requires all 12 runtime vars. Client code reads `process.env.NEXT_PUBLIC_*` directly. Importing `env.ts` in a client component will runtime-crash (good — fail-loud).
10. **`lib/auth/requireAuth.ts` has stubs** for `requireOrgUser` / `requireOrgAdmin` / `requireStakeholder` that throw `AuthError('internal_error', '... ships in Session 2')`. Session 2 fills bodies — no caller refactoring needed.
11. **Service-role client (`lib/supabase/service.ts`) is `import 'server-only'`-gated.** Use only for migrations, seeding, webhook ingestion, internal cron, tests. Never user-facing actions.
12. **Middleware at root protects everything** under non-public URL prefixes. Public list = `/`, `/login`, `/signup`, `/magic-link`, `/forgot-password`, `/reset-password`, `/auth/*`, `/q/*`, `/i/*`, `/r/*`, `/api/sentry-test`, `/api/webhooks/*`. Anything else → unauthed redirected to `/login?next=<path>`.
13. **Drizzle config (`drizzle.config.ts`) uses `casing: 'snake_case'`** to match column convention from §5. All schema files should rely on this rather than re-snake-casing per column.
14. **`next.config.ts` imports `./env`** so `schema.parse(process.env)` runs at every build/dev start. Build fails fast if any required env var is missing/malformed.
15. **`.gitignore` allows `.env.example` via `!` exception**; everything else `.env*` ignored. Keep that exception when modifying gitignore.
16. **Symlink `supabase/migrations -> ../db/migrations` is committed** as a git symlink (mode 120000). Don't replace it with a copy.

---

## Open issues / left-undone

### Pulled forward from Session 1

1. **Client-side Sentry capture is wired but server-only DSN was the initial setup.** During Vercel deploy `NEXT_PUBLIC_SENTRY_DSN` was set in both `.env.local` and Vercel (Session 12 task partially done). **Session 2 should add `NEXT_PUBLIC_SENTRY_DSN` to `env.ts` Zod validation** so it's enforced going forward. Also add it to `.env.example`.
2. **`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` live in Vercel** (build-time only, used by `next.config.ts` for source map upload). Out of `env.ts` scope (runtime vs build-time). No action needed unless we want them validated at build (could be added to a separate build-time check).
3. **`uuid@10` deprecation warning during Vercel build** — package.json declares `^14.0.0` but the warning appears anyway (likely a transitive dep). **Consider upgrade / dedup in Session 2 cleanup.**
4. **`engines.node ">=20.0.0"` warning from Vercel** — Vercel prefers a more specific pin. **Consider changing to `"20.x"` in Session 2** (one-line `package.json` edit, low risk).
5. **Sentry environment tag is `vercel-production` not `production`** — Vercel-Sentry integration uses this prefix. **Note for Session 12** if we want to normalize (e.g. set `SENTRY_ENVIRONMENT=production` in Vercel env).
6. **`DIRECT_URL` IPv4 risk on Free tier.** If `npx drizzle-kit generate` or `supabase db push` errors with "host not found" in Session 2, swap `DIRECT_URL` to use the session pooler URI (port 5432, IPv4-routed). Verify before swapping (per Hasnath note).
7. **`db/migrations/.gitkeep`** causes a `Skipping migration .gitkeep` warning from `supabase migration list`. Harmless. Remove after Session 2's first real migration lands.
8. **README.md is the create-next-app default** — never updated this session ("no docs unless asked" rule). Update when convenient.
9. **`public/*.svg`** (next.svg, vercel.svg, file.svg, globe.svg, window.svg) are leftover create-next-app assets. Unused. Remove anytime.
10. **Local supabase still running** at end of session (~hours of uptime). Stop with `npx supabase stop` if Docker resources matter.
11. **Git author info** — every commit shows `nuha@Nuhas-MacBook-Neo.local`. Per safety rules I didn't touch git config. Set `git config --global user.name` / `user.email` for proper GitHub attribution on future commits.
12. **Build-time deprecation warnings** that appeared during the Sentry setup (now silenced, but worth a Session 2 review after the upgrade landscape changes again).

### Doc divergences logged

- ARCHITECTURE-saas.md §10 / §27 reference a `gen_uuid_v7()` SQL function for `DEFAULT` clauses on PK columns. Per the override decided pre-Session-1, IDs are generated app-side via `uuid` package — so PK column DDL **should NOT use `DEFAULT gen_uuid_v7()`**. Every `INSERT` must pass an explicit `id`. Architectural call to confirm in Session 2 before writing the first migration: do we want a SQL fallback for ad-hoc inserts (psql, dashboard) or trust app-side fully?
- ARCHITECTURE-saas.md §16 specifies React Email templates. Per the pre-Session-1 override, **plain HTML strings only** in `lib/email/templates/` (Session 4 concern, but flagging now).

---

## Session 2 first actions (suggested order)

1. **Decide `gen_uuid_v7()` SQL function question above** before writing the first migration. If app-side-only, omit the DDL function and ensure every INSERT in `db/queries/` and `actions/` passes an `id`.
2. **Add `NEXT_PUBLIC_SENTRY_DSN` to `env.ts` Zod schema and `.env.example`** (open issue 1). Confirm `.env.local` already has the value before pushing — otherwise build will fail.
3. **First migration `0001_initial.sql`**: `org_types`, `plans`, `organizations`, `users`, `org_settings`, `outbound_emails` per ARCHITECTURE-saas.md §10. RLS enabled on every table at creation; policies in same migration.
4. **Second migration `0002_seed_org_types_and_plans.sql`** with seed SQL from §10.1 / §10.2.
5. **Third migration `0003_create_audit_email_invites.sql`**: `audit_logs`, `email_events`, `webhook_events`, `invitations`. Note `audit_logs.client_id` is a column without FK constraint (FK added in Phase 1b first migration).
6. **Drizzle schema files** mirroring SQL in `db/schema/{orgs,users,audit,webhooks}.ts`. Run `npm run db:generate` to verify they match SQL.
7. **RLS policies for all 10 tables** following Patterns A/B/C in §9 + `lib/rls.ts` helpers (`setActiveOrg`, `getCurrentUserOrg`, `getCurrentStakeholder`).
8. **`lib/audit.ts` `logAudit()` helper.** Service-role insert (bypasses RLS).
9. **RLS test framework** in `__tests__/rls/` per §26 (likely needs `vitest` + `@supabase/supabase-js` admin user creation — install in Session 2). First tests: `orgs.test.ts`, `users.test.ts` cross-org isolation.
10. **Fill stubs** in `lib/auth/requireAuth.ts` (`requireOrgUser`, `requireOrgAdmin`, `requireStakeholder`). Remove the leading `await requireAuth()` line; the real implementation queries `users` (or `clients`) and resolves org context.
11. **Commit `0001_pin_node_20x.diff`** type one-liner if you do the `engines.node` polish (open issue 4).
12. **Address `uuid@10` warning** if it's still showing — `npm dedupe` may be enough, or pin to `^14`.

ARCHITECTURE-saas.md §31 "Session 2: Multi-tenant schema + RLS framework" is the authoritative task list; the above is the suggested order within it.

---

## Tooling state at handover

| Tool | Version | Notes |
|---|---|---|
| Node | 20.20.2 | via nvm; `.nvmrc` pins `20`, `engines.node` `>=20.0.0` (consider `20.x` — see open issue 4) |
| npm | 10.8.2 | bundled with Node 20.20.2 |
| Supabase CLI | 2.98.1 | project-local devDependency; `npx supabase ...` |
| Docker | 29.4.0 | OrbStack engine |
| Local supabase | running | 11 containers up; stop with `npx supabase stop` |
| Cloud supabase | linked | project `gcwdasdujivliplthpvv` |
| GitHub | pushed | `https://github.com/hasnath-code/pcd-saas` |
| Vercel | deployed | `https://pcd-saas.vercel.app`, auto-deploys on push to `main` |
| Sentry | wired | issue `117426189` confirms end-to-end capture |

### Key package versions

| Package | Version | Notes |
|---|---|---|
| next | 15.5.15 | per ARCHITECTURE-saas.md §2 (15.x pinned, NOT 16) |
| react | 19.1.0 | |
| @supabase/ssr | 0.10.2 | |
| @supabase/supabase-js | 2.105.1 | |
| drizzle-orm | 0.45.2 | |
| drizzle-kit | 0.31.10 | dev |
| @sentry/nextjs | 10.51.0 | |
| zod | 4.4.2 | v4 — both `z.url()` and `z.string().url()` work |
| uuid | 14.0.0 | see open issue 3 (deprecation warning during Vercel build) |
| tailwindcss | 4.x | v4, no `tailwind.config.ts` (CSS-first config) |
| shadcn | 4.6.0 | radix-nova preset, lucide icons, Geist fonts |

### Useful commands

```sh
npm run dev               # Next dev server (localhost:3000)
npm run build             # Production build (validates env.ts at start)
npm run db:smoke          # One-off pooler check vs cloud Supabase
npm run db:generate       # drizzle-kit generate (Session 2 onwards)
npm run db:push           # supabase db push to linked cloud project
npm run db:reset          # supabase db reset (LOCAL only)
npx supabase start        # Boot local stack (Docker required)
npx supabase stop         # Stop local stack
npx supabase status       # See local URLs (Studio, Mailpit, DB, API)
npx supabase migration list  # Diff local vs remote migrations
```

### Layout summary

```
/
├── actions/               # server actions (auth.ts only so far)
├── app/
│   ├── (auth)/           # public auth routes — login, signup, magic-link, forgot/reset
│   ├── (org)/            # session-required — dashboard placeholder
│   ├── api/
│   │   └── sentry-test/  # GET throws — production verifier
│   ├── auth/callback/    # PKCE callback
│   ├── global-error.tsx  # Sentry React render error boundary
│   ├── layout.tsx        # root layout + Sonner Toaster
│   └── page.tsx          # / → conditional redirect to /dashboard or /login
├── components/ui/         # shadcn primitives (button, card, form, input, label, sonner)
├── db/
│   ├── index.ts          # Drizzle client (pooler, prepare:false)
│   ├── migrations/       # symlinked to supabase/migrations
│   ├── schema/           # empty — Session 2 fills
│   ├── queries/          # empty — Session 2+
│   └── seed/             # empty — Session 2+
├── lib/
│   ├── auth/
│   │   └── requireAuth.ts  # requireAuth (works) + Session 2 stubs
│   ├── supabase/
│   │   ├── client.ts     # createBrowserClient
│   │   ├── server.ts     # createServerClient (cookies)
│   │   ├── service.ts    # service-role, server-only-gated
│   │   └── middleware.ts # updateSession() helper
│   └── utils.ts          # cn() from shadcn
├── scripts/
│   └── smoke-pool.mjs    # one-off pooler check
├── supabase/
│   ├── config.toml       # local stack config (auth site_url=localhost:3000)
│   ├── migrations -> ../db/migrations  # symlink
│   └── .gitignore        # .branches, .temp, .env.local
├── env.ts                 # Zod-validated runtime env (12 vars)
├── drizzle.config.ts      # snake_case casing, DIRECT_URL
├── instrumentation.ts     # Sentry server/edge bootstrap
├── instrumentation-client.ts  # Sentry browser init + onRouterTransitionStart
├── middleware.ts          # session refresh + protected-route gate
├── next.config.ts         # withSentryConfig wrapper, imports ./env
├── sentry.{server,edge}.config.ts
├── .env.example           # tracked template
├── .env.local             # gitignored, populated locally
├── .nvmrc                 # 20
├── package.json           # name=pcd-saas, engines.node>=20.0.0
└── ARCHITECTURE-saas.md   # source of truth (in repo? add if not — Hasnath's call)
```

---

## Sign-off

Session 1 done-criteria (from kickoff brief):

- [x] Repo exists, all packages installed
- [x] `supabase start` works locally
- [x] Cloud Supabase linked, env vars set in `.env.local` AND Vercel
- [x] `/signup`, `/login`, `/forgot-password` routes exist with working backend
- [x] Middleware protects `(org)/*` (placeholder layout returns "Authenticated")
- [x] Sentry receives a test error from production deploy (issue `117426189`)
- [x] Vercel preview URL accessible (`https://pcd-saas.vercel.app`)
- [x] `drizzle.config.ts` created, pointing at correct `DATABASE_URL`/`DIRECT_URL`
- [x] Git history shows logical commit progression (12 work commits + handover)

Session 1 is closed. Session 2 starts with this file as message 1.
