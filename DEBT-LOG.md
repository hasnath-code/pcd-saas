# Technical Debt Log

**Purpose:** Every TODO, every workaround, every "fix this later" lives here. One file. Forces visibility. Right now this stuff is scattered across code comments, ARCHITECTURE-saas.md §32, your head, and chat history. Centralizing it means nothing falls through the cracks and you always know what you're carrying.

**Scope:** Both codebases (Apps Script + SaaS).

**House rule:** Nothing ships without an entry if it leaves debt behind. No exceptions. The cost of writing the entry (90 seconds) is always smaller than the cost of forgetting (compounding interest).

---

## How to add an entry

```
## DEBT-NNN — <short title>
**Added:** DD MMM YYYY by <session/source>
**Codebase:** Apps Script | SaaS | Both
**Severity:** Critical | High | Medium | Low
**Type:** Bug | Workaround | Deferred decision | Missing test | Performance | Security | Documentation | Operational
**Status:** Open | In progress | Resolved (date)

**The debt:** What is owed. One sentence.

**Why it exists:** What forced this. Time pressure, missing dependency, deferred for a reason, etc.

**Cost of leaving it:** What goes wrong if we ignore this for six months.

**Fix sketch:** Rough plan for how to resolve. One paragraph.

**Trigger:** What event makes this urgent enough to actually do.
```

---

## Severity definitions

- **Critical** — Active bug, security risk, or blocker. Fix before next session ends.
- **High** — Will hurt within 1–3 months. Schedule a session.
- **Medium** — Will hurt within 6–12 months or at scale. Track; revisit quarterly.
- **Low** — Cosmetic, optimization, nice-to-have. Fix when convenient or when adjacent work makes it cheap.

---

## Status definitions

- **Open** — Not started.
- **In progress** — Actively being worked on. Add session reference.
- **Resolved** — Done. Keep the entry; mark with resolution date and the commit/session that fixed it. History is value.

---

# Open Debt

## DEBT-023 — Test fixtures creating users must use service.auth.admin.createUser
**Added:** 09 May 2026 (Session 9)
**Codebase:** SaaS
**Severity:** Low
**Type:** Documentation / Missing test (test infrastructure)
**Status:** Open

**The debt:** `public.users.auth_user_id` has a FK to `auth.users`. Test fixtures that insert `users` rows directly with a fake `uuidv7()` either fail the FK constraint or silently no-op (depending on PostgREST error handling), producing confusing test failures downstream — typically a server action returning `cross_org_user` because the fixture user was never actually created.

**Why it exists:** The pattern is documented inline in `tests/fixtures/two-orgs.ts:79+` but not surfaced in test-writing conventions or a shared helper. Session 9's `addConversationParticipant` fixture initially used fake UUIDs and hit the bug — ~25 minutes of debugging before tracing it back.

**Cost of leaving it:** Sessions 10–12 may repeat the pattern. Each instance costs ~15–30 minutes of debugging. Easy to step on because the fix isn't obvious from the failure mode (silent no-op or downstream auth check failure, not a clear FK error).

**Fix sketch:** Add a tiny helper `tests/helpers/create-test-user.ts` that wraps `service.auth.admin.createUser` + `public.users` insert in a single call. Document at the top of `tests/fixtures/two-orgs.ts` (or in `tests/README.md` if/when one exists). Probably 30 lines including types.

**Trigger:** Next session that needs to add a new test user (likely Session 10 or 11).

**Cross-references:** `tests/fixtures/two-orgs.ts:79+`, `tests/actions/conversations.test.ts` (addConversationParticipant fixture)

---

## DEBT-022 — Conversations: new org members not auto-joined to existing one_to_one threads
**Added:** 09 May 2026 (Session 9)
**Codebase:** SaaS
**Severity:** Low
**Type:** Workaround
**Status:** Open

**The debt:** Decision 9.1A says one-to-one conversations include "stakeholder + ALL active org members" at creation time. New org members joining the org AFTER the one_to_one was created are NOT auto-added — they have to be manually added via `addConversationParticipant`.

**Why it exists:** Auto-joining all existing one-to-ones on new-user-creation requires either a tx hook in `inviteUser`/`acceptInvitation` (cross-cutting) or a periodic sweep job. Either is a chunk of work; deferred from Session 9 to keep scope tight.

**Cost of leaving it:** New team members miss historical conversations until an admin manually adds them. Confusing UX ("why can't Sarah see this thread?"). Annoying at small org scale, painful at large org scale.

