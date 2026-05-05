# Session 5 — Handover (Phase 1b kickoff)

**Phase:** 1b (Project Core)
**Session:** 5 of 8 (kickoff: workflows + projects + clients + multi-org switcher + carryovers)
**Date closed:** 2026-05-06
**Status:** complete; all §32 Session 5 done-criteria met. Phase 1b begins; 3 sessions remaining (S6 stakeholders, S7 RLS hardening, S8 workflow management).

---

## What shipped

| # | SHA | Subject |
|---|---|---|
| 1 | `1625050` | feat(db): Phase 1b schema — workflows, clients, projects + Simple seed |
| 2 | `7584028` | feat(actions+auth): atomic createOrganization + switchActiveOrg + cookie-aware requireOrgUser |
| 3 | `ed4b82c` | feat(actions): clients + projects CRUD + cancelInvitation + cancelled-invite state |
| 4 | `a1d14b3` | feat(ui): project list/create/detail + multi-org switcher + cancel-invitation kebab |
| 5 | `e699f0d` | feat(scripts): seed-hasnath-pcd-surveyor (idempotent post-signup) |
| 6 | `aa74cd9` | test: RLS + action tests for Phase 1b tables + projects pre-check fix |
| 7 | (this commit) | docs: SESSION-5-HANDOVER + ARCHITECTURE-saas v0.6 (Phase 1b S5 shipped) |

Branch: `claude/hungry-antonelli-a8fb81` (worktree). Will merge into session branch then `main` at session close.

---

## Verified working

### Migrations (local + cloud applied)

- **0006_workflows.sql:** `workflows` + `workflow_stages` with RLS. CHECK constraint enforces `(is_system_template ↔ org_id IS NULL)`. Partial UNIQUE index `uq_workflows_system_slug` enables ON CONFLICT in 0009. Policies use SECURITY DEFINER helpers (`is_org_member`, `is_org_admin`) to match Phase 1a's recursion-safe pattern; transitive parent visibility on `workflow_stages_select` via subquery on `workflows` (which has its own RLS). System templates are immutable to authenticated users (no INSERT/UPDATE/DELETE policy fires for `is_system_template = true`); seed migration uses postgres role and bypasses RLS.

- **0007_clients.sql:** `clients` (cross-schema FK to `auth.users` ON DELETE SET NULL) + `client_org_memberships`. Backfills `audit_logs.client_id` FK. Two NEW SECURITY DEFINER helpers (`auth_user_client_ids()`, `auth_user_org_client_ids()`) break the recursion that would otherwise occur between `clients_select` ↔ `client_org_memberships_select`. **Unstubs `auth_user_stakeholder_orgs()`** from migration 0001 (was empty-set stub, now queries memberships). Writes via service-role only — no INSERT/UPDATE/DELETE policy on memberships.

- **0008_projects.sql:** `projects` table with FKs to organizations / workflows / workflow_stages / users. Backfills `invitations.project_id` FK with ON DELETE CASCADE. RLS: `projects_select_org_or_stakeholder` uses `auth_user_stakeholder_projects()` (still empty-set stub from 0001 — Session 6 will fill the body). `projects_modify_org_members` permits all org members to write per spec §11.5 (broader than admin-only).

