# Architecture Decision Records

**Purpose:** Every non-trivial architectural decision gets logged here with the *why* — not just what was chosen, but what was rejected and what would make us reconsider. When you're nine months in and Claude Code asks "why isn't this an enum?", this file is the answer.

**Scope:** Both the Apps Script portal (in-house) and the SaaS product. Tag each entry with which codebase it applies to.

**Format:** Most recent at top. Each entry is short — a paragraph or two of context, the decision itself, and the trigger that would make us revisit it.

**House rule:** No architectural choice gets locked into ARCHITECTURE.md or ARCHITECTURE-saas.md without a corresponding entry here. The doc shows what; this shows why.

---

## How to add an entry

```
## ADR-NNN — <short title>
**Date:** DD MMM YYYY
**Codebase:** Apps Script | SaaS | Both
**Status:** Accepted | Superseded by ADR-XXX | Reconsidering

**Context:** What problem are we solving? What constraints exist?

**Decision:** What we chose, in one sentence.

**Alternatives rejected:**
- Option B — why not
- Option C — why not

**Reconsider if:** The condition that would trigger revisiting this.

**Cross-references:** ARCHITECTURE-saas.md §X, SESSION-N-HANDOVER.md, ADR-YYY
```

---

## ADR-024 — Native window.confirm() acceptable for Phase 1b backward-transition UX
**Date:** 07 May 2026 (Session 8)
**Codebase:** SaaS
**Status:** Accepted (revisit pre-launch)

**Context:** The StageSelector component needs a confirmation dialog when a user picks a stage with lower position than current ("are you sure you want to move backwards?"). shadcn AlertDialog isn't shipped in the codebase yet. Other parts of the codebase (WorkflowsList, EditWorkflowDialog) already use native `window.confirm()` for similar prompts.

**Decision:** Use native `window.confirm()` for Phase 1b. Verified working via manual Phase F test (07 May 2026) — dialog renders correctly, OK button completes the transition, Cancel aborts cleanly.

**Alternatives rejected:**
- Custom modal component built ad-hoc — duplicates work that shadcn AlertDialog will solve cleanly.
- Block backward transitions entirely — rejected per ADR-022; real-world projects regress.
- Toast-based "click again to confirm" — fragile UX, easy to dismiss accidentally.

**Reconsider if:** shadcn AlertDialog is added to the codebase (in which case migrate StageSelector + WorkflowsList + EditWorkflowDialog confirmations together). Worth evaluating before launch — native confirms feel cheap on a paid product.

**Cross-references:** components/projects/StageSelector.tsx, DEBT-016

---

## ADR-023 — Manual QA hard-refresh required as Step 0
**Date:** 07 May 2026 (Session 8 lesson)
**Codebase:** SaaS
**Status:** Accepted

**Context:** During Session 8 Phase F manual testing, an apparent backward-transition bug turned out to be stale browser state. The deploy had succeeded on Vercel, but the user's browser cached the older JavaScript bundle that didn't have the StageSelector dropdown wired up correctly. ~10 minutes of debugging time was spent on a non-bug.

**Decision:** All future Phase F runbooks include "hard refresh (Cmd+Shift+R / Ctrl+Shift+R) the page before each manual test" as Step 0. Documented in POST-SESSION-CHECKLIST.md Phase F section.

**Alternatives rejected:**
- Service worker for cache invalidation on deploy — overkill for current scale; Next.js + Vercel handle this for fresh sessions, only stale browser tabs are affected.
- Auto-refresh on Vercel deploy webhook — adds infrastructure and would surprise users mid-task.

**Reconsider if:** We adopt a service worker for offline support, or move to a deploy strategy with different cache-invalidation behavior.

**Cross-references:** SESSION-8-HANDOVER.md Phase F, POST-SESSION-CHECKLIST.md

---

## ADR-022 — Backward stage transitions allowed with confirmation, never blocked
**Date:** 07 May 2026 (Session 8)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Real-world projects regress. A surveyor moves a project to "Drawings In Progress" then realizes they need more survey data — the project should go back to "Survey Scheduled." Blocking backward transitions punishes legitimate use; allowing them silently invites accidents.

**Decision:** Backward transitions are allowed but trigger a `window.confirm()` dialog with explicit text. Audit log captures `is_backward_transition: true` for traceability. UI doesn't otherwise distinguish backward from forward.