**Fix sketch:** Add an `autoJoinOneToOneConversationsTx(tx, { userId, orgId })` helper called inside the `users` insert path (`actions/orgs.ts createOrganization`, `actions/team.ts acceptTeamInvitation` if it exists, `actions/users.ts` invite-accept paths). Looks up all one_to_one conversations in the org and inserts a participant row for the new user. Idempotent via UNIQUE constraint.

**Trigger:** When customer or QA flags it, or as part of the Phase 4+ team-management UX polish session.

**Cross-references:** Decision 9.1A, actions/conversations.ts autoCreateOneToOneConversationTx

---

## DEBT-021 — Message rate limiting deferred
**Added:** 09 May 2026 (Session 9)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Deferred decision / Operational
**Status:** Open

**The debt:** Decision 9.5B explicitly deferred message-send rate limiting to a later session. Currently `sendMessage` has Zod length validation (1..10000) but no per-user/per-conversation limit on send frequency. A scripted attack could flood a conversation with thousands of messages per minute.

**Why it exists:** Rate limiting needs the Upstash Redis layer wired through `actions/messages.ts` and a thoughtful policy (per-user globally, per-user-per-conversation, with bursts). Out of Session 9's scope.

**Cost of leaving it:** Pre-launch — none (no real users). At launch — abuse vector. A single malicious participant could DoS a conversation, send notifications fan-out (Session 11+), and consume Resend quota.

**Fix sketch:** Wrap `sendMessage` (and probably `editMessage`) in `rateLimit('send_message', ${userId}:${conversationId})` using the existing pattern from `actions/auth.ts` rate-limited paths. Limits: ~30 sends per minute per user globally, ~10 per minute per (user, conversation). Tune from real traffic post-launch.

**Trigger:** Pre-launch operational pass (alongside DEBT-006 items).

**Cross-references:** Decision 9.5B, lib/ratelimit.ts

---

## DEBT-020 — System message sources beyond participant changes deferred to Session 11
**Added:** 09 May 2026 (Session 9 / S4b sub-decision)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision
**Status:** Open

**The debt:** ADR-027 ships system messages for participant add/remove only. Stage transitions, file uploads, and milestone events are conversation-relevant but won't surface in a thread until Session 11 (`project_activity` table). Until then, the in-thread audit trail only tells half the story.

**Why it exists:** The single-source-of-truth choice (S4b: `project_activity` is canonical for non-message events) requires the table to exist. Building it is Session 11's job.

**Cost of leaving it:** Phase F runbooks may show stage transitions happening on the project page but no system message in the conversation. UX gap, not a security/data problem.

**Fix sketch:** Session 11: ship `project_activity` per spec §12.7. Then either (a) project-detail UI overlays activity events alongside conversation messages chronologically, or (b) `messages` gets a derived `system` row populated by a trigger watching project_activity. Decision rests with Session 11's plan.

**Trigger:** Session 11 kickoff (Phase 1c notifications + activity timeline).

**Cross-references:** ADR-027, ARCHITECTURE-saas.md §12.7

---

## DEBT-019 — Drizzle journal/snapshots not updated for migrations 0014-0017
**Added:** 09 May 2026 (Session 9 follow-on of §35.6 entry 11)
**Codebase:** SaaS
**Severity:** Low
**Type:** Operational / Tooling
**Status:** Open

**The debt:** Migrations 0014-0017 (conversations + participants + messages + helper unstub) are hand-written. `db/migrations/meta/_journal.json` only has entries through idx 11 (0011); 0012/0013 already weren't journaled (per §35.6 entry 11). Session 9 inherits the same gap.

**Why it exists:** Hand-written migrations don't auto-update the drizzle-kit journal. Session 6 carryover already documented this. Adding journal entries by hand is fiddly and the journal isn't read by the actual migration runner (Supabase CLI applies files in numerical order).

**Cost of leaving it:** Next time someone runs `npx drizzle-kit generate` after schema edits, drizzle-kit may regenerate "missing" migrations because its snapshot doesn't reflect the hand-written schema. Workaround already known from S6: trim regenerated SQL to only new statements.

**Fix sketch:** One-shot tooling improvement session. Either (a) regenerate the entire snapshot graph from the current schema and add stub journal entries pointing at hand-written tags, or (b) write a small `scripts/post-migrate.mjs` that reconciles journal/snapshot when a hand-written migration lands. Low priority — current workflow works.

