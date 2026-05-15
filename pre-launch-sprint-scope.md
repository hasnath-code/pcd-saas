# Pre-launch Sprint Scope

**Status:** Scoping locked — session breakdown + deferral list.
**Date:** 16 May 2026
**Feeds into:** Three sprint sessions (UX → Ops → Compliance + buffer)
**Source of truth:** `ARCHITECTURE-saas.md` §35.DECISION-PHASE-3-RENUMBER (sprint scope), §1 phase tracker (sprint sits between Phase 2 close and new Phase 3 kickoff)
**Constraint:** 4-week launch window. Sprint scope is the cuts that fit; the deferral list in §3 is everything that didn't.

---

## 1. One-line definition

Three sessions of pre-launch readiness work between Phase 2 close (15 May 2026) and first commercial onboarding target (≤14 June 2026). Session 1 closes the UX gaps a first stakeholder would hit. Session 2 switches on the production lights — Resend prod, Upstash split, Vercel Pro, rate limiting, Sentry context. Session 3 lands GDPR compliance + final cross-cutting Phase F + any S1/S2 spillover. Hasnath's existing 10-project migration runs independently on its own track.

This doc is the **sprint kickoff**, not a session kickoff. Each session still has its own kickoff conversation against the open questions in §7.

---

## 2. What's IN — sprint scope by session

### 2.1 Session 1 — UX polish + correctness

**Must-have**

- **DEBT-066** — Activity-timeline financial leak for non-financial stakeholders. Correctness blocker: a `progress_only` or `documents_only` stakeholder currently sees payment-amount strings in the timeline even though the section cards correctly hide. Per-stakeholder visibility contract violation.
- **DEBT-063** — Invitation landing page Sign up vs Sign in. First-time invitees hit ambiguous affordances and can land on "Invalid login credentials" with no recovery path. Highest-funnel entry point.
- **Mobile responsive sweep.** Stakeholders skew mobile-heavy. Walk `/portal/projects`, `/portal/projects/[id]`, `/portal/conversations`, `/portal/conversations/[id]`, `/portal/notifications`, the invitation-accept route, and the public `/q/[token]` / `/i/[token]` / `/r/[token]` pages — fix the obvious breaks.
- **Empty states.** First-run stakeholder lands on 0 projects / 0 messages. Today these are almost certainly raw empty. Write copy and a minimal illustration / icon per surface.
- **DEBT-060 + DEBT-061** — Pooler-bypass defense-in-depth on `getConversationDetail` + `listMessagesForConversation`. Mechanical fix mirroring DEBT-059 (DEBT-R006); caller-enforced participation gates today, query-level filter required.

**Should-have if time**

- **DEBT-031** — No unread badge in conversation nav. Visible polish, small UI change.
- **DEBT-055** — Conversations nav badge count inflation. Currently needs a Sentry reproducer; if one surfaces during S1 mobile/desktop QA, fix in-session; otherwise punt to S3 buffer.
- **DEBT-035** — File restore UI surface. Soft-delete machinery exists; only the affordance is missing. Cheap addition.
- **Copy pass on portal-side empty states + error toasts + notification email subjects.** Sweep what's there for "this would confuse a non-developer reading it cold."

**Deferred from S1** (do not pull these in mid-session)

- Portal-side document detail pages (`/portal/projects/[id]/invoices/[id]` etc.) — see §3.
- In-portal authenticated PDF download — see §3.
- Stakeholder settings/profile page — see §3.

**Phase F walk at S1 close:** mobile + desktop QA on `/portal/*` with a fresh stakeholder identity; financial-leak fix verified end-to-end (`progress_only` stakeholder sees no `payment.recorded` / `invoice.sent` rows in the timeline); invitation-accept walked from a never-seen email address through to `/portal/projects`.

### 2.2 Session 2 — Production readiness ops

**Must-have**

- **DEBT-024** — Resend paid tier + production domain verification. Hard launch blocker: free tier 403s to any non-Resend domain. Every external invitation email currently silently fails to send.
- **Upstash Redis production split.** One workspace currently doing dev + intent-prod. Split into separate production Redis with its own keys and limit allowances.
- **Vercel Hobby → Pro upgrade.** Commercial use disallowed on Hobby per Vercel ToS.
- **`portal.plancraftdaily.co.uk` DNS pointing.** Point the Hostinger-owned domain at Vercel; verify SSL; update `NEXT_PUBLIC_APP_URL` and `getAppUrl()` priority.
- **DEBT-021** — Message rate limiting. Abuse vector at launch (single malicious participant could DoS a conversation + drain Resend quota). Cheap on the existing Upstash limiter.
- **DEBT-025** — Sentry user/org scope context. Without scope, prod errors are forensically expensive to diagnose. ~30 LOC: set scope in `lib/auth.ts` request handlers.

