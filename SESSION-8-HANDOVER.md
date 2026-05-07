# Session 8 — Workflow Management + PCD Seed (Phase 1b close)

**Branch:** `claude/pedantic-chandrasekhar-54825d`
**Worktree:** `.claude/worktrees/pedantic-chandrasekhar-54825d`
**Off main at:** `e60ca15` (Session 7 — RLS Hardening for Stakeholder Model)
**Plan file:** `/Users/nuha/.claude/plans/session-8-humble-lightning.md`
**ARCHITECTURE-saas.md:** v0.9 → **v0.10** (Phase 1b complete)
**Date:** 07 May 2026

---

## What shipped

Three gaps in the Phase 1b checklist closed:

1. **Stage transitions work.** `actions/projects.ts → moveProjectToStage` + new `<StageSelector>` Select component on the project detail page. Forward + backward transitions both allowed; backward surfaces a `confirm()` prompt. Audit log `action='stage_changed'` with a 9-field locked metadata schema for Phase 1c notification dispatch.

2. **Custom workflow CRUD.** `actions/workflows.ts` (5 new actions: createWorkflow / updateWorkflow / addWorkflowStage / removeWorkflowStage / deleteWorkflow + a read-only `fetchWorkflowDetail` for the Edit dialog). New page at `/settings/workflows` with table + Create dialog + Edit dialog. Owner/admin gated. Cross-org and system-template guards. Stage validation in `lib/workflow-validation.ts` (auto-slugify, ≥1 terminal, sequential positions, unique names/slugs).

3. **PCD Surveyor seed updated 8 → 10 stages.** `scripts/seed-hasnath-pcd-surveyor.ts` STAGES array replaced in place; idempotency check by slug intact.

Plus the §35.7 Session 7 carryover (entry 10): performance audit on hot-path queries + SECURITY DEFINER helper bodies. **No new migration shipped** — existing indexes are sufficient.

---

## Commits (chronological)

| SHA | Message | Tests after |
|---|---|---|
| `07214dc` | feat(workflows): server actions for CRUD + RLS tests | 144 RLS / 93 actions / 9 cs = **246** |
| `03049f3` | feat(projects): moveProjectToStage action + tests | 147 RLS / 100 actions / 9 cs = **256** |
| `dde693f` | feat(workflows): settings page + Create/Edit dialogs | 147 / 100 / 9 = 256 |
| `00153f2` | feat(projects): StageSelector dropdown on detail page | 147 / 100 / 9 = 256 |
| `311f1f5` | feat(scripts): update PCD Surveyor seed to 10 stages | 147 / 100 / 9 = 256 |
| `e3f75ce` | perf: tighten deleteWorkflow workflow_in_use check (orgId + workflow_id) | 147 / 100 / 9 = 256 |
| `(this)` | docs: SESSION-8-HANDOVER.md + ARCHITECTURE-saas v0.10 + protective comment | 147 / 100 / 9 = 256 |

**Test count delta:** 222 → 256 (**+34** tests).

---

## Decisions worth preserving

### 1. `stage_changed` audit metadata schema is LOCKED

Every `audit_logs` row with `action='stage_changed'` and `resource_type='project'` carries this 9-field metadata blob:

```json
{
  "from_stage_id":           "<uuid>",
  "from_stage_name":         "Started",
  "from_stage_position":     1,
  "to_stage_id":             "<uuid>",
  "to_stage_name":           "In progress",
  "to_stage_position":       2,
  "workflow_id":             "<uuid>",
  "is_backward_transition":  false,
  "is_terminal_destination": false
}
```

Phase 1c notification dispatch will consume all 9 fields (e.g. `is_terminal_destination` triggers a "project completed" email; `is_backward_transition` suppresses noise on accidental rollbacks). **Any narrowing requires a migration of historical rows.** ARCHITECTURE-saas.md §13 Stage transitions documents this contract.

### 2. `deleteWorkflow` workflow_in_use check includes `org_id` (Phase E performance + correctness)

```ts
const inUse = await db
  .select({ id: projects.id })
  .from(projects)
  .where(
    and(
      eq(projects.orgId, ctx.orgId),       // ← required
      eq(projects.workflowId, workflowId),
      isNull(projects.deletedAt),
    ),
  )
  .limit(1);
```