**Trigger:** When the journal drift causes a real friction event (e.g. a regen wipes out hand-written work). Until then, the workaround in §35.6 entry 11 is sufficient.

**Cross-references:** ARCHITECTURE-saas.md §35.6 entry 11, db/migrations/meta/_journal.json

---

## DEBT-018 — Vercel deployment recommendations
**Added:** 07 May 2026 (Session 8 Phase F)
**Codebase:** SaaS
**Severity:** Low
**Type:** Operational
**Status:** Open

**The debt:** Vercel dashboard flags "Node.js Version Override" warning + 4 deployment recommendations on the pcd-saas project.

**Why it exists:** Initial Vercel project setup used defaults; recommendations have accumulated as Vercel evolves its baseline.

**Cost of leaving it:** None functional today (deploy is healthy and serving). Could matter at scale or if Node EOL kicks in for the pinned version.

**Fix sketch:** One pre-launch operational pass. Read each recommendation in Vercel dashboard, accept or dismiss with reasoning. ~30 minutes of careful clicking.

**Trigger:** Pre-launch operational pass, alongside DEBT-006, DEBT-007, DEBT-008.

---

## DEBT-017 — Phase F runbook needs N/A discipline (no PASS-with-caveat)
**Added:** 07 May 2026 (Session 8 Phase F lesson)
**Codebase:** SaaS (process)
**Severity:** Low
**Type:** Documentation
**Status:** Open

**The debt:** Session 8's Phase F initially marked Step 6 "PASS (with caveat)" when browser-Claude couldn't visually verify the native confirm dialog. Real outcome was N/A (couldn't be tested in that context). Caveat-PASS framing risks shipping unverified behavior into the "verified" bucket.

**Why it exists:** Browser-Claude reported the result with mitigating language; user accepted at face value. POST-SESSION-CHECKLIST.md doesn't yet codify the strict N/A vs PASS distinction.

**Cost of leaving it:** Future Phase F's might mark steps PASS that weren't actually verified, accumulating untested-but-claimed-tested debt.

**Fix sketch:** Update POST-SESSION-CHECKLIST.md Phase F section to include explicit guidance: "Any step involving a native browser modal, file download, OAuth redirect, or other off-page-context interaction that browser-Claude cannot verify must be marked N/A and human-verified separately. No 'PASS with caveat' allowed — it's PASS, FAIL, or N/A."

**Trigger:** Bake into POST-SESSION-CHECKLIST.md during framework installation (this session).

---

## DEBT-016 — Browser-Claude cannot verify native dialogs
**Added:** 07 May 2026 (Session 8 Phase F discovery)
**Codebase:** SaaS (operational)
**Severity:** Low
**Type:** Workaround
**Status:** Resolved 09 May 2026 (Session 9, commit 003f3a7) — see ADR-025

**The debt:** Browser-Claude automation cannot see or interact with native browser dialogs (`window.confirm`, `window.alert`, `window.prompt`). Affects automated Phase F testing of any flow with confirmations.

**Why it exists:** Headless automation contexts auto-dismiss native modals; this is an inherent limitation of the automation layer, not a fixable bug.

**Cost of leaving it:** Manual human verification needed for any flow involving native modals. Time tax on every relevant Phase F.

**Fix sketch:** Migrate `window.confirm()` calls to shadcn `AlertDialog` component once shadcn dialogs are added to the codebase. Currently affected: `components/projects/StageSelector.tsx`, `components/workflows/WorkflowsList.tsx`, `components/workflows/EditWorkflowDialog.tsx`. After migration, browser-Claude can interact with the styled modals normally and Phase F goes back to fully-automatable.

**Trigger:** When shadcn `AlertDialog` is added to the codebase (probably Phase 1c when other shadcn components land), migrate these three call sites in one commit.

**Resolution (09 May 2026):** Session 9 added shadcn AlertDialog (components/ui/alert-dialog.tsx) + ConfirmDialog wrapper (components/ui/confirm-dialog.tsx). Migrated all three callsites in commit 003f3a7. ADR-024 superseded by ADR-025. Phase F runbooks for those flows can now be browser-verified end-to-end; native confirm guidance in POST-SESSION-CHECKLIST.md item 9 retained as a general principle for any future native modal callsite.

**Cross-references:** ADR-025 (supersedes ADR-024), components/ui/alert-dialog.tsx, components/ui/confirm-dialog.tsx

---

## DEBT-015 — RLS performance at scale not yet measured
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q14)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Performance
**Status:** Open