**Should-have if time**

- **Repo private + GitHub Team subscription.** ADR-018 has it as a deliberate "public for free branch protection" choice; private is correct for launch.
- **DEBT-018** — Vercel deployment recommendations sweep.
- **Remaining DEBT-006 items** not covered above.

**Hasnath's 10-project migration track.** Independent — does not block S2 close. Run when convenient before launch. Spec lives separately (per `MIGRATION-MAP.md` if drafted; otherwise reference V2 Sheets directly).

**Phase F walk at S2 close:** production smoke test — sign in to production, create a test stakeholder invite, verify the email lands at an external address (gmail/outlook), verify rate limit kicks in on rapid message send, verify Sentry receives a deliberate test error with user+org scope attached.

### 2.3 Session 3 — Compliance + buffer

**Must-have**

- **DEBT-010** — Data export endpoint (`/api/export`, ZIP of per-tenant CSVs). GDPR Article 20 — legal obligation at launch, not optional.
- **DEBT-011** — Audit log retention policy. Decide retention windows per category (financial / authentication / general operational — recommended at filing time: 7 years / 1 year / 90 days). Build the scheduled DELETE job.
- **DEBT-004** — Retention worker policy (general). Decide per-table retention windows. Builds the same scheduled-job machinery as DEBT-011; bundle the implementation.

**Buffer / final QA**

- Any S1 or S2 spillover work.
- Final cross-cutting Phase F walk: full stakeholder + org sign-in walk across the production deploy, across mobile + desktop, all critical paths (signup, invite, accept, message, file upload, document send, payment record, receipt view).
- Production smoke verification on all DEBT closures from S1 and S2.
- Deferral-list audit — confirm §3 is current and intentional before declaring sprint complete.

**Phase F walk at S3 close:** full production verification + sign-off that the sprint is complete and the system is launch-ready.

---

## 3. What's OUT — deferred to post-launch

Explicit deferrals. Each carries a known cost; the cost is acceptable for the ≤4-week launch window.

| Deferred | Cost of deferring | When it lands |
|---|---|---|
| **DEBT-029 + DEBT-058** — Realtime not auto-updating | 30s polling fallback works; burns DB cycles. Worsens with presence/typing-dots additions post-launch. | Post-launch when budget for diagnosis exists. |
| **DEBT-041** — `/select-context` for dual-context users | Rare cohort (architect with own firm + stakeholder on a partner project). Workaround: URL-type to `/portal/projects` or `/dashboard`. | Post-launch when first dual-context user complains. |
| **DEBT-048** — Team-internal conversations UI | New feature, not polish. No team-only chat surface today. | Phase 3+ team-management polish (per its current trigger). |
| **Portal-side invoice/receipt detail pages** | Section cards on `/portal/projects/[id]` dead-end clicks. Public token pages (`/i/[token]`, `/r/[token]`) cover the detail surface. | Post-launch UX session. |
| **In-portal authenticated PDF download** | Stakeholders go via public token pages for PDF. | Post-launch when authentication context for downloads is worth building. |
| **Stakeholder settings/profile page** | No equivalent of org `/settings` on the portal side. No urgent launch need. | Post-launch when a stakeholder asks for it. |
| **React Email template migration** | Plain HTML templates work; renders adequately across mail clients. | Phase 4 polish (renumbered from Phase 5 per §35.DECISION). |

---

## 4. Dependencies — what the sprint builds on

The sprint sits on top of shipped Phase 1a/1b/1c/2 foundation. No unshipped phases are dependencies.

- **Portal layout + auth** (Phase 1b/1c) — all UX polish work happens inside the existing `/portal/*` shell.
- **Resend email path** (Phase 1a) — S2's prod domain verification builds on existing send infrastructure.
- **Upstash rate-limiting** (Phase 1a) — S2's message rate limiting extends the existing limiter machinery.
- **Sentry** (Phase 1a wired; scope context missing — DEBT-025) — S2 closes the scope gap.
- **`audit_logs`** (Phase 1a) — S3 retention policy operates on the existing table.
- **Drizzle ORM + scheduled-job pattern** (Phase 1a) — S3 retention jobs use existing patterns; if no scheduled-job infra exists yet, S3 sets it up via Vercel Cron or Supabase pg_cron.

---

## 5. Hard constraints