**Alternatives rejected:**
- Block backward transitions; require admin override — friction for legitimate use cases. Surveyor admins are the team; "admin approval" doesn't add safety.
- Allow silently with no confirmation — too easy to misclick the dropdown.
- Stage-specific transition rules (state machine) — over-engineering for a 5-10 stage workflow.

**Reconsider if:** We see a pattern of accidental backward transitions in audit logs (>5% of transitions backward), or customers ask for a "lock terminal stages" feature.

**Cross-references:** ARCHITECTURE-saas.md §13, actions/projects.ts moveProjectToStage, ADR-024

---

## ADR-021 — Workflow CRUD shipped at MVP scope (no drag-reorder, no per-project reassignment)
**Date:** 07 May 2026 (Session 8)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Custom workflows are foundational for the architect lifecycle (Phase 4) and table-stakes for prospect demos. But full UX (drag-to-reorder stages, per-project workflow reassignment, terminal-stage management UI, color picker) would have inflated Session 8 scope significantly.

**Decision:** Ship MVP custom workflow CRUD: create/update/delete workflow, add/remove stages, system templates remain read-only. No drag-reorder — stages added in order. No per-project workflow reassignment — projects keep their assigned workflow for life. No color picker — colors are hardcoded in the seed.

**Alternatives rejected:**
- Full UX in Session 8 — would have stretched session to 10+ hours and risked Phase 1b not closing.
- Skip custom workflows entirely until Phase 4 — leaves orgs unable to differentiate, hurts demo value.

**Reconsider if:** Customers ask for stage reordering (likely common ask), workflow templates marketplace (Phase 4+), or per-project workflow swaps (rare but could matter for project takeovers).

**Cross-references:** SESSION-8-HANDOVER.md, ARCHITECTURE-saas.md §32 row 4

---

## ADR-020 — Stage transition audit log destination: audit_logs, not project_activity
**Date:** 07 May 2026 (Session 8)
**Codebase:** SaaS
**Status:** Accepted (revisit Session 9-10)