**The debt:** RLS helper functions (`auth_user_orgs`, `auth_user_stakeholder_orgs`, etc.) are called per-row on policy evaluation. At small scale (current state: <10 projects), performance is fine. At 100k+ projects per tenant, helper function call overhead may dominate query cost.

**Why it exists:** Premature optimization is bad; we don't know what the bottleneck will be until we have scale to measure against.

**Cost of leaving it:** Could surface as customer-visible latency at growth stage. Refactoring RLS helpers under load is harder than refactoring them at quiet times.

**Fix sketch:** Once we have 50+ paying customers, instrument helper function calls. If they're hot, options include: (a) materialized view with periodic refresh, (b) session-cached values via PostgreSQL `SET LOCAL`, (c) restructure policies to avoid helper calls in tight loops. Each option has tradeoffs around freshness.

**Trigger:** Either >$10K MRR (real customers, real load) or noticeable latency in dashboard load times.

**Cross-references:** ARCHITECTURE-saas.md §32 Q14

---

## DEBT-014 — UI tests not part of test infrastructure
**Added:** 07 May 2026 (Session 8 observation)
**Codebase:** SaaS
**Severity:** Low
**Type:** Missing test
**Status:** Open

**The debt:** No Playwright/Vitest-Browser/Cypress in the codebase. Component-level UI tests aren't writable. Phase F manual QA fills the gap.

**Why it exists:** Manual QA is sufficient at current scale; UI testing infrastructure is a session of its own to set up and maintain.

**Cost of leaving it:** Phase F manual QA scales linearly with feature count. Eventually it'll be a 4-hour walk-through; that's the trigger.

**Fix sketch:** When manual QA exceeds 90 minutes per session, install Playwright. Start with smoke tests of critical paths (auth, project CRUD, stage transitions). Don't try to test everything — manual QA still covers visual polish.

**Trigger:** Phase F runtime exceeds 90 minutes consistently, OR we ship a UI regression that visual QA missed.

---

## DEBT-013 — Apps Script PropertiesService capacity monitoring
**Added:** 06 May 2026 (drafted by previous chat session)
**Codebase:** Apps Script
**Severity:** Medium
**Type:** Performance
**Status:** Open

**The debt:** Apps Script V2 uses PropertiesService extensively (~8-12 keys per project at ~80-120 bytes each ≈ 1KB/project). Hard limit is 500KB script-wide. At ~400 active projects, usage approaches ceiling. No active monitoring of current usage.

**Why it exists:** Apps Script doesn't surface storage usage natively. Monitoring requires running a script that reads `getProperties()` and reports total size.

**Cost of leaving it:** Hit the 500KB limit silently — at that point, new key writes fail. Surveyor's invoice generation breaks mid-flow.

**Fix sketch:** Add a monthly cron in Apps Script that runs `Object.entries(getProperties()).reduce((s, [k,v]) => s + k.length + v.length, 0)`. Email alert if >400KB. ~30 lines of code; one Apps Script time-trigger.

**Trigger:** Now (this is open debt for an active production system). Schedule for next Apps Script touch.

---

## DEBT-012 — Stake script runtime parsing approach
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q11)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision
**Status:** Open

**The debt:** Project status events (e.g., "Initial Invoice Sent") come from the stage transition action. There's no formalized way for Phase 1c notification dispatch to determine notification copy/tone from the audit metadata.

**Why it exists:** Phase 1c hasn't started. Locking the format prematurely risks misalignment with what notification dispatch actually needs.

**Cost of leaving it:** Phase 1c notification dispatch will need to invent the parsing pattern from scratch instead of inheriting one.

**Fix sketch:** During Phase 1c kickoff (Session 9), document the stage_changed metadata reading pattern: which fields drive subject lines, which drive notification body, which drive opt-in/out filtering. Write a single helper function that maps a `stage_changed` audit row to a notification payload.

**Trigger:** Session 9 kickoff (Phase 1c).

---

## DEBT-011 — Audit log retention policy undecided
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q13)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Deferred decision / Compliance
**Status:** Open

**The debt:** `audit_logs` table accumulates rows forever. No retention worker. UK GDPR requires data minimization; financial-record-related events likely require 7-year retention; non-financial events could likely be retained shorter.