- **Schema-frozen.** `ARCHITECTURE-saas.md` Hard Rule 1. Any polish task wanting a new column or table is **not polish** — escalate as a feature-scope discussion. Strong scope-creep flag.
- **No Apps Script changes.** `SKILL.md` Rule 12 (strangler fig). New work goes in Next.js only.
- **No new ADRs unless a pattern emerges.** This is execution against existing patterns; ADRs are reserved for genuinely new architectural locks. If something does emerge, file like any other session.
- **No version bump on `ARCHITECTURE-saas.md` per session.** The sprint is not a numbered phase. Architecture spec only updates if a sprint discovery materially changes the spec (e.g., S3's retention-window decision finalizes §34 row "Audit log retention period").
- **Phase F walk required at every session close.** Per `SKILL.md` Rule 21 — UI changes get browser QA; ops changes get production smoke test. No exceptions.

---

## 6. Session handover doc format

Each session closes with a lightweight handover doc. Sprint handovers are **not** full §32-style Phase X handovers — those are reserved for numbered-phase work.

**File name:** `POLISH-SPRINT-S{1,2,3}-HANDOVER.md` at repo root.

**Required content:**
- Production verification (URL, Sentry test event ID, deploy SHA).
- Commits in the session (SHA + subject).
- DEBT IDs closed in the session; DEBT IDs created (if any).
- Inherited assumptions for the next session.
- Open / deferred items with next-target session.

**Not required:** §35 carryover updates, version bumps, ADR filing (unless a pattern genuinely emerges).

---

## 7. Open questions for each session's kickoff

Deliberately not answered here — kickoff conversations resolve these against the architecture spec + DEBT-LOG.md + live codebase.

**S1 kickoff:**

1. Mobile responsive sweep — viewport breakpoints to target? Default to 375 / 768 / 1024 / 1440 or pick differently?
2. Empty-state copy — write inline now, or have the kickoff propose copy candidates per surface?
3. DEBT-055 — does Sentry have a reproducer yet? If not, what's the diagnostic budget before punting?
4. Copy pass scope — emails + toasts + empty states only, or also nav labels + button copy?

**S2 kickoff:**

1. Custom domain `portal.plancraftdaily.co.uk` — keep DNS on Hostinger or move to Vercel-managed?
2. Repo-private timing — flip during S2 or wait for a quieter window?
3. Sentry scope context shape — `user.id + user.email + tags.org_id` minimum, or richer (org name + plan tier)?
4. Hasnath's 10-project migration — start during S2 or before/after? Migration plan doc needed first.

**S3 kickoff:**

1. Audit log retention windows — confirm 7y financial / 1y auth / 90d operational, or revise?
2. General retention windows per table — open decision. §34 leaves this "Pre-launch."
3. Data export format — ZIP of CSVs per table, or single JSON dump? PDF option? CSV-per-resource is the §34 recommendation.
4. Spillover from S1/S2 — what landed, what's still open, what punts to post-launch?

---

## 8. Summary — the locked decisions

- **Pre-launch sprint = 3 sessions, scoped between Phase 2 close (15 May 2026) and first commercial onboarding target (≤14 June 2026).**
- **S1 = UX polish + correctness.** Must: DEBT-066, DEBT-063, mobile sweep, empty states, DEBT-060/061. Should-if-time: DEBT-031, DEBT-055, DEBT-035, copy pass.
- **S2 = production readiness ops.** Must: DEBT-024 + Resend prod domain, Upstash split, Vercel Pro, custom domain DNS, DEBT-021 (message rate limit), DEBT-025 (Sentry scope). Should-if-time: repo private + GitHub Team, DEBT-018, remaining DEBT-006 items.
- **S3 = GDPR compliance + final QA + buffer.** Must: DEBT-010 (data export), DEBT-011 (audit retention), DEBT-004 (general retention worker). Final cross-cutting Phase F walk.
- **Hasnath's 10-project migration is independent** — runs on its own track, does not block any session.
- **Hard cuts deferred to post-launch:** DEBT-029/058 Realtime, DEBT-041 select-context, DEBT-048 team-internal conversations UI, portal-side document detail pages, in-portal PDF download, stakeholder settings page, React Email migration.
- **Schema-frozen. No Apps Script touches. No automatic ADR filing.** Polish + ops execute against the existing spec.
- **Each session = Phase F walk at close.** Lightweight `POLISH-SPRINT-S{N}-HANDOVER.md` per session.
- **Sprint is not a numbered phase.** Phase tracker stays at Phase 3 = Architect lifecycle next.
