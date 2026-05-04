# Session 2 — Handover to Session 3

**Phase:** 1a (Foundation)
**Session:** 2 of 4 (Multi-tenant schema + RLS framework)
**Date closed:** 2026-05-05
**Status:** complete; all done-criteria met; both local and cloud Supabase migrated and seeded

---

## What shipped

| # | SHA | Subject |
|---|---|---|
| 1 | `41b3161` | chore: vitest + tsx + NEXT_PUBLIC_SENTRY_DSN in env.ts |
| 2 | `9d1b88c` | feat: Drizzle schema files for 9 Phase 1a tables |
| 3 | `ad78731` | feat: migration 0001 — Phase 1a DDL + RLS helpers + policies |
| 4 | `057da64` | feat: db/seed scripts for org_types and plans |
| 5 | `cda2d47` | feat: lib/audit/log.ts logAudit() helper |
| 6 | `13d87b6` | feat: requireOrgUser + requireOrgAdmin auth helper bodies |
| 7 | `e94bf20` | test: RLS framework + cross-org isolation tests for 6 tables |
| 8 | `e8819a5` | chore: pin engines.node to 20.x, drop migrations/.gitkeep |
| 9 | `7d8a3e2` | docs: ARCHITECTURE-saas v0.3 + SESSION-2-HANDOVER.md |
| 10 | `546bb55` | merge: Phase 1a Session 2 → main |
| 11 | (cloud fix #1) | fix(db): migration 0002 disable RLS on reference tables |
| 12 | (cloud fix #1) | test: cloud smoke for anon-readable reference data |
| 13 | (cloud fix #2) | fix(db): migration 0003 grant service_role on public tables |
| 14 | (this commit) | docs: SESSION-2-HANDOVER cloud migration learnings (RLS + GRANTs) |

Branch: `claude/nice-borg-aca641` (worktree, then merged to main with --no-ff).

---

## Verified working

- Local Supabase: `npx supabase db reset` applies migration 0001 cleanly in a single transaction
- Local seed: `npm run db:seed` populates 2 org_types + 8 plans (idempotent on re-run)
- RLS tests: `npm run test:rls` — 28/28 passing in ~6s across 7 files
- Build: `npm run build` — clean (13 routes building, env validation passes including new `NEXT_PUBLIC_SENTRY_DSN`)
- Type-check: `npx tsc --noEmit` — clean
- Drizzle parity: `npx drizzle-kit check && npx drizzle-kit generate` — "Everything's fine 🐶🔥" + "No schema changes, nothing to migrate 😴"
- Schema state via `scripts/verify-migration.mjs`:
  ```
  Tables: 9 (RLS state matches plan: 6 enabled, 3 disabled)
  Policies: 12 (organizations 2, users 2, org_settings 3,
                invitations 3, audit_logs 1, email_events 1)
  Helper functions: 6 (auth_user_orgs, is_org_member,
                       is_org_admin, is_org_owner,
                       auth_user_stakeholder_orgs [stub],
                       auth_user_stakeholder_projects [stub])
  users FKs: 2 (auth.users, organizations)
  ```

---

## Inherited assumptions Session 3 must respect

1. **Single migration `0001_initial.sql`** ships everything (DDL + helpers + RLS). User-flagged risk of "RLS-on-no-policies window" is resolved — single Postgres transaction. Future logical changes get their own migration (`0002_*`, `0003_*`).

2. **Drizzle-kit naming dance.** Drizzle-kit auto-generates with `0000_*` prefix. We renamed to `0001_*` and updated `meta/_journal.json` (`tag` + `idx`). Each new migration session 3+ generates will likewise be `0000`-prefixed and need renaming. Plan ahead — when generating migration 0002, rename SQL + `meta/0001_snapshot.json` → `meta/0002_snapshot.json` + journal `idx: 2`, `tag: "0002_<name>"`.

3. **6 SECURITY DEFINER STABLE helpers** instead of brief's 4. The added `is_org_admin` / `is_org_owner` were necessary to keep RLS policies non-recursive (the spec's inline subquery pattern would have looped). Phase 1b can extend this set.

4. **App-side UUID v7 only.** No `gen_uuid_v7()` SQL function. Every INSERT in seed scripts and (future) server actions passes `id: uuidv7()` explicitly. Drizzle schema PKs are declared without DEFAULT.

5. **`org_settings` and `invitations` have `deleted_at`** even though spec §10.5/§10.6 SQL omits the column. Per brief's hard rule "every domain table has deleted_at". Spec §23 reconciles — neither table is on the exception list.

6. **No `FOR ALL` policies.** Spec §10.5 used `FOR ALL` for `org_settings_modify_admins`; spec §5 forbids. Split into INSERT/UPDATE policies.

7. **`requireOrgUser` errors on multi-org users.** Throws `AuthError('not_authorized', 'multi_org_unsupported_until_session_3')`. Session 3 wires the context switcher (active_org_id in session) and updates this branch to pick the chosen org. No callers in the codebase yet — only the placeholder dashboard layout calls auth helpers indirectly via middleware; that path uses `requireAuth()` (not `requireOrgUser`) so unaffected.

8. **`requireStakeholder()` is a documented stub.** Throws `AuthError('internal_error', 'requireStakeholder: ships in Phase 1b Session 6 (clients table)')`. The two stakeholder helper SQL functions (`auth_user_stakeholder_orgs`, `auth_user_stakeholder_projects`) ship as empty-set stubs — Phase 1b Session 6's first migration replaces their bodies.

9. **`logAudit()` uses Drizzle pooler client** (postgres role bypasses RLS) — not the Supabase JS service client. Reasoning: server actions write audit rows synchronously after every mutation; HTTP overhead of supabase-js would compound. The pooler bypass is consistent with spec §22 ("Service-role insert (bypasses RLS)") since postgres role bypass and service_role JWT bypass are functionally equivalent here.

10. **Seeds and tests use `--conditions=react-server` / fetch local creds dynamically.** This is a tsx-runtime workaround for `'server-only'` imports in shared lib code. Documented inline in `db/seed/run.ts` and `tests/setup.ts`.

11. **Tests pinned to local Supabase.** `tests/setup.ts` calls `npx supabase status -o env`, overrides Supabase URL/keys with the local stack values, and refuses to run if the resulting URL isn't `127.0.0.1` / `localhost`. This is intentional: RLS test failures are silent data leaks, so we won't accept the small risk of running against cloud by accident.

12. **`.env.local` is symlinked into the worktree** from `/Users/nuha/Documents/CLAUDECODE/ArchplanAI/.env.local`. Symlink is gitignored. Each worktree needs its own symlink to use `--env-file=.env.local` paths.

13. **`engines.node` pinned to `"20.x"`** (was `">=20.0.0"`). Vercel deploy log should stop warning about loose engine specifier.

---

## Surprises / gotchas

These were discovered after main was already merged (during the cloud migration step). Each landed as a follow-up migration with its own commit. Worth reading before starting Session 3.

### Cloud-vs-local platform divergences

Two issues showed up only on cloud — the local Supabase stack has more permissive defaults that hid both gaps. Fixed via migrations 0002 and 0003. **Pattern lesson** for every future migration in Sessions 3+ at the bottom.

#### Divergence 1: cloud auto-enables RLS on every new public table

Cloud Supabase auto-enables RLS on every new public-schema table. Local does not. Migration 0001 only included `ENABLE ROW LEVEL SECURITY` for the 6 tables that should have it, relying on the absence of `ENABLE` to mean "stays off." That worked locally but left cloud with RLS=true on `org_types`, `plans`, `webhook_events` — three tables that should have it OFF.

Effect: with RLS on but no SELECT policy, anon and authenticated couldn't read `org_types` or `plans` even though `GRANT SELECT` was in place. Future signup UI couldn't read plans.

Fix: **Migration `0002_disable_rls_on_reference_tables.sql`** adds explicit `DISABLE ROW LEVEL SECURITY` for the 3 tables.

#### Divergence 2: cloud doesn't auto-grant CRUD to service_role on new public tables

Cloud Supabase has TWO sets of default privileges configured on `public`:

| grantor | type | what it gives anon/authenticated/service_role on new tables |
|---|---|---|
| `postgres` | tables | `Dxtm` (REFERENCES, TRIGGER, TRUNCATE, MAINTAIN — admin-ish, no data CRUD) |
| `supabase_admin` | tables | `arwdDxtm` (full CRUD + admin) |

`supabase db push` connects as `postgres`, so tables created by migrations inherit only the limited grant set. `service_role` has `BYPASSRLS=true`, but BYPASSRLS only skips RLS policy evaluation — table-level GRANTs are a separate layer. Net effect: the seed runner (which uses the service-role JWT) gets `permission denied for table` even though it can technically bypass RLS.

Investigated and confirmed normal Supabase behavior, not a project misconfig. Standard recommendation: explicit GRANT statements in migrations.

Fix: **Migration `0003_grant_service_role_on_public_tables.sql`** adds:
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role` (covers the 9 existing tables)
- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role` (so future tables auto-grant — no per-session re-fix needed)

Migration 0001 already explicitly granted SELECT/CRUD to `anon` and `authenticated` for the tables they need — this works for them because the explicit grants override the limited defaults. The same pattern needed to be applied for `service_role`. anon and authenticated keep the per-table explicit-GRANT pattern (RLS-gated user-facing roles; we want explicit per-table control). Service role gets a default-privileges sweep because it's the admin role.

#### Pattern lesson for future migrations

Every new public-schema table created in a migration must include both:

1. **Explicit `ENABLE` or `DISABLE ROW LEVEL SECURITY`** — never rely on absence to mean "off" (cloud's auto-enable will bite you).
2. **Explicit per-table `GRANT` statements for `anon` / `authenticated`** when those roles need access. The default-privileges set up by 0003 covers `service_role` automatically; the user-facing roles still need explicit per-table control because their access is RLS-gated.

Both gotchas only manifest on cloud — locally, RLS stays off by default and service_role has full CRUD by default. Tests passed locally throughout Session 2, giving false confidence on both dimensions until the cloud push.

### Worktree gotchas

Worktrees do **not** inherit `supabase/.temp/` link state from the parent. To run `supabase db push --workdir <worktree-path>`, the following files must be copied from the parent's `supabase/.temp/` into the worktree's:

```
linked-project.json
project-ref
rest-version
storage-version
storage-migration
pooler-url
postgres-version
gotrue-version
```

(All gitignored — they don't get committed.)

Workarounds for future worktree-based sessions:
- (a) work in the parent dir with `--workdir` flag pointing at the parent (then there's nothing to copy, but no .env.local symlink needs setup either)
- (b) copy the `.temp/*` files at worktree creation time (one-time bootstrap)
- (c) script `bin/bootstrap-worktree.sh` that does both the env-symlink and the .temp file copy in one step

### Cloud smoke test

`tests/cloud-smoke/reference-data-readable.test.ts` asserts anon-keyed REST GETs against **cloud** (`org_types`, `plans`). Run via `npm run test:cloud-smoke` (sets `CLOUD_SMOKE=1` so `tests/setup.ts` keeps the cloud creds from `.env.local` instead of overriding with local Supabase creds). NOT included in the default `npm run test:rls` suite — runs only on demand.

The cloud smoke catches local-vs-cloud divergences like Divergence 1 above (which the local RLS suite missed because local RLS state differed from cloud). Run it after every cloud migration.

### Seed targeting

`npm run db:seed` reads from `.env.local` which contains **cloud** credentials → it seeds **cloud**. To seed **local**, override env vars inline at the shell:

```sh
eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npm run db:seed
```

Asymmetric but correct DX for the same script targeting either environment by env. Session 3+ may want to add a `db:seed:local` npm script that wraps the above for ergonomics.

### Helper functions: 6 not 4

The Session 2 plan called for 4 SECURITY DEFINER helpers (`auth_user_orgs`, `is_org_member`, plus the two stakeholder stubs). We expanded to 6 to keep RLS policies non-recursive on role-based gating: `is_org_admin(_org_id)` and `is_org_owner(_org_id)` were added so policies could check role membership without falling back to inline subqueries on `users` (which would loop). All 6 are SECURITY DEFINER STABLE with `search_path = public, auth, pg_temp` locked.

Phase 1b Session 6 will replace the stakeholder stubs' bodies (they currently return empty sets) with real queries against the `clients` and `project_stakeholders` tables.

---

## Workflow recommendation for future sessions

Session 2 used worktrees and shipped two separate merges to main (primary schema work, then cloud migration follow-ups discovered after the first merge). Each new worktree required symlinking `.env.local` and copying 8 `supabase/.temp/*` files before `supabase db push` would work — friction repeated for the cloud-fix worktree. For Session 3 onwards, recommend working on a single feature branch in the main checkout rather than per-session worktrees: the bootstrapping cost outweighs the isolation benefit for a solo-developer workflow, and one branch + one merge per session reads cleaner than 2+. If a worktree is genuinely needed (parallel experiments, isolated risky work), add `bin/bootstrap-worktree.sh` (option (c) in the Worktree gotchas section above) so the setup amortizes to one command per worktree.

---

## Open issues / left-undone

### Pulled forward from Session 2 (most are also in §35.2)

1. ~~**Cloud Supabase has not been migrated/seeded yet.**~~ ✓ Done in the cloud migration step at end of Session 2: migrations 0001 + 0002 + 0003 applied, 2 org_types + 8 plans seeded. Cloud and local are in sync.

2. **`uuid@10` deprecation warning** still appears during `npm install` — transitive via `resend → svix`. Out of our control; `npm dedupe` doesn't help.

3. **README.md and `public/*.svg`** are still create-next-app defaults. Hasn't blocked anything; remove anytime.

4. **Sentry environment tag `vercel-production`** (Session 1 carryover #4) — would normalize via `SENTRY_ENVIRONMENT=production` Vercel env var. Defer to Session 12.

5. **Drizzle migration filename rename** is manual. Each session that runs `drizzle-kit generate` produces a `0000`-prefixed file that needs renaming + meta journal updates. Session 3+: consider a small wrapper script if friction grows.

6. **Helper functions are `STABLE` (per-query cache).** At 50+ concurrent requests, consider a session-scoped cache. Session 12 perf pass.

7. **`scripts/verify-migration.mjs`** is a one-off check — useful but not tied into any pipeline. Consider incorporating into a `db:verify` npm script later.

---

## Session 3 first actions (suggested order)

Per ARCHITECTURE-saas.md §31 Session 3 task list, plus the carryover above:

1. ~~**Push migration + seed to cloud.**~~ ✓ Done at end of Session 2 (migrations 0001+0002+0003, 2+8 rows seeded).
2. **Decide context-switcher shape early.** It changes how `requireOrgUser` resolves multi-org users (active_org_id stored in… Supabase auth metadata? a separate cookie? a new `user_sessions` table?). Spec §8 mentions `app.active_org_id` GUC but transaction-pooler caveats make that fragile.
3. **Build signup wizard.** Must call `createOrganization` (server action — new, Session 3) which uses the service-role client to insert `organizations` + the first `users` row (owner). Audit-log it via `logAudit({ action: 'create', resource_type: 'organization' })`.
4. **`actions/orgs.ts`, `actions/users.ts`, `actions/settings.ts`** per spec §31 Session 3.
5. **Settings UI** (company details, bank info, terms, branding) wired to `org_settings` via `actions/settings.ts`. Use the existing shadcn primitives.
6. **Team invitation flow** — token generation, email send placeholder (Session 4 wires Resend), acceptance route that uses service-role client to insert the invited user's `users` row, mark `invitations.accepted_at`.
7. **Owner-orphan prevention** — block soft-delete of last owner; force ownership transfer first. Application-level check in `actions/users.ts`.
8. **Audit log every mutation** in the new server actions. Pattern: `logAudit({ orgId, userId, action, resourceType, resourceId, metadata })` after every successful write.
9. **First server-action error-shape tests.** RLS tests cover the DB layer; Session 3+ should add tests for action return shapes (`{ error: 'not_authorized' }` etc.) — likely with msw or a test harness that calls the server action directly.

ARCHITECTURE-saas.md §31 Session 3 row is the authoritative task list. The above is the suggested order within it.

---

## Tooling state at handover

| Tool | Version | Notes |
|---|---|---|
| Node | 20.20.2 | unchanged |
| npm | 10.8.2 | unchanged |
| Supabase CLI | 2.98.1 | unchanged |
| vitest | 4.1.5 | NEW (Session 2) |
| @vitest/ui | 4.1.5 | NEW |
| tsx | 4.21.0 | NEW |
| drizzle-orm | 0.45.2 | unchanged |
| drizzle-kit | 0.31.10 | unchanged |
| Cloud Supabase | linked, migrated (0001+0002+0003), seeded (2+8 rows) | in sync with local |
| Local Supabase | running, schema applied + seeded | restart with `npx supabase start` if stopped |
| Vercel | last deployed Session 1 (`93a29a8`) | unchanged; Session 3 push will redeploy automatically |

### Useful commands (Session 3 onward)

```sh
npm run dev                # Next dev server
npm run build              # Validates env + builds; run before commit
npm run db:reset           # Local: wipes + reapplies migrations
npm run db:seed            # Cloud (uses .env.local). For local target see db/seed/run.ts header.
npm run db:smoke           # Cloud pooler smoke
npm run test:rls           # Vitest RLS suite (must pass before commit)

npx supabase db push       # Apply pending migrations to cloud
npx supabase status -o env # Get local stack env vars (used by tests/setup.ts)
npx drizzle-kit check      # Validate migration journal integrity
npx drizzle-kit generate   # Should report "No schema changes" unless schema files were edited
npx tsc --noEmit           # Type-check; should be clean
```

### Layout summary (changes from Session 1 in **bold**)

```
/
├── actions/
├── app/
├── components/ui/
├── db/
│   ├── index.ts               # now imports * from ./schema
│   ├── migrations/
│   │   ├── 0001_initial.sql   # NEW — DDL + helpers + RLS
│   │   └── meta/              # NEW — drizzle-kit journal + snapshot
│   ├── schema/                # NEW — 9 table files + index.ts re-exports
│   ├── seed/                  # NEW — org-types.ts, plans.ts, run.ts
│   └── queries/               # still empty — Session 3+
├── lib/
│   ├── audit/                 # NEW
│   │   └── log.ts             # logAudit() helper
│   ├── auth/
│   │   └── requireAuth.ts     # bodies filled for OrgUser + OrgAdmin
│   └── supabase/              # unchanged
├── scripts/
│   ├── smoke-pool.mjs         # unchanged
│   └── verify-migration.mjs   # NEW — post-reset DB inspection
├── tests/                     # NEW
│   ├── setup.ts               # env loading + URL guard
│   ├── fixtures/two-orgs.ts
│   ├── helpers/{as-user,as-anon,service-client}.ts
│   └── rls/<table>.test.ts    # 7 files, 28 tests
├── env.ts                     # +NEXT_PUBLIC_SENTRY_DSN
├── package.json               # engines.node "20.x"; +db:seed +test:rls
├── vitest.config.mts          # NEW
├── ARCHITECTURE-saas.md       # bumped to v0.3, §35.2 added
├── SESSION-1-HANDOVER.md      # unchanged
└── SESSION-2-HANDOVER.md      # this file
```

---

## Sign-off

Session 2 done-criteria (from kickoff brief):

- [x] 9 tables created via migration 0001 (split into Section 1: DDL, Section 2: RLS — same file, single transaction)
- [x] Helper SQL functions defined (6 — expanded from brief's 4)
- [x] RLS enabled on every table with at least one policy each (6 enabled, 3 reference/system disabled — matches plan)
- [x] Drizzle schema files match SQL exactly (verified via `drizzle-kit check + generate`)
- [x] Seed scripts populate org_types (2 rows) + plans (8 rows: 4 surveyor + 4 architect)
- [x] `logAudit()` helper callable from any future server action
- [x] Auth helper stubs filled (`requireOrgUser` + `requireOrgAdmin` real bodies; `requireStakeholder` documented stub until Phase 1b Session 6)
- [x] Two-user-two-org test fixture works
- [x] Cross-org isolation test passes for every RLS-enabled table (28/28)
- [x] Soft-deleted rows hidden from default queries (verified in users.test.ts)
- [x] env.ts validates `NEXT_PUBLIC_SENTRY_DSN` (optional URL)
- [x] Local Supabase: migrations applied cleanly via `npx supabase db reset`
- [x] All tests pass via `npm run test:rls`
- [x] Build still clean: `npm run build` succeeds
- [x] Type-check clean: `npx tsc --noEmit` succeeds

Session 2 is closed. Session 3 starts with this file as message 1.