**Why it exists:** Premature optimization; volume is low pre-launch.

**Cost of leaving it:** Eventually `audit_logs` is the largest table in the DB and hot queries (admin dashboards) slow down. At scale, GDPR data subject rights requests become harder to fulfill.

**Fix sketch:** Pre-launch decision: classify audit events by category (financial / authentication / general operational). Set retention per category — likely 7 years for financial, 1 year for authentication, 90 days for operational. Implement as a scheduled job (Vercel Cron or Supabase pg_cron) that DELETEs rows past retention.

**Trigger:** Pre-launch (mandatory for GDPR compliance).

---

## DEBT-010 — Data export endpoint format
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q2)
**Codebase:** SaaS
**Severity:** High
**Type:** Compliance / Deferred decision
**Status:** Open

**The debt:** UK GDPR Article 20 (data portability) requires customers to export their data. No export endpoint exists.

**Why it exists:** Premature pre-customer; not relevant until first paid signup.

**Cost of leaving it:** First customer requesting their data export hits a wall. Manual SQL extraction works once but doesn't scale.

**Fix sketch:** Pre-launch session: build `/api/export` endpoint that returns a ZIP of CSV files (one per table the org has data in). Per-tenant, includes only the org's own rows. Probably 1-2 days of work.

**Trigger:** Pre-launch (compliance requirement).

---

## DEBT-009 — Stripe billing model not chosen
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q12)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Deferred decision (commercial)
**Status:** Open

**The debt:** Pricing is decided (Solo Free / Studio £22/u/mo / Practice £38/u/mo / Enterprise £55+/u/mo) but the Stripe model isn't (subscription per seat? metered usage? hybrid?).

**Why it exists:** Stripe integration is Phase 6 work; premature now.

**Cost of leaving it:** Delays commercial launch when we get there.

**Fix sketch:** Phase 6 kickoff session — pick subscription per seat (simplest, matches surveyor industry mental model). Wire Stripe Checkout for self-serve signups. UK VAT handled by Stripe Tax.

**Trigger:** Phase 6 kickoff.

---

## DEBT-008 — SMS provider not chosen
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q5)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision
**Status:** Open

**The debt:** Phase 4 paid plans include SMS notifications. Provider not chosen (Twilio? MessageBird? Vonage? Sinch?).

**Why it exists:** Phase 4 is far away; pricing varies enough that decision should be informed by actual customer demand patterns.

**Cost of leaving it:** Phase 4 kickoff has to make this decision under time pressure.

**Fix sketch:** Phase 4 prep session (between Phase 3 and Phase 4) — comparison spreadsheet, pick one. Twilio is default-good; MessageBird often cheaper for UK; Vonage has UK enterprise focus.

**Trigger:** Phase 4 kickoff (architect-lifecycle phase).

---

## DEBT-007 — Push notification implementation
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q4)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision
**Status:** Open

**The debt:** Phase 4 paid plans include push notifications. Implementation choice pending: web push (VAPID + service worker) or wait for native app?

**Why it exists:** Web push works in browser without app; native app adds substantial scope.

**Cost of leaving it:** Phase 4 kickoff blocks on this.

**Fix sketch:** Phase 4 prep session. Web push is reasonable starting point — works in Chrome/Edge/Firefox/Safari (Safari only since iOS 16.4+). Native app can wait.

**Trigger:** Phase 4 kickoff.

---

## DEBT-006 — Pre-launch ops checklist (multiple items)
**Added:** 06-07 May 2026 (accumulated through Sessions 5-8)
**Codebase:** SaaS
**Severity:** High (mandatory before commercial launch)
**Type:** Operational
**Status:** Open

**The debt:** Several operational items are required before any commercial customer can be onboarded. These accumulated through Phase 1a/1b shipping with workarounds:
1. Vercel Hobby → Vercel Pro (commercial use disallowed on Hobby)
2. Resend domain verification — currently using `onboarding@resend.dev` which deliverability-wise is fine for testing but unprofessional for customer emails
3. Separate Upstash Redis for prod (currently using one workspace for dev + intent-prod; need separate)
4. Stripe IP allowlist update (Phase 6 only — Stripe webhooks need stable receiving)
5. Point `portal.plancraftdaily.co.uk` (owned via Hostinger) at Vercel
6. Repo private + GitHub Team subscription (~$4/user/mo — currently public for branch-protection-on-Free, see ADR-018)

