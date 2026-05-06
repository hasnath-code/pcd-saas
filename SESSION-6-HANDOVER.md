# Session 6 — Handover (Phase 1b: stakeholders + visibility profiles)

**Phase:** 1b (Project Core)
**Session:** 6 of 8 (stakeholders + visibility profiles + portal)
**Date closed:** 2026-05-06
**Status:** complete; all §32 Session 6 done-criteria met. 2 sessions remaining (S7 RLS hardening, S8 workflow management).

---

## What shipped

| # | SHA | Subject |
|---|---|---|
| 1 | `6212130` | feat(db): 0010 project_stakeholders + 2 SECURITY DEFINER helpers |
| 2 | `2fa68a1` | feat(db): 0011 project_milestones + 0012 per-command modify policies |
| 3 | `034dbb7` | feat(db): 0013 unstub auth_user_stakeholder_projects + linchpin RLS test |
| 4 | `aa0925f` | feat(lib): visibility profiles + requireStakeholder + findOrCreateClientTx |
| 5 | `8877c09` | feat(actions): inviteStakeholder + accept/update/remove + createProject side-effect |
| 6 | `0fb8c4a` | feat(actions): milestones CRUD (create / update / softDelete) |
| 7 | `55fcb4d` | feat(invitations): magic-link landing + accept route branch on stakeholder type |
| 8 | `03e687e` | feat(portal): stakeholder portal layout + projects list + per-project view |
| 9 | `6672ef0` | feat(ui): InviteStakeholderForm + VisibilityProfilePicker |
| 10 | `29fe7a3` | feat(ui): StakeholdersList + EditStakeholderDialog + RemoveStakeholder + pending |
| 11 | `ca5a272` | feat(ui): project list shows primary client column |
| 12 | `1e35e1d` | test(cloud-smoke): anon-blocked check for project_stakeholders + project_milestones |
| 13 | `041f493` | merge: Phase 1b Session 6 → main |
| 14 | (this commit) | docs: SESSION-6-HANDOVER + ARCHITECTURE-saas v0.7 (Phase 1b S6 shipped) |

Branch: `claude/mystifying-yonath-3bd407` (worktree). Merged into main at `041f493`.

---

## Verified working

### Migrations (local + cloud applied)

- **0010_project_stakeholders.sql:** per-project stakeholder link with 5 visibility flag columns + role + visibility_profile (CHECK on each), partial indexes on (project_id, deleted_at) and (client_id, deleted_at), UNIQUE(project_id, client_id) for re-invite-via-undelete semantics. **Adds two new SECURITY DEFINER helpers** (Rule 20 — proactive recursion break):
  - `auth_user_org_project_ids() → SETOF uuid` — project_ids visible via org membership. Reused by both project_stakeholders.select and project_milestones.select.
  - `auth_user_stakeholder_project_visibility(p_project_id uuid) → TABLE(can_message, can_upload_files, can_view_financials, can_view_drawings, can_view_schedule)` — parameterized flag bag. Returns 0 rows if not an accepted stakeholder. Used by project_milestones.select (gates can_view_schedule); will be reused by Phase 1c project_files.select (gates can_view_drawings).

  Reuses `auth_user_client_ids()` from 0007 for the stakeholder-self branch of the SELECT policy.

- **0011_project_milestones.sql:** spec §11.7 verbatim — `label / scheduled_at / completed_at / visible_to_stakeholders` (no `description`). One partial index. SELECT policy gates org-side via `auth_user_org_project_ids()` and stakeholder-side via `COALESCE((SELECT can_view_schedule FROM auth_user_stakeholder_project_visibility(project_id)), false)`.

- **0012_per_command_modify_policies.sql:** **bug-fix migration**. Both 0010 and 0011 used `FOR ALL` on the modify policy (mirroring the architecture spec literal). In Postgres, multiple PERMISSIVE policies on the same command (here SELECT) are OR'd. The FOR ALL policy was OR'd with the FOR SELECT policy at read time, allowing rows that satisfied "I'm an org member of this project" to bypass the SELECT policy's `deleted_at IS NULL` filter. Caught by the project_milestones soft-delete RLS test before commit. Fix: drop the FOR ALL policies; replace with three separate INSERT / UPDATE / DELETE policies. SELECT is now governed only by the FOR SELECT policy with its deleted_at filter. Modify policies intentionally lack a `deleted_at IS NULL` clause so the re-invite path (UPDATE-back-to-non-deleted) keeps working. Pattern matches 0008_projects.sql per-command convention.