**Context:** ARCHITECTURE-saas.md §12.7 references a `project_activity` table for stage-change events. That table is Phase 1c (doesn't exist yet). Stage transitions need somewhere to log NOW for Phase 1b.

**Decision:** Phase 1b stage transitions log to `audit_logs` with `action='stage_changed'` and full forward-compatible metadata schema (see ADR-019). When `project_activity` ships in Phase 1c (Sessions 9-11), historical rows backfill from `audit_logs` and notification dispatch reads from `project_activity`.

**Alternatives rejected:**
- Build `project_activity` early in Session 8 — scope creep; risks Session 8 not closing.
- Skip logging until Phase 1c — loses observability during Phase 1b dogfood; can't audit transitions.
- New table specifically for stage events — duplicates audit_logs concerns; unclean schema.

**Reconsider if:** Phase 1c reveals that `audit_logs` query patterns conflict with `project_activity` query patterns (unlikely — project_activity is user-facing, audit_logs is admin/audit).

**Cross-references:** ARCHITECTURE-saas.md §12.7, lib/audit/log.ts, ADR-019

---

## ADR-019 — Stage transition audit metadata schema locked at 9 fields
**Date:** 07 May 2026 (Session 8)
**Codebase:** SaaS
**Status:** Accepted — schema-locked

**Context:** Phase 1c notification dispatch will consume audit metadata for `stage_changed` events to decide whether to notify stakeholders, what to include in the notification, and whether the transition is informational or action-worthy. The metadata shape needs to be forward-compatible — adding fields later requires migrating historical rows.

**Decision:** Every `stage_changed` audit row carries exactly these 9 fields in `metadata`:
1. `from_stage_id` (uuid)
2. `from_stage_name` (text)
3. `from_stage_position` (int)
4. `to_stage_id` (uuid)
5. `to_stage_name` (text)
6. `to_stage_position` (int)
7. `workflow_id` (uuid)
8. `is_backward_transition` (bool)
9. `is_terminal_destination` (bool)

Hard Rule 8 in Session 8 plan codifies this. Tests in `tests/actions/projects-stage-transition.test.ts` assert all 9 fields.

**Alternatives rejected:**
- Minimal schema (just from/to stage IDs) — would force notification dispatch to do extra DB lookups, slowing fan-out.
- Maximal schema (everything we might ever need) — bloats every audit row; unclear what to add.
- Defer schema lock to Phase 1c — historical rows from Phase 1b would need migration, risking data loss.

**Reconsider if:** Phase 1c notification dispatch genuinely needs context not derivable from these 9 fields. Adding fields requires writing a migration that backfills historical rows from `workflow_stages` joins.

**Cross-references:** actions/projects.ts moveProjectToStage, SESSION-8-HANDOVER.md

---

## ADR-018 — Repo flipped public to enable branch protection enforcement
**Date:** 06 May 2026 (Session 7)
**Codebase:** SaaS
**Status:** Accepted — temporary

**Context:** GitHub Free tier doesn't enforce branch rulesets on private repos. Without enforcement, the RLS Gate workflow runs but PRs can still merge red. Defeats the purpose of having a CI gate.

**Decision:** Flip repo from private to public. Branch ruleset enforces on public repos under Free tier. Three-pass secrets audit confirmed clean before flip (no secrets in git history, no `.env*` files except `.env.example`, no long base64 JWTs).

**Alternatives rejected:**
- Keep private, accept that the gate is advisory not enforcing — defeats the whole Session 7 hardening exercise.
- Upgrade to GitHub Team (~$4/user/mo) immediately — premature spend before launch.
- Move to GitLab/Bitbucket — disruption for an unrelated platform change.

**Reconsider if:** Pre-launch, revert to private + upgrade to GitHub Team. This becomes mandatory before any commercial customer onboards (proprietary IP shouldn't be public).

**Cross-references:** SESSION-7-HANDOVER.md, .github/workflows/rls-gate.yml, DEBT-006

---

## ADR-017 — RLS Gate as required branch protection check
**Date:** 06 May 2026 (Session 7)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Without enforced CI, RLS regressions could ship to main silently. A subtle policy bug (forgotten `deleted_at` filter, accidental `=` instead of `IN`) would expose cross-tenant data and violate the entire RLS-as-merge-gate promise from ADR-011.

**Decision:** GitHub branch protection requires the "rls + actions + cloud-smoke" check pass before any PR can merge to main. Workflow at `.github/workflows/rls-gate.yml` runs `npm ci → supabase start → generate .env.local → db:seed:local → test:rls → test:actions → test:cloud-smoke`. All three suites must be green for merge.

**Alternatives rejected:**
- Optional check (advisory only) — humans skip advisory checks at session-end fatigue.
- Pre-commit hook only — runs on dev machines, can be bypassed with `--no-verify`.
- Separate workflow per test suite — three pending checks instead of one; more chances for partial green.

**Reconsider if:** The RLS Gate becomes a bottleneck (e.g., flaky cloud-smoke tests blocking merges) — solution would be quarantine flaky tests, not weaken the gate.

**Cross-references:** SESSION-7-HANDOVER.md, ADR-011, ADR-018

---

## ADR-016 — Per-command RLS policies, never FOR ALL
**Date:** 05 May 2026 (Session 6 lesson, hardened in Session 7 as Hard Rule 23)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Postgres RLS policies can use `FOR ALL` to apply to all DML. Discovered during Session 6 that `FOR ALL` policies can break soft-delete filtering — the policy applies on UPDATE so the soft-delete write succeeds, but the resulting row state confuses subsequent SELECT-based filtering. Subtle bugs that aren't caught by basic isolation tests.

**Decision:** All RLS policies use per-command shape: separate policies for `FOR SELECT`, `FOR INSERT`, `FOR UPDATE`, `FOR DELETE`. Documented in SKILL.md as Hard Rule 23. Migration 0010 (`project_stakeholders`) and onwards all follow this. Earlier migrations were hardened in Session 7.

**Alternatives rejected:**
- `FOR ALL` policies — concise but break soft-delete; the conciseness isn't worth the bug surface.
- Custom triggers for each operation — more code, more places to forget, harder to audit.

**Reconsider if:** Postgres adds policy-composition primitives that make `FOR ALL` safe with soft-delete (no current proposals).

**Cross-references:** SKILL.md Hard Rule 23, db/migrations/0010_project_stakeholders.sql

---

## ADR-015 — Cascade-cancel pending invitations on stakeholder removal (Design C)
**Date:** 06 May 2026 (Session 7 hotfix)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Removing a stakeholder while they had a pending invitation left the invitation orphaned — the magic link still worked but the stakeholder relationship was already gone. User received "you're invited to a project that doesn't include you" experience.

**Decision:** `removeStakeholder` server action cascades to cancel pending invitations (sets `deleted_at` on the matching invitation row). Accepted invitations are preserved — once a stakeholder has used their magic link, removing them just revokes their access without affecting their `clients` row history. This is "Design C" from three options considered.

**Alternatives rejected:**
- Design A: cascade-delete invitations entirely (including accepted) — destroys audit trail.
- Design B: do nothing on remove (leave invitation orphaned) — confusing UX.

**Reconsider if:** Customers want a "re-invite removed stakeholder" feature that needs to revive cancelled invitations.

**Cross-references:** Session 7 commit 1 (PR #1, squashed in `e60ca15`), actions/stakeholders.ts removeStakeholder

---

## ADR-014 — Multi-org context via cookie, re-derived per request
**Date:** 04 May 2026 (Session 5)
**Codebase:** SaaS
**Status:** Accepted

**Context:** A single `auth.users` identity can be a team member of multiple orgs (Sarah owns her firm and is also a member of a partner firm). Need to track which org the user is currently acting as.

**Decision:** Store `active_org_id` in an HttpOnly cookie. On every server action, re-derive `orgId` from the session and validate against `users` table — never trust the cookie value blindly. If the cookie is stale or membership was revoked, fall back to the user's first active membership.

**Alternatives rejected:**
- URL-based org slug (`/[orgSlug]/...`) as the only signal — works for navigation but server actions still need to validate membership; URL is for UX.
- Database-backed "current org" column on users — adds write churn on every switch and creates a single mutable source of truth that desyncs from URL state.
- Subdomain per org (`orga.pcd.app`) — heavy for the value; complicates auth, deployment, certs.

**Reconsider if:** We add SSO with org-level identity providers (Phase 4+ enterprise) — at that point each org's session may need separate auth context, not just a cookie switch.

**Cross-references:** SESSION-5-HANDOVER.md, lib/auth/requireOrgUser.ts, actions/orgs.ts switchActiveOrg

---

## ADR-013 — Reuse `deleted_at` for cancelled invitations
**Date:** 04 May 2026 (Session 5)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Invitations can be cancelled by an admin before acceptance. Needed a way to mark them as no longer valid without deleting the row (audit trail, debugging, "why did Sarah's link fail" investigations).

**Decision:** Reuse the existing `deleted_at` column. A cancelled invitation is a soft-deleted invitation. Acceptance route checks `deleted_at IS NULL` alongside expiration check.

**Alternatives rejected:**
- New `cancelled_at` column — adds schema surface for no semantic gain. "Cancelled" and "soft-deleted" are the same thing operationally: the row exists, it can't be used, it's not visible by default.
- Hard-delete on cancel — loses the audit trail and breaks any in-flight magic links silently rather than with a clear error.

**Reconsider if:** We ever need to distinguish "admin cancelled" from "user revoked" from "system expired" beyond what `audit_logs.metadata.reason` already captures.

**Cross-references:** SESSION-5-HANDOVER.md, actions/invitations.ts cancelInvitation

---

## ADR-012 — RLS test suite as CI merge gate
**Date:** 04 May 2026 (Phase 1a Session 4)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Multi-tenant SaaS where a single RLS bug = cross-tenant data leak = GDPR breach = end of company. Application-level isolation is not enough; we need database-enforced isolation, and we need to prove it holds on every change.

**Decision:** Every new table requires RLS tests covering cross-org SELECT/INSERT/UPDATE/DELETE denial plus soft-delete invisibility, written using a two-user-two-org fixture. Tests run in CI; PRs failing the suite cannot merge.

**Alternatives rejected:**
- Manual review only — humans miss subtle policy bugs, especially when policies use joins or subqueries.
- Application-layer tenant scoping (e.g., always WHERE org_id = ?) — one missing clause anywhere = breach. RLS is defense in depth that works even if app code has bugs.
- Sample-based testing (run RLS tests once a week) — defeats the "CI catches every change" purpose.

**Reconsider if:** Postgres adds first-class testing primitives that supersede our two-user-two-org fixture pattern.

**Cross-references:** ARCHITECTURE-saas.md §25, .github/workflows/rls-gate.yml, ADR-017

---

## ADR-011 — Stakeholders are a separate primitive from team users
**Date:** 03 May 2026 (Phase 1a planning)
**Codebase:** SaaS
**Status:** Accepted

**Context:** A homeowner client of an architect firm is fundamentally not the same kind of entity as a team member of that firm. Different access patterns, different permissions, different lifecycle. Conflating them in a single `users` table would force every query to filter `WHERE user_type = ?` and every RLS policy to handle two cases.

**Decision:** Two tables: `users` (org team members) and `clients` (stakeholders). Both reference `auth.users` (one auth identity per email per ADR-010). A single person can be both a team member of their firm AND a stakeholder on a partner firm's project — both relationships are first-class and tracked separately.

**Alternatives rejected:**
- Single `users` table with `user_type` enum — every query needs filtering; RLS becomes complex; permissions logic has lots of conditional branches.
- Stakeholders are organizations themselves (each homeowner is an "org of one") — overweight; doesn't match how surveyors think about clients.

**Reconsider if:** We add a "team user as stakeholder" pattern at scale — currently handled by allowing the same person to have rows in both tables, which is correct.

**Cross-references:** ARCHITECTURE-saas.md §7, db/schema/clients.ts, db/schema/users.ts

---

## ADR-010 — One auth identity per email
**Date:** 03 May 2026 (Phase 1a planning)
**Codebase:** SaaS
**Status:** Accepted

**Context:** A person could be a team member of their own firm, a stakeholder on three other firms' projects, and an admin of a fourth org. With separate auth identities per role, they'd have to log in with different emails for each context — terrible UX.

**Decision:** Each email address resolves to exactly one `auth.users` row. Roles and memberships are separate from identity. Login → resolve session → look up team memberships (`users` table) and stakeholder memberships (`clients` table) → present the appropriate UI based on context.

**Alternatives rejected:**
- One auth per role — UX nightmare; users would log out/log in to switch contexts.
- Magic-link per project — unbounded URL count, no profile management.

**Reconsider if:** Enterprise customers demand email aliasing or separate work/personal contexts (uncommon in surveyor/architect industries).

**Cross-references:** ARCHITECTURE-saas.md §6, ADR-011

---

## ADR-009 — UUIDv7 with app-side generation
**Date:** 03 May 2026 (Phase 1a Session 1)
**Codebase:** SaaS
**Status:** Accepted

**Context:** SaaS schema needs primary keys. UUIDv4 is opaque (no time ordering); auto-incrementing integers leak business data (you can count tenants by max(id)).

**Decision:** UUIDv7 — time-ordered UUIDs. Generated app-side via the `uuid` npm package. App generates the IDs at insert time; DB doesn't generate them.

**Alternatives rejected:**
- UUIDv4 — random, no ordering, queries by time range scan whole table.
- BIGINT auto-increment — leaks counts; not suitable for distributed systems later.
- DB-side generation via `pg_uuidv7` extension — was considered; app-side wins because it doesn't depend on a Postgres extension being available, and it's portable across DB providers.

**Reconsider if:** App-side generation becomes a bottleneck (essentially never at our scale), or we move to a managed DB that requires DB-side IDs.

**Cross-references:** ARCHITECTURE-saas.md §3, every db/schema/*.ts

---

## ADR-008 — Text + CHECK constraints over Postgres enums
**Date:** 03 May 2026 (Phase 1a planning)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Postgres native enums require migration locks to alter (adding values requires recreating the type, locking the table). Stage names, statuses, role values all need to evolve over time as the product matures.

**Decision:** Use `text` columns with `CHECK (value IN (...))` constraints instead of native enums. Updating values is a simple constraint change, no table lock.

**Alternatives rejected:**
- Native Postgres enums — strict but inflexible; every value addition is a migration with downtime risk.
- JSON Schema validation in app code — no DB-level guarantees; one missing validator and bad data lands in DB.
- Lookup table with FK — works but overkill for small finite sets like roles or stages.

**Reconsider if:** Query planner needs strict typing (haven't seen this), or we add 50+ enum values that bloat the CHECK clause unreasonably.

**Cross-references:** ARCHITECTURE-saas.md §4, all db/schema files using CHECK

---

## ADR-007 — Schema-forever after Phase 1c
**Date:** 03 May 2026 (Phase 1a planning)
**Codebase:** SaaS
**Status:** Accepted — schema-locked

**Context:** Multi-tenant SaaS schema needs to be stable so customers can rely on data shape. Frequent schema changes mid-flight risk data loss, downtime, and migration debt.

**Decision:** Schema can be reshaped freely through Phases 1a, 1b, 1c (sessions 1-11). After Phase 1c ships, schema is locked: only additive migrations (new columns, new tables) are allowed. Renames, drops, and breaking changes require a major version bump and customer communication.

**Alternatives rejected:**
- Lock immediately at Phase 1a end — Phase 1b might reveal modeling flaws we can't fix.
- Permanent flexibility — every customer pays for our indecision in their data integrity.

**Reconsider if:** A modeling flaw is discovered post-Phase 1c that genuinely cannot be fixed additively (rare; usually possible with some creativity).

**Cross-references:** SaaS Hard Rule 1, ARCHITECTURE-saas.md §3

---

## ADR-006 — RLS enforces tenancy; feature flags enforce billing
**Date:** 03 May 2026 (Phase 1a planning)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Two distinct concerns: cross-tenant data isolation (security) and per-plan feature gating (commercial). Mixing them creates RLS policies that are hard to audit and feature flags that are hard to test.

**Decision:** RLS policies enforce ONLY tenancy boundaries — "can user X see this row at all?" Feature flags (TBD: probably PostHog or LaunchDarkly) enforce billing tier — "does user X's org have access to this feature?" The two never overlap.

**Alternatives rejected:**
- RLS policies that include feature checks — couples concerns; one billing change requires updating all RLS policies.
- Feature flags that include tenancy checks — leaks tenant data through feature flag evaluation.

**Reconsider if:** A feature is so plan-specific that RLS would be cleaner (doubt it).

**Cross-references:** ARCHITECTURE-saas.md §27 (TBD pre-launch)

---

## ADR-005 — Drizzle ORM with kill-switch
**Date:** 03 May 2026 (Phase 1a Session 1)
**Codebase:** SaaS
**Status:** Accepted

**Context:** Type-safe database access for TypeScript. Multiple options (Drizzle, Prisma, raw SQL). Drizzle won for proximity-to-SQL and lightweight runtime. But ORMs accumulate cruft over time; we need an exit plan.

**Decision:** Use Drizzle. If it ever becomes a bottleneck or constraint, the kill-switch is: replace `db.select().from(table)` with raw `sql\`SELECT * FROM table\`` and lose the type checking but keep everything else. No cascading rewrite.

**Alternatives rejected:**
- Prisma — heavier runtime; client generation step adds friction; less SQL-native.
- Raw SQL with manual types — fast but every query needs typed return types written manually; error-prone.
- Kysely — also good, slightly less mature ecosystem than Drizzle as of decision date.

**Reconsider if:** Drizzle development stalls (current state: very active), or we hit a query pattern Drizzle can't express cleanly.

**Cross-references:** package.json drizzle-orm, db/schema/

---

## ADR-004 — Stack: Next.js + Supabase + Resend + Upstash + Sentry + Stripe + Vercel
**Date:** 03 May 2026 (Phase 1a Session 1)
**Codebase:** SaaS
**Status:** Accepted

**Context:** SaaS needs hosting, auth, DB, email, rate-limiting, error tracking, billing. Many viable combinations. Choices interact (e.g., Vercel + Next.js + Edge runtime = certain constraints).

**Decision:**
- **Hosting:** Vercel (Next.js native, generous free tier, edge-first)
- **DB + Auth:** Supabase (Postgres + RLS + auth, eliminates auth-as-separate-service)
- **Email:** Resend (clean API, good deliverability)
- **Rate limiting:** Upstash Redis (serverless-friendly, generous free tier)
- **Error tracking:** Sentry (industry standard)
- **Billing:** Stripe (UK VAT support, marketplace handles complex VAT scenarios)

**Alternatives rejected:**
- AWS-native (Cognito + RDS + SES + ElastiCache + ...) — months of YAML for a solo founder.
- Firebase — auth + DB great, but RLS-equivalent (Security Rules) is less expressive than Postgres RLS.
- Self-host PostgreSQL — premature ops burden.

**Reconsider if:** Vercel pricing becomes punitive at scale (typically Pro tier is fine to ~$20K MRR), or Supabase has reliability issues at our growth stage.

**Cross-references:** ARCHITECTURE-saas.md §2

---

## ADR-003 — Strangler-fig migration: Apps Script V2 stays running
**Date:** 03 May 2026 (Phase 1a planning)
**Codebase:** Both
**Status:** Accepted

**Context:** Apps Script v65 (V2) is the live in-house portal — handling real surveyor work right now. Building the SaaS doesn't mean the V2 stops. They coexist for an extended period while SaaS matures.

**Decision:** Apps Script V2 remains in production indefinitely. SaaS is built fresh in parallel. No incremental migration of Apps Script logic to SaaS — they're separate products, separate codebases, separate purposes (V2 = in-house tool, SaaS = sellable product). Apps Script is decommissioned only when Hasnath's own firm migrates to the SaaS, which has no scheduled date.

**Alternatives rejected:**
- Strangle Apps Script gradually (move endpoints one at a time) — Apps Script architecture (Sheets-backed, single-tenant) doesn't translate cleanly to multi-tenant SaaS. Forcing translation creates Frankenstein code.
- Stop Apps Script work entirely, focus only on SaaS — leaves Hasnath's firm unable to function during the multi-month build.

**Reconsider if:** Apps Script reaches a hard ceiling (PropertiesService 500KB limit per DEBT-001) or Hasnath's firm migrates to SaaS earlier than expected.

**Cross-references:** ARCHITECTURE.md §15 (Apps Script V2 hard rules), ARCHITECTURE-saas.md §1

---

## ADR-002 — Apps Script V1 and V2 share Sheets ID
**Date:** Long-standing (predates SaaS work; codified here)
**Codebase:** Apps Script
**Status:** Accepted — historical

**Context:** V1 was the original portal. V2 is the redesigned current portal. Both store project data in the same Google Sheet. Splitting the Sheet would have meant migrating live data twice (V1→V2→SaaS).

**Decision:** V1 and V2 use the same `SHEETS_ID`. Column changes to V2 must be backward-compatible with V1 (which is read-only/legacy at this point but still wired up).

**Alternatives rejected:**
- Migrate V2 to a new Sheet — breaks V1 silently; data loss risk.
- Decommission V1 fully, then migrate Sheet — V1 is the disaster-recovery fallback if V2 has bugs.

**Reconsider if:** V1 is fully decommissioned (no scheduled date) — at that point Sheet ownership simplifies.

**Cross-references:** ARCHITECTURE.md §15

---

## ADR-001 — Token validation: missing tokens always allowed
**Date:** Long-standing (Apps Script v55-v57; codified here)
**Codebase:** Apps Script (and inherited pattern for SaaS)
**Status:** Accepted — historical, do-not-modify

**Context:** Apps Script V2 introduced token-gated public document URLs in v55. Existing emails sent before v55 had no token in the URL. Rejecting tokenless URLs would break every old email link silently.

**Decision:** `validateDocToken()` accepts URLs with no token (returns valid). Only rejects when a token is present but doesn't match the stored token (tampering signal).

**Alternatives rejected:**
- Reject tokenless URLs after a cutoff date — silently breaks email links from before the cutoff.
- Backfill tokens into all old project records — added complexity, doesn't help old emails sitting in inboxes.

**Reconsider if:** Never. This rule is part of the permanent security model per ARCHITECTURE.md §15 Rule 7. Hard rule.

**Cross-references:** ARCHITECTURE.md §8, ARCHITECTURE.md Hard Rule 7

---

## ADR-000 — Pre-existing decisions index (Sessions 1-7)

Decisions made before this DECISIONS.md file existed are documented in their original locations. This index points at where they live for archaeological purposes.

| Topic | Source |
|---|---|
| Apps Script V2 hard rules (§15 Rule 1-10) | `ARCHITECTURE.md` Apps Script |
| SaaS hard rules (§3 Rules 1-15) | `ARCHITECTURE-saas.md` |
| Naming and type conventions | `ARCHITECTURE-saas.md` §4 |
| Stack choices (detailed rationale) | `ARCHITECTURE-saas.md` §2 |
| Auth model | `ARCHITECTURE-saas.md` §6, §7 |
| Multi-tenancy & RLS conventions | `ARCHITECTURE-saas.md` §8 |
| Phase 1a session decisions | `SESSION-1`..`SESSION-4-HANDOVER.md` |
| Phase 1b session decisions | `SESSION-5`..`SESSION-8-HANDOVER.md` |
| Open questions / deferred decisions | `ARCHITECTURE-saas.md` §32 |
| Session carryovers | `ARCHITECTURE-saas.md` §35.6, §35.7, §35.8 |

When backfilling individual ADRs from these sources is genuinely needed (e.g., for due diligence or onboarding a contributor), they get formal entries above ADR-001.