**Why it exists:** Each item is a small task that's deferred until commercial launch is imminent. Doing them prematurely wastes runway.

**Cost of leaving it:** First commercial customer can't sign up cleanly. PII potentially flowing through dev infrastructure. Branding/professionalism issues.

**Fix sketch:** Pre-launch operational session. Sequential checklist; ~half a day's work. None of these items are technically complex — just need to be done.

**Trigger:** Two weeks before first commercial customer onboards.

**Cross-references:** ADR-018 (repo public), ADR-004 (stack)

---

## DEBT-005 — Custom email domain DKIM/SPF/DMARC scope undecided
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q3)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Deferred decision
**Status:** Open

**The debt:** Custom email domains for orgs (Phase 5+ Practice tier feature). DNS verification flow undecided: DKIM only? Full SPF + DKIM + DMARC? Self-serve or assisted?

**Why it exists:** Phase 5 is far; DNS UX is fiddly.

**Cost of leaving it:** Phase 5 has to invent this.

**Fix sketch:** Phase 5 prep. Resend already supports custom domains via DKIM/SPF — leverage their flow. Self-serve initially; add concierge support if customers struggle.

**Trigger:** Phase 5 kickoff.

---

## DEBT-004 — Retention worker policy
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q1)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Deferred decision / Compliance
**Status:** Open

**The debt:** Soft-deleted rows accumulate forever. Some tables (e.g., projects with `deleted_at`) need eventual hard-delete to comply with GDPR right-to-erasure and to prevent indefinite data growth.

**Why it exists:** Pre-launch; volume is low.

**Cost of leaving it:** GDPR compliance gap; database bloat.

**Fix sketch:** Pre-launch decision: per-table retention policy. Default 30 days after `deleted_at` for most tables; exceptions for legally-required retention (financial records 7 years per DEBT-011). Implement as scheduled job.

**Trigger:** Pre-launch (compliance + DEBT-011 share an implementation).

---

## DEBT-003 — Apps Script cutover trigger undecided
**Added:** 04 May 2026 (ARCHITECTURE-saas.md §32 Q15)
**Codebase:** Both
**Severity:** Low
**Type:** Deferred decision
**Status:** Open

**The debt:** No condition currently flips Hasnath's in-house team from Apps Script V2 to the SaaS. Feature parity? Stability threshold? Customer count?

**Why it exists:** SaaS isn't ready yet (mid-Phase 1b). Trigger doesn't matter until SaaS reaches a state where the migration is plausible.

**Cost of leaving it:** Apps Script V2 maintenance continues forever by default.

**Fix sketch:** After Phase 1c ships and we've dogfooded for ~30 days, formalize: "if the in-house team can do everything they currently do in V2 using only SaaS for one full week, the cutover triggers." Migration is a one-shot data move from Sheets → Postgres.

**Trigger:** Post-Phase 1c, after 30-day dogfood.

---

## DEBT-002 — Stale `session-5-kickoff.md` at repo root
**Added:** 06 May 2026 (Session 7 observation)
**Codebase:** SaaS
**Severity:** Low
**Type:** Documentation
**Status:** Open

**The debt:** A file `session-5-kickoff.md` exists untracked at the repo root. It's a leftover from when Session 5 was being planned. Pre-existing from before Session 7 cleanup.

**Why it exists:** Was pasted into the repo as a working note, never committed or deleted.

**Cost of leaving it:** Trivial; harmless. But "untracked file in repo root for months" is the kind of thing that erodes hygiene.