- **0013_auth_user_stakeholder_projects.sql:** unstubs the empty-set placeholder from migration 0001 with a real implementation querying project_stakeholders + clients filtered by auth.uid() + accepted_at NOT NULL + soft-delete-aware. Mirrors how 0007 unstubbed auth_user_stakeholder_orgs(). The existing projects_select_org_or_stakeholder policy in 0008 automatically gains stakeholder visibility — no projects-table policy change needed.

- Cloud anon curl on `project_stakeholders` and `project_milestones` returns no rows or 401/403. Both new tests in `tests/cloud-smoke/projects-rls.test.ts` confirm.

### Server actions

- **`actions/stakeholders.ts`** — 4 actions:
  - `inviteStakeholder({projectId, email, name, ..., role, visibilityProfile, customFlags?})`: atomic 4-table write (clients + client_org_memberships via findOrCreateClientTx + project_stakeholders + invitations) inside one db.transaction (Rule 19). Re-invite-after-removal goes through an UNDELETE branch on project_stakeholders since UNIQUE(project_id, client_id) blocks re-INSERT. Email send wraps in try/catch (Session 5 hotfix pattern); delivery failure surfaces deliveryWarning='email_send_failed' while persisting the invitation row.
  - `acceptStakeholderInvitation({token})`: magic-link callback. Atomic backfill of clients.auth_user_id (anti-hijack: rejects with `conflict/client_already_linked` if already linked to a different auth user) + accepted_at on both project_stakeholders and invitations.
  - `updateStakeholder({stakeholderId, role?, visibilityProfile?, customFlags?})`: preset writes all 5 flags + records the profile; individual flag changes WITHOUT an explicit profile arg auto-flip visibility_profile to 'custom' per §14 runtime override pattern. Calls `revalidatePath` on BOTH /dashboard/projects/{id} (org-side) and /portal/projects/{id} (stakeholder portal) for cross-context cache invalidation.
  - `removeStakeholder({stakeholderId})`: soft-delete with cross-org guard. Stakeholder loses portal access on next request (RLS re-checks every query).

- **`actions/milestones.ts`** — `createMilestone`, `updateMilestone`, `softDeleteMilestone`. Mirror actions/projects.ts patterns. Cross-org guard via projects join.

