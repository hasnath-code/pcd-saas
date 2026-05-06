# Session 7 — Handover (Phase 1b: RLS hardening for stakeholder model)

**Phase:** 1b (Project Core)
**Session:** 7 of 8 (RLS hardening + cascade-cancel hotfix + CI gate)
**Date closed:** 2026-05-06
**Status:** complete; all in-scope §32 Session 7 done-criteria met. 1 session remaining (S8 workflow management). Performance review + index tuning descoped per the no-schema-changes plan and carried into S8 / follow-up.

---

## What shipped

| # | SHA | Subject |
|---|---|---|
| 1 | `694314a` | fix(stakeholders): cascade-cancel pending invitations on removeStakeholder |
| 2 | `891eea2` | test(rls): extract _helpers.ts and refactor existing RLS tests |
| 3 | `e6bfc20` | test(fixtures): add stakeholder-fixtures.ts (7 builders) |
| 4 | `b54b0d2` | test(rls): visibility-matrix.test.ts — 5 profiles × 3 tables × 4 ops |
| 5 | `d02cffe` | test(rls): edge-cases.test.ts — 6 stakeholder edge-case scenarios |
| 6 | `88180b4` | test(rls): security-boundary.test.ts — 6 attack-surface tests |
| 7 | `c419c9c` | test(actions): visibility-runtime-override + duplicate-stakeholder-actions |
| 8 | `c3da37d` | ci: add RLS gate workflow |
| 9 | (this commit) | docs: SESSION-7-HANDOVER + ARCHITECTURE-saas v0.9 |

Branch: `claude/pedantic-goldwasser-747ca1` (worktree). Pending merge into main.

---

## Verified working

### Hotfix — `removeStakeholder` cascade-cancel (commit 1)

`actions/stakeholders.ts removeStakeholder` previously did sequential ops outside a transaction:

```
SELECT stakeholder + project ↦ UPDATE soft-delete ↦ logAudit ↦ revalidatePath
```

A removed stakeholder could click their unexpired magic-link, accept, and re-establish active access via the unaccepted invitations row.

The hotfix introduces a Drizzle transaction (Hard Rule 19) and JOINs `clients` to fetch the stakeholder's email so the paired pending invitation can be looked up by `(projectId, email, invitationType='stakeholder', acceptedAt IS NULL, deletedAt IS NULL)`. If found, soft-delete it inside the same transaction. Audit log writes a second entry with `metadata.reason = 'cascade_from_remove_stakeholder'` only when the cascade fires. Already-accepted invitations are preserved (Design C).

**Three new tests** in `tests/actions/stakeholders.test.ts` (`removeStakeholder cascade-cancel` describe block):
1. Cascades pending invitation → invitations.deleted_at set + audit log captures `metadata.reason`
2. Leaves accepted invitation untouched → no second audit log entry
3. Removed-then-replay → `acceptStakeholderInvitation` returns `{error:'conflict', reason:'cancelled'}`

**Existing test updated** at `tests/actions/stakeholders.test.ts:162` (`re-invite after removal → undelete path resets fields`): the manual `f.service.from('invitations').update({ deleted_at })` step is replaced by a single `removeStakeholder()` call, exercising the cascade in passing.

### Test infrastructure (commits 2 + 3)

- **`tests/rls/_helpers.ts`** — 4 shared assertion helpers, used by all current and future RLS tests:
  - `assertVisibleIds(client, table, filter, expectedIds, testName?)` — RLS-bound SELECT IN-filter returns expected IDs
  - `assertNotVisible(client, table, rowId, testName?)` — single-row SELECT returns no rows
  - `assertWriteDenied(fn, testName?, verify?)` — INSERT/UPDATE/DELETE returns empty data; optional service-role re-check
  - `assertRpcReturns<T>(client, rpcName, args, expected, testName?)` — SECURITY DEFINER RPC returns expected shape

  The 3 existing RLS test files (`project-stakeholders`, `project-milestones`, `projects-stakeholder-visibility`) were refactored to use these helpers. Test counts unchanged at 55 after refactor — pure deduplication.

- **`tests/fixtures/stakeholder-fixtures.ts`** — 7 fixture builders:
  - `buildAcceptedStakeholderFixture(profile, customFlags?)` — happy-path baseline; auth user linked to clients.auth_user_id; project_stakeholders.accepted_at set
  - `buildPendingStakeholderFixture()` — invitation sent, never accepted, no auth identity yet
  - `buildRemovedStakeholderFixture()` — accepted then soft-deleted via project_stakeholders.deleted_at; clients row remains
  - `buildSoftDeletedClientFixture()` — clients.deleted_at IS NOT NULL; cascade-hides project + stakeholder via the helper's `c.deleted_at IS NULL` check
  - `buildExpiredInvitationFixture()` — invitation.expires_at in the past, never accepted; auth user exists for action-side accept-attempts
  - `buildMultiOrgStakeholderFixture()` — same auth identity is stakeholder on Org A's project AND Org B's project (one clients row, two project_stakeholders rows)
  - `buildOwnerAndStakeholderFixture()` — same auth identity is owner of Org A AND stakeholder of a project in Org B; tests dual-context resolution at the RLS layer (auth_user_orgs() vs auth_user_stakeholder_projects() return disjoint sets)

  Each layers on `createWorkflowProjectFixture()`. Sequential cleanup matching existing fixture conventions.