**Fix sketch:** `rm session-5-kickoff.md` and either commit the deletion or just leave it untracked (it's not in git anyway). Session 9 cleanup pass.

**Trigger:** Next housekeeping session, or whenever someone notices and wants to fix it.

---

## DEBT-001 — Doc-vs-code path drift in Session 8 prompt
**Added:** 07 May 2026 (Session 8 Phase F discovery)
**Codebase:** SaaS (process)
**Severity:** Low
**Type:** Documentation
**Status:** Resolved 07 May 2026 (no actual code references; doc-only drift in chat history and possibly SESSION-8-HANDOVER.md)

**The debt:** Session 8 prompt referenced `/dashboard/settings/workflows` but actual route is `/settings/workflows`. Verified via `grep -rn "dashboard/settings/workflows" actions/ app/ components/ tests/` returning empty.

**Why it exists:** Prompt-drafting error; not validated against actual route structure before the prompt was sent to Claude Code.

**Cost of leaving it:** Future readers of the chat log get confusing references. Phase F runbook had to be corrected mid-test.

**Fix sketch:** Fixed during framework installation by checking SESSION-8-HANDOVER.md for any `/dashboard/settings/workflows` references and correcting. Lesson logged: validate route paths against actual file locations during prompt drafting.

**Trigger:** Resolved during framework install.

---

# Resolved Debt

## DEBT-R003 — shadcn AlertDialog migration
**Resolved:** 09 May 2026 in Session 9 commit `003f3a7`
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** Workaround (was DEBT-016)

**The debt was:** Browser-Claude could not verify native browser dialogs; three callsites used `window.confirm()` (StageSelector backward transition, WorkflowsList delete workflow, EditWorkflowDialog remove stage), forcing manual QA for those flows.

**Resolution:** Added shadcn AlertDialog (`components/ui/alert-dialog.tsx`) + thin `ConfirmDialog` wrapper. Migrated all three callsites + used the wrapper for new Session 9 confirms (delete message, remove participant). ADR-024 superseded by ADR-025.

**Cross-references:** ADR-025, components/ui/confirm-dialog.tsx

---

## DEBT-R002 — Cascade-cancel pending invitations on stakeholder removal
**Resolved:** 06 May 2026 in Session 7 commit `694314a` (squashed in `e60ca15`)
**Codebase:** SaaS
**Severity:** Medium → Resolved
**Type:** Bug (was carryover from Session 6)

**The debt was:** removing a stakeholder while they had a pending invitation left the invitation orphaned. User received "you're invited to a project that doesn't include you" experience.

**Resolution:** `removeStakeholder` server action now cascades to cancel pending invitations (sets `deleted_at`). Accepted invitations are preserved. Design C from three options. See ADR-015.

**Cross-references:** ADR-015, SESSION-7-HANDOVER.md

---

## DEBT-R001 — §35.7 entry 10 performance audit carryover
**Resolved:** 07 May 2026 in Session 8 commit `e3f75ce` (squashed in `0916640`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** Performance

**The debt was:** Performance audit on hot-path queries deferred from Session 7 (didn't fit scope). Risk of unidentified seq-scans on RLS-bound tables at scale.

**Resolution:** Session 8 Phase E ran EXPLAIN ANALYZE against 5 hot paths. Findings:
- All 5 paths use index scans, sub-2ms execution at current data scale
- One query (workflow_in_use check in deleteWorkflow) was tightened to filter by org_id alongside workflow_id, yielding cleaner index plan + defense-in-depth correctness
- No new indexes needed
- SECURITY DEFINER helper bodies reviewed before measurement (per carryover guidance)

**Cross-references:** SESSION-8-HANDOVER.md Phase E, actions/workflows.ts deleteWorkflow

---

# Index by trigger phase

For quick lookup of what needs to happen at each upcoming milestone:

## Before Phase 1c kickoff (Session 9)
- DEBT-012: Stake script runtime parsing approach for notification dispatch

## Before launch (commercial readiness)
- DEBT-006: Pre-launch ops checklist (multi-item)
- DEBT-010: Data export endpoint (GDPR Article 20)
- DEBT-011: Audit log retention policy
- DEBT-004: Retention worker policy (general)
- DEBT-018: Vercel deployment recommendations
- DEBT-021: Message rate limiting

## Phase 4 prep (architect lifecycle)
- DEBT-007: Push notification implementation
- DEBT-008: SMS provider choice

## Phase 5 prep (custom domains)
- DEBT-005: DKIM/SPF/DMARC scope

## Phase 6 prep (billing)
- DEBT-009: Stripe billing model

## Post-Phase 1c (after 30-day dogfood)
- DEBT-003: Apps Script cutover trigger

## Opportunistic / next housekeeping
- DEBT-002: Stale session-5-kickoff.md
- DEBT-013: Apps Script PropertiesService monitoring
- DEBT-014: UI test infrastructure (when Phase F exceeds 90 min)
- DEBT-017: POST-SESSION-CHECKLIST update for N/A discipline
- DEBT-019: Drizzle journal/snapshots gap for 0012-0017 (tooling)
- DEBT-022: Auto-join new org members to existing one-to-one conversations
- DEBT-023: Test-user fixture helper (auth.admin.createUser convention)

## Indefinite (revisit at trigger)
- DEBT-015: RLS performance at scale (>$10K MRR or visible latency)