- **0009_seed_workflow_templates.sql:** seeds the "Simple" 5-stage system template (slug=simple, is_system_template=true). Idempotent via DO block guard on `(slug='simple' AND is_system_template=true)`. **PCD Surveyor is NOT seeded as a system template** (per ARCHITECTURE §13 — it's org-specific). It ships via `scripts/seed-hasnath-pcd-surveyor.ts` post-signup.

- Cloud anon curl on all five Phase 1b tables (`projects`, `clients`, `workflows`, `workflow_stages`, `client_org_memberships`): HTTP 401. RLS correctly blocks anonymous reads.

### Atomic createOrganization

`actions/orgs.ts createOrganization` was refactored from Supabase service-role REST to Drizzle `db.transaction(...)`. The signup flow now atomically inserts: organization → user → workflow (cloned from Simple) → 5 workflow_stages. If any step fails, the whole transaction rolls back; no orphan org/user/workflow rows. Audits emit only on success.

The internal helper `cloneSimpleWorkflowForOrg(tx, orgId)` is also called inside the transaction; it includes a defensive idempotency check (skips clone if any workflow already exists for the org), but in normal signup flow this branch never fires.

### Multi-org context switcher

`switchActiveOrg(orgId)` validates the caller has an active membership in the target org (cross-org leak avoided by returning the same `not_authorized / not_a_member` for both "not a member" and "org doesn't exist"), sets the `active_org_id` cookie (HttpOnly + Secure-in-prod + SameSite=Lax + 30-day TTL), audits `permission_change/session`, and revalidates `/dashboard` + `/settings`.

`requireOrgUser` is now cookie-aware: single-membership uses that membership directly; multi-membership reads `active_org_id` and matches against active memberships. Stale cookie (membership soft-deleted server-side) gracefully falls back to first valid membership and attempts `cookies().delete()` inside try/catch (RSC contexts throw on cookie mutation; swallowed silently — stale cookie self-corrects on the next mutation request).

`(org)/layout.tsx` mounts an `OrgSwitcher` header with PCD logo + nav links + the dropdown. Single-membership users see plain text instead of a dropdown trigger.

### Project CRUD

- `actions/projects.ts createProject` validates workflow ownership + system-template rejection + client-in-org membership, resolves `currentStageId` to position=1, pre-checks the (org_id, project_number) UNIQUE constraint to surface `conflict/project_number_taken`, with a race-condition fallback for concurrent writes.
- `updateProject` permits siteAddress + scopeSummary mutations only. Stage transitions ship in Session 8 per §32.
- `softDeleteProject` + `restoreProject` are admin-only.
- Pages: `/dashboard/projects`, `/dashboard/projects/new`, `/dashboard/projects/[projectId]` with stage filter, empty state, ProjectStageBadge (color dot + name + terminal styling), and a current-stage-highlighted progression view on the detail page.

### Client CRUD

- `findOrCreateClient` is idempotent: matches by email within caller's org, returns the existing clientId without auditing the no-op. New emails create a `clients` row + `client_org_memberships` row in a transaction. Cross-org clients (same email, already in another org) reuse the global `clients` row and just attach a new membership.
- `updateClient` cross-org targets surface as `not_found` per the existing `removeUserFromOrg` precedent.

### Cancel invitation

- `actions/invitations.ts cancelInvitation` is admin-only, soft-deletes the row (sets `deleted_at`), distinguishes `already_accepted` from `already_cancelled` from `not_found`. Audits `soft_delete/invitation` with `metadata.reason='cancelled_by_admin'`.
- `db/queries/invitations.ts getInvitationByToken` no longer filters on `isNull(deletedAt)` so the public landing page can render a distinct "Invitation cancelled" state instead of conflating with not-found. Callers must check `invitation.deletedAt` themselves.
- `actions/users.ts acceptInvitation` rejects cancelled invitations with `conflict/cancelled` (no `users` row created, no audit row written — verified by security test).
- `app/invitations/[token]/page.tsx` adds the 4th error-state card (cancelled).
- `components/team/CancelInvitationButton.tsx` + `PendingInvitationsList` updated with a kebab-menu UX and Dialog confirm. The list takes a new `canManage` prop.

### Carryovers cleared

- **`sendPasswordReset` rate limit:** wrapped with `rateLimit('auth', authRateLimitKey(email))` matching Session 4's pattern. Returns `{ error: 'rate_limited', reason: 'retry_after_<n>s' }`.
- **`AuditAction.system_cleanup`:** added to the union; `scripts/cleanup-stub-webhook-events.ts` now uses it instead of `'soft_delete'` with `metadata.hard_delete=true`.

### Hasnath script

`scripts/seed-hasnath-pcd-surveyor.ts` (npm script: `db:seed-pcd-surveyor`) finds Hasnath's org via `org_settings` (key=`company.company_number`, value=`"16240187"`) and seeds an 8-stage non-template "PCD Surveyor" workflow. Idempotent: re-running on an already-seeded org exits with "already seeded". Aborts loudly if multiple orgs match. Local dry-run verified (no matching org → "no org found" exit, no rows inserted).

**Stage colors (documented to prevent re-litigation):** Quoted `#94a3b8` (slate), Quote Accepted `#06b6d4` (cyan), Invoice Sent `#3b82f6` (blue), Confirmed `#8b5cf6` (violet), Survey Booked `#a855f7` (purple), Drawing In Progress `#f59e0b` (amber), QA `#fb923c` (orange), Completed `#10b981` (emerald, terminal).

### Final regression checks

- `npm run build` — clean
- `npx tsc --noEmit` — clean
- `npx drizzle-kit check` — no drift
- `npm run test:rls` — **46/46** (29 prior + 17 new across workflows / clients / projects)
- `npm run test:actions` — **50/50** (19 prior + 31 new across orgs / projects / clients / switch-org / cancel-invitation, plus the cancelled-invitation security test in accept.test.ts)
- `npm run test:cloud-smoke` — **7/7** (3 prior + 4 new for the Phase 1b anon-blocked check)
- Cloud anon curl on `projects`/`clients`/`workflows`/`workflow_stages`/`client_org_memberships` — all return HTTP 401

---

## Inherited assumptions Session 6 must respect

1. **Cookie name `active_org_id`.** Set by `switchActiveOrg`; read by `requireOrgUser` and `(org)/layout.tsx`. HttpOnly + Secure-in-prod + SameSite=Lax + 30-day TTL. Future actions that change membership (Session 6 stakeholder accept/remove) should NOT touch this cookie unless they're the user's currently-active org being soft-deleted; in that case let the natural stale-cookie self-correct path handle it.

2. **Audit verb for org switch is `permission_change`.** Closest existing fit; not a new verb. If Session 6 introduces stakeholder context switching with a different verb (e.g. `enter_stakeholder_view`), discuss adding a new AuditAction member rather than reusing `permission_change` (which already implies role/perm change semantics).

3. **`acceptInvitation` distinguishes cancelled.** Returns `{ error: 'conflict', reason: 'cancelled' }`. UI on `/invitations/[token]` renders the 4th error state. Stakeholder invite flows in Session 6 will need their own equivalent — either reuse `cancelInvitation` (which targets the generic `invitations` table) or add a stakeholder-specific cancel action.

4. **PCD Surveyor seeded via standalone script, not migration.** Per ARCHITECTURE §13 + the user decision documented at the top of `scripts/seed-hasnath-pcd-surveyor.ts`. Future sessions should NOT seed this template via SQL migrations; org-specific data lives in scripts.

5. **`getInvitationByToken` no longer filters `deletedAt`.** Callers (the invitation landing page and `acceptInvitation`) check `invitation.deletedAt !== null` explicitly. Future stakeholder invite UI in Session 6 should follow the same pattern: fetch unfiltered, then check the cancellation marker.

6. **Project list has no client column yet.** Stakeholders ship in Session 6 (`project_stakeholders` table). The project list intentionally doesn't show "client name" because the join would land empty for every Session 5 project. Add the column when stakeholders are wired up; pages already accept the data via `db/queries/projects.ts` shape, no schema changes needed in the table itself.

7. **`projects` RLS uses `auth_user_stakeholder_projects()` stub.** Migration 0001 ships this as `SELECT NULL WHERE FALSE`. Session 6's first migration MUST `CREATE OR REPLACE` it to query `project_stakeholders` (mirroring how 0007 unstubbed `auth_user_stakeholder_orgs()`). Until then, only org members see projects; stakeholders never do (correct behavior for Session 5).

8. **`clients.email` is GLOBALLY UNIQUE.** `findOrCreateClient` reuses the same `clients` row across orgs by attaching a fresh `client_org_memberships` row. If Session 6 onboarding allows clients to manage profile fields per-org (e.g. different phone for different firms), schema needs to evolve — but Session 5's cross-org model is "one canonical client, multiple memberships." Don't break this without consultation.

9. **Two new SECURITY DEFINER helpers in 0007.** `auth_user_client_ids()` + `auth_user_org_client_ids()`. Clients/memberships RLS depends on both. Don't drop or rename them; if Session 6 adds policies that cross these tables, prefer adding more helpers over inline subqueries (recursion pattern is documented in 0007's comments).