### RLS test matrix (commits 4–6)

- **`tests/rls/visibility-matrix.test.ts`** (commit 4) — parameterized via `describe.each` across 5 visibility profiles + `it.each` across 3 protected tables. 6 source `it()` blocks per profile = 30 logical declarations; Vitest expands them to **60 reports** (5 profiles × 12 tests per profile). First use of `describe.each`/`it.each` patterns in this codebase. Every assertion derives expected behavior from `auth_user_stakeholder_project_visibility(uuid)` — the canonical SECURITY DEFINER gate.

- **`tests/rls/edge-cases.test.ts`** (commit 5) — 6 scenarios + dual-context bonus, ~15 source `it()` blocks. The expired-invitation describe block imports `acceptStakeholderInvitation` directly with the standard auth/email/ratelimit/sentry mocks (the only commit-5 test file that crosses the RLS↔action boundary; the other 5 scenarios use only service-role / asUser / asAnon clients).

- **`tests/rls/security-boundary.test.ts`** (commit 6) — 6 attack-surface tests:
  1. **Anti-hijack already_accepted**: a different-email auth user replaying an already-accepted token gets `conflict/already_accepted` (NOT `email_mismatch` — the response shape doesn't reveal the legit stakeholder's email)
  2. **Anti-hijack client_already_linked second-line defense**: when `clients.auth_user_id` has been mutated to a different valid auth user (corrupted state), the legit stakeholder accepting their own token gets `conflict/client_already_linked` and the link is NOT silently overwritten
  3. **Cross-org email_mismatch**: pending invitation, different-email auth user → `not_authorized/email_mismatch`
  4. **Service-role bypass intent**: regression test documenting that service-role queries bypass RLS by design — a future "harden service-role" attempt would fail this test loudly with the explanatory comment in scope
  5–6. **SET search_path safety on `auth_user_stakeholder_project_visibility(uuid)` and `auth_user_org_project_ids()`**: queries `pg_proc.proconfig` to verify the SET clause exists; catches future migrations that drop it

### Action-layer matrix coverage (commit 7)

- **`tests/actions/visibility-runtime-override.test.ts`** — 5 tests covering the auto-flip-to-custom logic in `updateStakeholder` (per §14):
  1. `visibilityProfile='progress_only'` overrides any contradicting `customFlags` (preset wins)
  2. Individual `customFlags` without `visibilityProfile` flips `visibility_profile` to `'custom'`
  3. Explicit `visibilityProfile='custom'` + complete `customFlags` writes them directly
  4. `visibilityProfile='full'` overrides contradicting `customFlags` (preset wins, even when customFlags is partial)
  5. Audit log captures `metadata.profile_flipped_to_custom: true` on individual flag-only change

- **`tests/actions/duplicate-stakeholder-actions.test.ts`** — 3 tests, **reframed from concurrency to serial duplicate-detection** per Session 7 plan decision #8 (no DB-level partial unique index backs the action's read-then-write check, so concurrent invites are not deterministic; serial calls are):
  1. First invite succeeds; second invite for same `(orgId, email, projectId)` returns `conflict/invitation_already_pending`
  2. First remove succeeds; second remove on same row returns `conflict/already_removed`
  3. Soft-delete then RLS re-evaluation: the stakeholder's authed client sees an empty projects list immediately after `removeStakeholder` commits

### CI gate (commit 8)

`.github/workflows/rls-gate.yml` runs on every PR to main:
1. Checkout + setup-node@v4 (node 20, npm cache)
2. `npm ci`
3. `npx supabase start` (auto-applies migrations under `supabase/migrations/`; `supabase` CLI is a devDependency so no `supabase/setup-cli@v1` action needed)
4. `npm run test:rls`
5. `npm run test:actions`
6. `npm run test:cloud-smoke` — **gracefully skips** with a workflow warning when `CLOUD_SUPABASE_URL` / `CLOUD_SUPABASE_ANON_KEY` repo secrets are not yet set. Defensive fallback — the very PR landing the gate doesn't block on missing secrets. Once secrets are configured, future runs gate on cloud-smoke as well.

Concurrency group cancels in-progress runs on the same PR when new commits land. Timeout 20 minutes. Final step stops local Supabase regardless of pass/fail.

---

## User-side setup required

### 1. Configure cloud-smoke secrets (one-time)

In repo settings → Secrets and variables → Actions → New repository secret, add:

- `CLOUD_SUPABASE_URL` — production project URL (e.g. `https://nucbcqzjuusdugcgnhyo.supabase.co`)
- `CLOUD_SUPABASE_ANON_KEY` — anon key for the same project

These are **read-only credentials** — cloud-smoke uses anon-only queries to verify RLS denial against the production schema. No service-role key is needed.

Until these are set, the `Run cloud-smoke tests` step in the workflow skips with a `::warning::` message.

### 2. Configure branch protection (one-time, after first green workflow run)