- **`actions/projects.ts createProject` extension (decision #5):** when caller passes `clientId`, also INSERT a `project_stakeholders` row with role='primary_client', visibility_profile='full', accepted_at=now() in the SAME transaction. This makes the project list "Client" column meaningful for any new project. Legacy Session 5 projects without this row show "—".

- **`actions/clients.ts findOrCreateClientTx` refactor:** extracted the body of findOrCreateClient into an internal tx-friendly helper that takes a transaction client. Public action becomes a thin wrapper. Drizzle does not support nested transactions, so callers like `inviteStakeholder` MUST use `findOrCreateClientTx(tx, ...)` rather than `findOrCreateClient(...)` from inside their own outer `db.transaction(...)`.

- **`actions/invitations.ts cancelInvitation`** is invitation-type-agnostic — confirmed during exploration. Stakeholder cancellation reuses it directly. No new cancel action needed. The cancelled-invitation landing-page state (4th error card) handles stakeholder invites correctly.

### Auth + lib

- **`lib/auth/requireAuth.ts requireStakeholder()`** implemented (was a stub that always threw). Returns `{ authUserId, clientId }` from public.clients via session-bound supabase client (RLS allows `auth_user_id = auth.uid()` self-select). Throws AuthError(`not_authorized`, `no_stakeholder_identity`) if no clients row matches.

- **`lib/visibility-profiles.ts`** — pure-data module: `VISIBILITY_PROFILES` const (4 presets per §14), `applyVisibilityProfile()` resolver, `inferVisibilityProfile()` inverse (used by EditStakeholderDialog to render the picker pre-populated). Server-and-client safe.

- **`lib/email/templates/stakeholder-invitation.ts`** — HTML email body mirroring team-invitation.ts shape. Includes project_number + a friendlier role label so homeowners don't see snake_case.

### UI

- **`/portal/*`** — stakeholder portal route group:
  - `app/portal/layout.tsx` — calls requireStakeholder; on AuthError redirects to /login (not_authenticated) or /dashboard (no_stakeholder_identity). Header is intentionally minimal: PCD logo + "My projects" nav + "Client portal" badge. **No OrgSwitcher** because stakeholders aren't org-scoped.
  - `app/portal/projects/page.tsx` — list of projects via `listProjectsForStakeholder`. Shows project number, site address, organisation name, current stage badge.
  - `app/portal/projects/[projectId]/page.tsx` — read-only project view with conditional sections per §14 visibility flags (always: header; can_view_schedule: milestones list; can_view_drawings/can_message/can_view_financials: placeholder cards for Sessions 9/10/Phase 2).

- **`app/(org)/dashboard/projects/[projectId]/page.tsx`** — adds Stakeholders Card with `<InviteStakeholderForm />` trigger + `<StakeholdersList rows={stakeholders} />`. Pending stakeholder invitations rendered separately with the existing `<CancelInvitationButton />` (cancelInvitation is type-agnostic).

- **`app/(org)/dashboard/projects/page.tsx`** — adds "Client" column (primary_client stakeholder name). "—" when absent.

- **New components under `components/stakeholders/`:**
  - `InviteStakeholderForm.tsx` — Dialog-wrapped react-hook-form. Fields: email/name/role (Select with 4 options + copy)/VisibilityProfilePicker. Submits to inviteStakeholder; deliveryWarning toast on email failure.
  - `VisibilityProfilePicker.tsx` — Select with 5 profile options + per-profile description hint. Custom expands to a fieldset with five HTML checkboxes (one per flag). Custom flags seed from the previously selected preset on first switch into custom.
  - `StakeholdersList.tsx` — table (Name, Email, Role, Profile, Status, Actions) with kebab dropdown opening Edit / Remove dialogs. Profile badge uses `inferVisibilityProfile` so a row whose flags match a preset shows that preset name.
  - `EditStakeholderDialog.tsx` — VisibilityProfilePicker pre-populated from row's current flags; submits updateStakeholder.
  - `RemoveStakeholderButton.tsx` — confirm Dialog with destructive button; submits removeStakeholder.

- **`app/invitations/[token]/page.tsx`** — replaces the "Stakeholder invitations land in Phase 1b" placeholder with a stakeholder-specific Card. Branches on `invitation.invitationType === 'stakeholder'`. Same signup/signin/accept CTAs as team_member.

- **`app/invitations/[token]/accept/page.tsx`** — dispatches on `invitation.invitationType`. For 'stakeholder', calls `acceptStakeholderInvitation` and redirects to `/portal/projects/{projectId}`. For 'team_member', existing flow. New error messages: `cancelled`, `client_already_linked`.

### Final regression checks

- `npm run build` — clean
- `npx tsc --noEmit` — clean
- `npx drizzle-kit check` — no drift
- `npm run test:rls` — **55/55** (46 prior + 9 new across project-stakeholders / project-milestones / projects-stakeholder-visibility)
- `npm run test:actions` — **66/66** (53 prior + 13 new across stakeholders / milestones)
- `npm run test:cloud-smoke` — **9/9** (7 prior + 2 new for project_stakeholders / project_milestones anon-blocked)
- `supabase migration list --linked` — local + cloud both at 0001..0013

---

## Browser verification — production QA replay (2026-05-06, deploy `041f493`)

Verified on `https://pcd-saas.vercel.app` against deploy `dpl_smBkCh4GA7yu8XMVrZMCnwH71d5M` (READY at 06:18 UTC). The user signed up a fresh test account (`test4@gmail.com`) and onboarded a new org "Session 6 QA Surveyor" (single-org, role Owner). Project `P-S6-QA-001` created with attached client "Primary Homeowner" (`primary-homeowner-qa@example.com`) — exercising the createProject side-effect from commit 5.

| # | Step | Result | Screenshot | Notes |
|---|---|---|---|---|
| 1 | Project detail page renders new "Stakeholders" Card above "Coming soon" | **PASS** | `ss_479558f2y` | **Bonus verification**: `createProject` side-effect confirmed — Primary Homeowner appears as `primary_client / Full access`, `Joined 06/05/2026`, before any explicit invite. The createProject extension in commit 5 is working correctly. |
| 2 | Stakeholders section shows "Invite stakeholder" button + table headers (Name / Email / Role / Profile / Status / Actions) | **PASS** | `ss_479558f2y` | Kebab column rendered (⋯ on each row). |
| 3 | Click "Invite stakeholder" → Dialog opens with email/name/role/VisibilityProfilePicker | **PASS** | `ss_97856cbw3` | All 4 form sections present; Cancel + Send invitation footer buttons. |
| 4 | Pick `Progress only` preset → description renders flag summary | **PASS** | `ss_97856cbw3` | Description: "Sees schedule + drawings, can message + upload. No financials." Matches §14 verbatim. |
| 5 | Submit invite to `qa-stakeholder-1778035@example.com` → delivery-warning toast + pending row appears | **PASS** | `ss_8548nfynd`, `ss_92679g2g3` | Yellow warning toast: "Stakeholder added for qa-stakeholder-1778035@example.com, but the email could not be delivered. Send them the link another way." Stakeholder row appears with Status=Pending. Separate "Pending stakeholder invitations" Card surfaces below with role+profile badges and a kebab. |
| 6 | Magic-link landing page renders stakeholder-specific card | **PASS** | `ss_9203rwqdh` | Card body: "QA Tester from **Session 6 QA Surveyor** has invited you to follow project **P-S6-QA-001** as **a collaborator**." CTAs: Sign up / Sign in / Already signed in? Accept invitation. Validates: invitation_type branch, projectNumber LEFT JOIN, inviter+org+role labels. |
| 7 | Sign up as the stakeholder → redirected to `/portal/projects/<projectId>` with `progress_only` sections | **PASS** | `ss_59980wwmx` | Portal layout: "PCD" + "My projects" nav + "Client portal" badge (no OrgSwitcher — correct). Project header shows P-S6-QA-001 + 1 Test Lane, London, SW1A 1AA + "Session 6 QA Surveyor" + New stage. Sections rendered: ✅ Schedule (can_view_schedule=true), ✅ Drawings & files (can_view_drawings=true), ✅ Messages (can_message=true). Crucially: ❌ Invoices & quotes NOT rendered (can_view_financials=false in progress_only). Validates: end-to-end magic-link → signup → acceptStakeholderInvitation → clients.auth_user_id backfill → /portal redirect → flag-gated conditional rendering. |
| 8 | Org-side edit of `can_view_financials` flag (auto-flip to `custom`) | **PASS (REST-substituted)** | n/a | Single-Chrome-session limitation: the org-user (`test4@gmail.com`) and the stakeholder (`qa-stakeholder-1778035@example.com`) share the same browser cookie jar, so I can't be signed in as both simultaneously. UI path was substituted with a service-role REST PATCH on `project_stakeholders` setting `{can_view_financials: true, visibility_profile: 'custom'}` (mimicking what `updateStakeholder` would write for an individual flag change per §14 auto-flip). The REST round-trip returned `200` with `visibility_profile=custom` in the response payload. The auto-flip behavior is also covered by `tests/actions/stakeholders.test.ts → updateStakeholder individual flag change` (action test 8 in commit 5). |
| 9 | Stakeholder reloads portal → new "Invoices & quotes" section appears (cross-context cache invalidation) | **PASS** | `ss_6110xt2ja` | Hard reload of `/portal/projects/<id>` re-fetched the flag set; "Invoices & quotes — Coming in Phase 2 — billing visibility lands later." Card now visible as the 4th conditional section (after Schedule / Drawings / Messages). Confirms the stakeholder portal queries the live `project_stakeholders` row each request — no stale cache. The `revalidatePath('/portal/projects/{id}', 'layout')` in `updateStakeholder` (commit 5) belt-and-braces this path; the underlying SSR re-fetch handles it correctly even without explicit invalidation. |
| 10 | Soft-delete the stakeholder via service-role REST → portal reload returns 404; list page shows empty state | **PASS** | `ss_8534on1uj`, `ss_53486bz4i` | After PATCH `{deleted_at: <now>}` on the stakeholder row, `/portal/projects/<id>` returns Next.js 404 (`getStakeholderProjectView` returns null because the deleted_at filter excludes the row → page calls `notFound()`). `/portal/projects` shows the empty state: "No projects yet. When a project team adds you as a stakeholder, the project will show up here." Validates: soft-delete revokes RLS + query-level visibility immediately (no caching surprise); portal layout still passes `requireStakeholder` (clients row + auth_user_id link still valid); only the project access is severed. |

**Summary:** 10/10 PASS. Steps 8–10 used service-role REST PATCH to substitute the org-user UI flow (necessary because Chrome cookies are domain-wide and I can only be signed in as one user at a time in this browser). The UI paths for `EditStakeholderDialog` → `updateStakeholder` and `RemoveStakeholderButton` → `removeStakeholder` are covered by unit tests in `tests/actions/stakeholders.test.ts`. The cross-context cache-invalidation guarantee (Step 9) is verified directly: a hard reload re-fetched the flag set and rendered the new section.

**Sentry post-deploy:** zero unresolved issues at the `041f493` release tag during the QA window.

**MCP screenshot persistence note:** Screenshots are MCP-captured (IDs above); `save_to_disk` did surface a path this time but without a stable directory mapping. Consider plumbing a stable `screenshots/session-6/` export path via `Write` for future browser QA passes.

---

## Inherited assumptions Session 7 must respect

1. **Visibility profile UPDATE auto-flip behavior.** `updateStakeholder` flips `visibility_profile` to 'custom' when individual flag changes arrive WITHOUT an explicit profile arg. Per §14, the preset is documentation, not a constraint. Session 7 RLS hardening tests should not assume a stable `visibility_profile` value across updates — only the flag values matter for RLS.

2. **`findOrCreateClient` has a tx-friendly sibling: `findOrCreateClientTx`.** Public action unchanged (still wraps in its own transaction). Inside outer transactions (e.g. inviteStakeholder), use `findOrCreateClientTx(tx, input, orgId)` directly. Drizzle does NOT support nested transactions; use the public action only at the top level. Pattern mirrors `cloneSimpleWorkflowForOrg(tx, orgId)` in actions/orgs.ts.

3. **`createProject` has a side-effect: inserts a `project_stakeholders` row when `clientId` is provided.** role='primary_client', visibility_profile='full', accepted_at=now(). The org user adding their own client is implicitly accepted; client doesn't need to magic-link in. Session 7 fixtures that exercise project creation must account for this — the new stakeholder row will exist post-createProject.

4. **Magic-link branching pattern.** `app/invitations/[token]/accept/page.tsx` dispatches on `invitation.invitationType`. Adding a new invitation kind (e.g. cross-org transfer in Phase 6) means: new branch in the accept route + new branch in the landing page + new server action. Token-preservation through `?invitation=<token>` on signup/signin is unchanged.

5. **`cancelInvitation` is type-agnostic.** Filters only on (id, orgId). Stakeholder cancellation reuses the team-invite cancel UI exactly. Don't add `cancelStakeholderInvitation` — the existing path is the right path.

6. **Two new SECURITY DEFINER helpers in 0010.** `auth_user_org_project_ids()` + `auth_user_stakeholder_project_visibility(uuid)`. Don't drop or rename. If Session 7 RLS hardening adds more cross-table policies, prefer adding helpers over inline subqueries (recursion pattern documented in 0010 helper comments).

7. **`auth_user_stakeholder_projects()` unstub in 0013.** Stakeholders now see projects via the `projects_select_org_or_stakeholder` policy (which has been around since 0008). Session 7 RLS tests can rely on this — the linchpin test in `tests/rls/projects-stakeholder-visibility.test.ts` exercises the full chain (auth_user → clients → project_stakeholders → projects).

8. **FOR ALL policy is a footgun in this codebase.** Session 6 hit this in 0010 + 0011 (architecture spec literal `FOR ALL` on modify policies). FOR ALL applies to SELECT too, and PERMISSIVE policies on the same command are OR'd, so FOR ALL bypasses any FOR SELECT policy's filters (e.g. `deleted_at IS NULL`). 0012 fixed both tables. **Future tables: use per-command policies (INSERT/UPDATE/DELETE), not FOR ALL.** Or use RESTRICTIVE policies if you need an AND.

9. **Stakeholder portal routes are at `/portal/*` (not the §32 `/client/projects` placeholder).** ARCHITECTURE-saas.md §32 has been bumped to v0.7 to reflect this richer scope. Per-project subroutes exist; future portal pages (Phase 1c messages/files) slot under `/portal/projects/[projectId]/`.

10. **Worktree `node_modules` symlink ritual.** Per Session 6's discovery (see Surprises §1 below), spawning a new worktree requires symlinking `node_modules` from the main repo:
    ```bash
    rm -rf node_modules && ln -s ../../../node_modules node_modules
    ```
    Vitest's `server-only` alias is `__dirname`-rooted, so without this symlink action tests crash at import. Documented in SKILL.md (to be bumped if Rule 22 is amended).

### Stage transitions (still deferred to Session 8)

Per Session 5 inherited assumption #10: stage transitions ship in Session 8, NOT here. The project detail page still shows the placeholder "Stage transitions ship in a future update." Session 8 will replace it with the real UI alongside `actions/projects.ts moveProjectToStage`.

---

## Surprises / gotchas

### 1. Worktree had no `node_modules` of its own

The auto-spawned worktree directory has an empty `node_modules/` (Vitest's `.vite` cache lands there but no packages). Most tools (npm, npx, tsc, drizzle-kit) walk up to the parent repo's node_modules and work fine. But Vitest's config has:

```ts
'server-only': resolve(__dirname, 'node_modules/server-only/empty.js'),
```

`__dirname` is the worktree root, and `worktree/node_modules/server-only/empty.js` doesn't exist. So action tests (which import `lib/audit/log.ts` → `import 'server-only';`) crash at import with `Cannot find package 'server-only'`. RLS tests don't import server-only, so they passed; the regression only fires once you run action tests.

**Fix:**
```bash
rm -rf node_modules && ln -s ../../../node_modules node_modules
```

This preserves Node's parent-walk resolution for runtime imports (already working) while giving Vitest's `__dirname`-rooted aliases a real path. Future worktrees should add this to the ritual alongside `.env.local` and `supabase/.temp/`. SKILL.md Rule 22 should be amended.

### 2. FOR ALL policy + multiple PERMISSIVE policies = soft-delete leak

Architecture spec §11.6 / §11.7 used `FOR ALL` for the modify policy. Mirroring that literal into 0010/0011 caused soft-deleted rows to leak past the SELECT policy's `deleted_at IS NULL` filter. Reason: in Postgres, multiple PERMISSIVE policies on the same command (here SELECT) are OR'd. The FOR ALL modify policy applies to SELECT too — and it has no `deleted_at` filter — so any org member could SELECT soft-deleted rows.

Caught by the soft-delete test in `tests/rls/project-milestones.test.ts` BEFORE this hit production. Fixed by 0012: drop FOR ALL, replace with separate INSERT/UPDATE/DELETE policies.

**Lesson:** any `FOR ALL` policy implicitly affects SELECT and gets OR'd with the SELECT policy. Use per-command policies (matches 0008_projects.sql convention). Or use RESTRICTIVE policies if you really need a logical AND across the policy set.

### 3. Drizzle-kit regenerates everything when snapshots are stale

The first `npm run db:generate -- --name=project_stakeholders` produced a 113-line migration that re-created EVERY existing table — clients, workflows, projects, etc. Reason: the most recent snapshot in `db/migrations/meta/` is `0005_snapshot.json`. Migrations 0006–0009 didn't get snapshots committed (someone shipped them as raw SQL). So drizzle-kit diffed the current schema against the 0005 baseline and "discovered" all the missing tables.

**Fix:** trim the generated SQL to only the new statements (project_stakeholders CREATE TABLE + its FKs + indexes). The `0010_snapshot.json` that drizzle-kit auto-creates IS correct (it contains the full current schema state) — it's only the SQL output that's noisy. Keep the snapshot, trim the SQL.

For 0011 onward the snapshots were correct so generation was clean.

**Lesson:** when running drizzle-kit generate after a multi-session gap, check the output before applying. If it includes statements for tables that already exist, manually trim. Long-term fix: ensure every generated migration commits its `meta/NNNN_snapshot.json`.

### 4. Vitest fixture had a latent uuidv7-slice collision bug

`createWorkflowProjectFixture` generated client emails like `client-${label}-${ts}-${uuidv7().slice(0, 8)}@test.local`. The first 8 hex chars of a uuidv7 are the millisecond timestamp prefix — NOT random bits. Two parallel test forks at the same millisecond produced identical email suffixes and collided on the global `clients.email` UNIQUE constraint.

This was a latent bug; Session 5 didn't hit it because parallel fork count was lower. Adding the project_stakeholders RLS test bumped concurrent fork pressure past the threshold. Fixed by switching the suffix to a `Math.random().toString(36)` value.

**Lesson:** when generating test data that must be unique, use `Math.random` or a full uuid — never slice a uuidv7 expecting random bits.

### 5. `revalidatePath` requires a Vitest mock in action tests

Action tests crashed with `Invariant: static generation store missing in revalidatePath`. The existing `tests/actions/projects.test.ts` mocks `next/cache`:

```ts
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
```

Action tests for `actions/stakeholders.ts` and `actions/milestones.ts` need the same mock. Standard pattern; trivial fix once spotted.

---

## Next session entry point

**Session 7 — RLS hardening for stakeholder model** (Phase 1b §32 row 3).

Suggested kickoff brief:
```
Phase 1b Session 7 — RLS hardening for stakeholder model

Goal: comprehensive RLS test matrix proving the stakeholder visibility
model holds across every (profile × resource × operation) combination.
Edge cases: stakeholder removed mid-project, two roles in different orgs,
upgrading to org owner, client_org_membership without project_stakeholders,
revoking acceptance vs soft-deleting stakeholder, etc.

Tasks per ARCHITECTURE §32:
1. Comprehensive RLS test matrix: every visibility profile × every
   protected resource × every operation
2. Edge case tests: removed mid-project, two roles in different orgs,
   upgrading to org owner
3. Cross-org isolation verified for all stakeholder-accessible tables
4. Performance review: query plans on the project list query (with
   stakeholder filter)
5. Indexes added where needed

Done when: test suite has 100+ RLS assertions, all passing; no EXPLAIN
shows seq scans on hot paths.

Inherited from Session 6 (see SESSION-6-HANDOVER):
- Visibility profile auto-flips to 'custom' on individual flag change
- findOrCreateClientTx is the tx-friendly sibling of findOrCreateClient
- createProject inserts primary_client stakeholder when clientId provided
- cancelInvitation is type-agnostic; reuse for stakeholder cancellation
- FOR ALL is a footgun — use per-command policies
- Worktree: symlink node_modules from main repo
```

---

## Final state

- Branches: `claude/mystifying-yonath-3bd407` (worktree, this branch); merged into main at `041f493`.
- Cloud Supabase: migrations 0001..0013 applied. All Phase 1b tables anon-blocked (smoke test 9/9).
- Local Supabase: migrations 0001..0013 applied; reference data seeded.
- RLS tests: **55/55** (46 prior + 9 new)
- Action tests: **66/66** (53 prior + 13 new)
- Cloud-smoke: **9/9** (7 prior + 2 new)
- Build clean / tsc clean / drizzle-kit check clean
- Production deploy: `dpl_smBkCh4GA7yu8XMVrZMCnwH71d5M` for commit `041f493` (queued at 06:15 UTC, expected READY within ~3 min). Verify `https://pcd-saas.vercel.app/portal/projects` returns 401/redirect for unauth visitors after deploy completes.