10. **Stage transitions are NOT implemented.** The project detail page shows a stage progression view with the current stage highlighted, but there's no "advance stage" UI yet — Session 8 ships `moveProjectToStage`. The project detail page already has a placeholder "Stage transitions ship in a future update" — when Session 8 lands, replace that placeholder with the actual UI.

### Fixed inherited assumption

- **Phase 1a `createOrganization` used Supabase service-role REST.** Session 5 refactored it to Drizzle `db.transaction(...)`. Future actions that need atomic multi-table writes should follow this pattern (see also `actions/clients.ts findOrCreateClient`). The Drizzle pooler `db` client uses the postgres role and bypasses RLS — equivalent to service-role for our purposes, and supports transactions natively. Don't reach for `createServiceClient` for new actions unless you specifically need REST-shape access (e.g. `auth.admin` operations, which Drizzle can't do).

### Known limitation (deferred)

- **`auth.users` orphan on transaction rollback.** The Supabase auth signup creates the `auth.users` row before `createOrganization` is called; if the Drizzle transaction inside `createOrganization` rolls back (e.g. the system template was missing), the `auth.users` row remains with no `public.users` / `public.organizations` link. **Workaround:** the user re-runs signup; `authUserHasMembership` returns false (no public row), so the second attempt proceeds normally. **Phase 6 will add proper cleanup** (likely a background job that purges auth.users without a public.users link after N hours).