Workflow IDs are globally unique, so filtering by `workflow_id` alone is correct **for client-via-RLS access**. But this action uses Drizzle's `db` which routes through the postgres pooler role and **bypasses RLS**. So:

- **Performance:** without `org_id`, the planner falls back to a Bitmap Heap Scan via `idx_projects_stage`'s partial-index condition (`deleted_at IS NULL`). With `org_id`, it's a clean Index Scan via `idx_projects_org`. Verified via `EXPLAIN ANALYZE`: 0.082 ms (5a) → 0.035 ms (5b) at 4-row scale; the gap widens at production scale.
- **Correctness/defense-in-depth:** the `org_id` filter eliminates a class of cross-org leak that would otherwise rely on RLS being engaged. The action layer is the right place to enforce the boundary directly.

The protective inline comment in `actions/workflows.ts:325` documents this for future maintenance — don't naively strip the `org_id` filter under "it's redundant" review.

### 3. System-template guard order: visibility-branch BEFORE cross-org branch

Mixed-visibility tables (system-seeded rows visible to all orgs + per-org rows visible only to one) need their guard branches ordered carefully. Pattern: check the publicly-visible branch (`isSystemTemplate`) before the cross-org branch (`orgId !== ctx.orgId`), because a system-template row has `orgId IS NULL` and the comparison shadows the system-template branch into a `not_found` return. We caught this in commit 2's tests; the fix landed in the same commit.

### 4. Workflow_stages table doesn't carry `deleted_at`

Stages are structural parts of their parent workflow, not independent records. `removeWorkflowStage` is a hard DELETE; the audit log uses `action='delete'` (vs. `'soft_delete'` for soft-delete-able tables). The `'delete'` action was added to the closed AuditAction union in `lib/audit/log.ts` for this case.

### 5. RLS layer was already correct for everything

Phase A1 verified that migration 0006 (workflows + workflow_stages) shipped per-command policies enforcing admin-gated INSERT/UPDATE/DELETE + system-template immutability. **No RLS migration needed for Session 8.** The action-layer guards (system-template-first ordering, cross-org `not_found` masking, system-template `not_authorized`) provide cleaner error UX and defense-in-depth, but the database layer is the actual security boundary. Both layers passing is the bar for any new feature.

---

## Phase E performance audit findings