After the workflow completes on the merge PR (or the next PR that lands), enable branch protection on `main`:

Settings → Branches → Branch protection rules → Add rule:
- Branch name pattern: `main`
- ☑ Require status checks to pass before merging
- ☑ Require branches to be up to date before merging
- Required status check: `RLS Gate / rls-tests`

**Do not enable this BEFORE the workflow has a green run** — would block the very PR landing the gate. The plan ordered "workflow lands first; protection enabled after" for exactly this reason.

---

## Test counts (before → after)

| Suite | Session 6 close | Session 7 close | Δ |
|---|---|---|---|
| `test:rls` (Vitest reports) | 55 | **136** | +81 (60 visibility-matrix + 15 edge-cases + 6 security-boundary) |
| `test:actions` (Vitest reports) | 66 | **77** | +11 (3 cascade-hotfix + 5 visibility-override + 3 duplicate-detection) |
| `test:cloud-smoke` | 9 | 9 | 0 |
| **Total** | 130 | **222** | **+92** |

Source-level vs Vitest-reported counts diverge because of `it.each` expansion in `visibility-matrix.test.ts`. Plan tracked source-level (~16 source it() blocks for that file); Vitest reports each iteration as a separate test (60 reports for that file). Both are fine — the gate is "all tests pass."

The §32 row 3 done criterion was "100+ RLS assertions, all passing." Current: 136 RLS, all passing. ✓

---

## Inherited assumptions Session 8 must respect

1. **`removeStakeholder` is now transactional** with a JOIN to `clients` for email lookup. Any future analogous remove flow with a paired invitation row (e.g. team-member remove) should follow the same cascade-cancel + Design C pattern. Don't add a separate "cancel paired invitation" action.

2. **Matrix testing convention** is documented in §9 of ARCHITECTURE-saas.md. When Session 8 (or Phase 1c) adds new RLS-protected tables, extend `tests/rls/visibility-matrix.test.ts` rather than duplicating the parameterized structure. The shared assertions live in `tests/rls/_helpers.ts`.

3. **Stakeholder fixture set is canonical.** `tests/fixtures/stakeholder-fixtures.ts` covers happy + 6 edge-case states. New stakeholder edge-case scenarios should add a builder here. Existing per-test-file fixtures remain in place (additive change, not a refactor).

4. **Performance review + index tuning is descoped from S7 and carries forward.** The two SECURITY DEFINER helpers dominate the query plans for stakeholder-bound queries — review their SQL bodies before any index push. Highest-traffic stakeholder paths: project list query (gated by `auth_user_stakeholder_projects()`) and milestone list query (gated by `auth_user_stakeholder_project_visibility()`). EXPLAIN before touching schema.

5. **Test counting semantics**: the `~92 source it() blocks` plan target was hit at the structural level; Vitest's reported test count (`136 RLS / 77 actions`) is higher because of `it.each` expansion. Future commits should report Vitest's count in commit bodies (Hard Rule 9), not source counts.

6. **Worktree pre-flight ritual amendment.** This worktree was missing all SKILL Rule 22 artifacts at session kickoff (`.env.local` symlink, `node_modules` symlink, `supabase/.temp/` copy). They were recreated inline. **`.env.test` is referenced in the SKILL ritual but is NOT actually used** by `tests/setup.ts` — the setup loads `.env.local` and uses `npx supabase status -o env` for local creds. SKILL Rule 22 should drop the `.env.test` step or document it as optional. Flagged in §35.7 entry 9.

7. **CI gate is now in place.** Any PR touching RLS, server actions, or migrations will run through `RLS Gate / rls-tests` automatically. Cloud-smoke is a soft gate until secrets are configured (defensive warning, not failure). Once configured, it becomes a hard gate.

8. **Hybrid RLS+actions test files exist.** `tests/rls/edge-cases.test.ts` and `tests/rls/security-boundary.test.ts` import server actions (with the standard mocks) for the security-relevant action assertions adjacent to their RLS coverage. This is a deliberate scope choice — mirrors how the action's rejection-path coverage belongs next to the RLS coverage of the same scenario. Phase 1c when adding equivalent action paths can follow the same convention.

---

## Out-of-scope / known carryovers

- **Performance review + index tuning** (originally part of §32 row 3) — descoped per plan decision #1 ("no schema changes"). Carry into S8 or as a standalone hardening task.
- **Branch protection on main** — manual UI step; cannot be enabled by Claude. Documented above.
- **Cloud-smoke secrets configuration** — manual UI step; required for the cloud-smoke gate to be hard-required. Documented above.
- **Pre-launch checklist** — depends on this hardening session's CI gate being green and branch protection being enabled. Tracked separately.

---

## Production smoke (post-merge)

No UI changes this session. After merge to main, smoke-test the production deploy:

- `https://pcd-saas.vercel.app/dashboard/projects` loads (signed in as org owner)
- The cascade-cancel hotfix doesn't break the existing project list view or remove flow

A 10-step browser walkthrough is not warranted — Session 7 is non-UI.

---

**Last reviewed:** 06 May 2026 (Phase 1b S7 shipped — v0.9)