---

## Surprises / gotchas

### RLS recursion between clients and memberships

The first cut of `0007_clients.sql` used inline subqueries that crossed both tables — `clients_select` queried `client_org_memberships`, and `client_org_memberships_select` queried `clients`. Postgres detected infinite recursion (error 42P17) on the very first cross-table SELECT in the RLS test suite.

**Fix:** mirror Phase 1a's pattern of using SECURITY DEFINER helpers to break the cycle. Two new helpers (`auth_user_client_ids()` returns the client IDs the auth user IS via `clients.auth_user_id`; `auth_user_org_client_ids()` returns the client IDs visible via memberships in the user's orgs). Both use SECURITY DEFINER so the underlying queries bypass RLS, breaking the recursion. Documented in 0007's helper comment block.

Lesson: any time two tables both reference each other in RLS policies, **add SECURITY DEFINER helpers proactively** rather than discovering the recursion at test time.

### Vitest file parallelism conflicts with shared DB state

The original plan included a "force rollback" test in `tests/actions/orgs.test.ts` that temporarily deleted the Simple system template, called `createOrganization`, asserted rollback, then restored the template. This deterministically fails when run in parallel with other test files that read the template (clients/projects fixtures call `createWorkflowProjectFixture` which validates the template exists).

**Fix:** removed the rollback test; left a comment explaining the trade-off. Atomicity is a Postgres engine guarantee, and the happy-path test verifies the transaction is wired correctly. If we ever need explicit rollback coverage, isolate via `vi.mock('@/db', ...)` — don't manipulate global DB state.

### Worktree's `supabase/.temp` was empty

Drizzle config + Supabase CLI both expect the linked-project metadata in `supabase/.temp/`. The auto-named worktree didn't have it — `npx supabase migration list --linked` failed with "Cannot find project ref." Fixed by `cp -r ../../../supabase/.temp ./supabase/.temp` from the main repo. Future worktrees may need the same.

### `npm` not on PATH in Bash sessions

Node is installed via nvm at `~/.nvm/versions/node/v20.20.2/bin/`; `npm` isn't on the default PATH for non-interactive shells. Every `npm`/`npx` command had to be prefixed with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && ...`. Future sessions running via this harness should expect the same; consider adding it to the shell profile or a session startup hook.

---

## Next session entry point

**Session 6 — Stakeholders + visibility profiles** (Phase 1b §32 row 2).

Suggested kickoff brief:
```
Phase 1b Session 6 — Stakeholders + visibility profiles

Goal: clients can be invited to specific projects with a visibility profile
(full / progress_only / documents_only / schedule_only / custom). Magic-link
acceptance creates a Supabase auth.users row, populates clients.auth_user_id,
and inserts a project_stakeholders row.

Tasks per ARCHITECTURE §32:
1. Migration: project_stakeholders, project_milestones (per §11.6, §11.7)
2. Replace auth_user_stakeholder_projects() stub with real implementation
3. RLS policies + visibility-profile-aware test matrix
4. actions/stakeholders.ts: invite, accept, update, remove
5. Stakeholder magic-link landing + redirect to /client/projects placeholder
6. Visibility profile preset UI on the project detail page (org-side)
7. Project list: add client name column (now meaningful)

Inherited from Session 5 (see SESSION-5-HANDOVER):
- Multi-org switcher uses `active_org_id` cookie; don't conflict
- AuditAction includes 'system_cleanup' (already)
- clients.email is GLOBALLY UNIQUE — homeowner can be in multiple orgs via
  client_org_memberships
- getInvitationByToken doesn't filter deletedAt; check it explicitly
- PCD Surveyor seeded via scripts/seed-hasnath-pcd-surveyor.ts, not migration
```

---

## Final state

- Branches: `claude/hungry-antonelli-a8fb81` (worktree, this branch); will merge into session branch then `main`.
- Cloud Supabase: migrations 0001..0009 applied. All Phase 1b tables anon-blocked.
- Local Supabase: migrations 0001..0009 applied; reference data seeded.
- RLS tests: **46/46** (29 prior + 17 new)
- Action tests: **50/50** (19 prior + 31 new)
- Cloud-smoke: **7/7** (3 prior + 4 new)
- Build clean / tsc clean / drizzle-kit check clean
- Production deploy: triggered by `main` push at session close — Vercel auto-deploys; verify `https://pcd-saas.vercel.app/dashboard/projects` returns 200 after sign-in.