**Process:** read SECURITY DEFINER helper bodies first (per §35.7 entry 10's explicit instruction), then `EXPLAIN ANALYZE` against cloud Supabase with current fixture data (4 projects, 5 workflows, 25 stages, 4 stakeholders, 5 clients).

**Helpers reviewed:**
- `auth_user_org_project_ids()` (`db/migrations/0010_project_stakeholders.sql:50-64`) → uses `idx_projects_org` (partial on deleted_at IS NULL).
- `auth_user_stakeholder_project_visibility(p_project_id)` (`db/migrations/0010_project_stakeholders.sql:75-97`) → uses `idx_clients_auth_user` (partial) + `idx_project_stakeholders_client` (partial).
- `auth_user_stakeholder_projects()` (`db/migrations/0013_auth_user_stakeholder_projects.sql:14-28`) → same indexed joins.

**EXPLAIN ANALYZE results:**

| # | Query | Plan | Time |
|---|---|---|---|
| 1 | `listProjectsForOrg(orgId)` | Index Scan via `idx_projects_org` | 0.046 ms |
| 2 | `listStakeholdersForProject(projectId, orgId)` | Index Scan via `idx_project_stakeholders_project` | 0.029 ms |
| 4 | `moveProjectToStage` UPDATE | Index Scan via `projects_pkey` | 6.77 ms (incl. round-trip; server work 4.4 ms) |
| 5a | `workflow_in_use` (workflow_id only — pre-fix) | Bitmap Heap Scan via `idx_projects_stage` partial-index fallback | 0.082 ms |
| 5b | `workflow_in_use` (org_id + workflow_id — fix in commit `e3f75ce`) | Index Scan via `idx_projects_org` | 0.035 ms |
| 6 | `countActiveProjectsByWorkflow(orgId)` | Nested Loop with Index Scans | 1.285 ms |

**Conclusions:**
- All 5 hot paths produce index-scan plans at current scale.
- The only optimization shipped: include `org_id` in `deleteWorkflow`'s workflow_in_use check (commit `e3f75ce` + protective comment in commit 8). See "Decisions worth preserving" entry 2.
- No new index needed. `idx_projects_workflow_id` was a candidate but the action-layer fix obviates it.

---

## Inherited assumptions Session 9 (Phase 1c kickoff) MUST respect

1. **The `stage_changed` audit metadata schema is locked at 9 fields.** Phase 1c notification dispatch reads these directly. See "Decisions worth preserving" entry 1. Any narrowing requires a migration of historical rows.

2. **`audit_logs.action` is a closed union in `lib/audit/log.ts`.** Currently: `'create' | 'update' | 'soft_delete' | 'restore' | 'delete' | 'stage_changed' | 'permission_change' | 'invite_sent' | 'invite_accepted' | 'login' | 'password_changed' | 'system_cleanup'`. Extend the union when adding a new action; don't ship free-text values.

3. **Phase 1c `project_activity` table will mirror, not replace, the audit log.** Until Session 11 ships, `audit_logs` is the canonical store for stage-change events. The migration adding `project_activity` should backfill historical rows from `audit_logs` (filter `action='stage_changed'`, copy metadata as-is into the new table's structured columns).

4. **System-template guard order: visibility before cross-org.** Mixed-visibility tables (system templates + per-org rows) need the `isSystemTemplate` check FIRST, then `orgId !== ctx.orgId`. See "Decisions worth preserving" entry 3.

5. **Action-layer queries should include `org_id` filters even when filtering by globally-unique FK.** Defense-in-depth + planner-clean. See "Decisions worth preserving" entry 2.

6. **`fetchWorkflowDetail` action exists in `actions/workflows.ts`** as a read-only, any-org-member-auth wrapper around `getWorkflowWithStages`. Mirror this pattern when client components need lazy-load reads (no calling `db/queries/*` directly from client components — they're `server-only`).

7. **`/settings/workflows` is the canonical workflow management surface.** Linked from `/settings`. Phase 1c shouldn't reinvent it.

8. **The PCD Surveyor seed script (`scripts/seed-hasnath-pcd-surveyor.ts`) is a one-shot manual operational tool, not a migration.** Don't add it to the test suite or CI. Don't auto-run it on signup.

9. **Phase 1b is closed.** Session 9 is Phase 1c kickoff (messages + conversations). The next ARCHITECTURE-saas.md changes go under §33 (Phase 1c Build Checklist).

---

## Phase F — Browser QA (pending user execution)

QA Phase F was deferred to user execution post-merge (gh CLI unavailable in the worktree to coordinate PR creation + preview deploy). 8 manual steps to walk through against your test org once the PR is merged + deployed:

**Setup:**
- Production URL: https://pcd-saas.vercel.app
- Sign in to a **separate test org**, NOT your real PCD org (16240187).

**Steps:**

1. Navigate to `/settings/workflows`. Confirm the seeded "Simple" workflow appears in the list (no PCD on the test org). Empty-state copy reads "No custom workflows yet" if the org has none.

2. Click **Create workflow**. Fill name "Test Workflow"; defaults are 3 stages (Started, In progress, Done — terminal). Submit. Expected: toast "Created 'Test Workflow'", new row in the table with stage count = 3.

3. Click **Edit** on Test Workflow. In the bottom section, type "QA Hold" + leave terminal unchecked + click **Add**. Expected: toast "Added 'QA Hold'", row added to the stage list with position 4.

4. Open any existing project's detail page (`/dashboard/projects/<projectId>`). The Workflow card should show:
   - Top: horizontal stage timeline with current stage highlighted (existing behavior, unchanged).
   - Bottom (separated by hairline): a **Move stage** label + Select dropdown listing all stages by position.

5. In the Select, pick a forward stage. Expected: toast "Project moved to '[stage name]'" and the highlighted stage in the timeline above shifts. Verify audit row via Supabase Studio:
   ```sql
   SELECT metadata FROM audit_logs
   WHERE action='stage_changed'
   ORDER BY created_at DESC
   LIMIT 1;
   ```
   The metadata should have all 9 locked fields populated (see "Decisions worth preserving" entry 1).

6. In the Select, pick a backward stage. Expected: native `confirm()` dialog with "Move this project back to '[name]'? This is unusual but sometimes necessary. The change is logged." Click OK. Expected: transition succeeds; audit row metadata has `is_backward_transition: true`.

7. *(Multi-context check.)* Open a second browser context (incognito) signed in as a stakeholder with `can_view_schedule = true` on this project. Navigate to `/portal/projects/<projectId>`. Confirm the new stage shows on their portal.

8. Back on `/settings/workflows`, attempt to **Delete** the "Simple" workflow (which the project from step 5 uses). Expected: toast "Cannot delete: 1 project(s) use this workflow. Move them off first." (the count reflects active projects).

**On any defect:** capture screenshot + logs, file via the issue tracker, and reference back to the relevant commit SHA from the table at the top of this file.

---

## PCD Surveyor seed — manual upgrade path

The seed script (`scripts/seed-hasnath-pcd-surveyor.ts`) targets the org with `company_number=16240187` (your real PCD org). It's idempotent: re-runs after success exit cleanly (slug check at lines 98-110).

**If you previously ran the 8-stage version against your real org:** the script will skip with a no-op message. To upgrade to the 10-stage version, drop the existing workflow + stages first via Supabase Studio:

```sql
-- Replace <orgId> with your org's UUID (e.g. from `SELECT id FROM organizations WHERE name LIKE '%PCD%'`).
DELETE FROM workflows
WHERE org_id = '<orgId>' AND slug = 'pcd_surveyor';
-- workflow_stages cascade via FK ON DELETE CASCADE.
```

Then re-run:

```bash
# Cloud target:
NEXT_PUBLIC_SUPABASE_URL=https://gcwdasdujivliplthpvv.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
npm run db:seed-pcd-surveyor
```

Expected output: `inserted workflow <uuid> + 10 stages.` then `audit row written. done.`

**Verify in the app:** navigate to `/settings/workflows`. The "PCD Surveyor" workflow should appear with stage count = 10. Edit to inspect the 10 stages — names + positions should match `§Decision 2 detail` in the plan file verbatim.

**If projects on the org currently sit on a stage from the old 8-stage workflow:** the DELETE will fail (FK ON DELETE RESTRICT on `projects.current_stage_id`). Move those projects to the Simple workflow's first stage manually via the dashboard before dropping. Then re-run the seed. After the new workflow exists, you can re-assign projects manually via the dashboard.

---

## Build / test state at session close

- `npx tsc --noEmit` — clean
- `npm run build` — clean (route `/settings/workflows` 8.0 kB / 223 kB First Load JS)
- `npm test:rls` — 147/147 passing
- `npm test:actions` — 100/100 passing
- `npm test:cloud-smoke` — 9/9 passing (env-gated, run separately)
- Worktree: clean status before each commit

---

## Phase 1b post-mortem (light)

Phase 1b shipped across Sessions 4-8 (excluding initial setup):

| Session | Theme | Net adds |
|---|---|---|
| S4 | Org type selection + signup flow | onboarding |
| S5 | Multi-org + project create + Simple template clone | projects, multi-org |
| S6 | Stakeholder invitations + portal | clients, stakeholders, portal |
| S7 | RLS hardening + matrix tests + CI gate | RLS, security |
| S8 | Workflow CRUD + stage transitions + perf audit | workflows, transitions |

**End-state:** a working B2B SaaS where a surveyor can sign up, create projects, invite stakeholders, set per-stakeholder visibility, customize the workflow, transition projects through stages, and see all of it through both their dashboard and the stakeholder portal — with full RLS, audit logging, and CI regression-protection.

**Phase 1c (Sessions 9-11)** lights up the asynchronous communication layer: messages, file uploads, notifications, project_activity timeline. Then **Session 12** is integration test + polish + Phase 2 spec.

— end —
