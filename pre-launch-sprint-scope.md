# Pre-launch Sprint Scope

**Status:** Reframed 18 May 2026 — indefinite dogfood phase (see §1). Originally scoping-locked 16 May 2026.
**Date:** 16 May 2026 (original) · 18 May 2026 (dogfood reframe)
**Feeds into:** S1 (UX — shipped) → S2 (dogfood readiness) → gated commercial readiness sprint
**Source of truth:** `ARCHITECTURE-saas.md` §35.DECISION-PHASE-3-RENUMBER (sprint scope), §1 phase tracker (sprint sits between Phase 2 close and new Phase 3 kickoff)
**Constraint:** Schema-frozen (Hard Rule 1). No launch deadline — the dogfood phase is indefinite; the commercial readiness sprint is gated, not scheduled.

---

## 1. One-line definition

Pre-launch readiness work starting at Phase 2 close (15 May 2026). Originally scoped as three sessions driving toward a first commercial onboarding; **reframed mid-sprint (18 May 2026)** — the project is not launching commercially in this window. It now runs an **indefinite MVP dogfood phase** with two users (the maintainer + Hasnath) before scope is re-decided. A **commercial readiness sprint is scoped separately when launch is back on the table** (§2.3).

Session 1 closed the UX gaps a first stakeholder would hit. Session 2 ships the dogfood-readiness items still worth doing on free tiers — message rate limiting, Sentry scope context, and a dogfood worklog (`DOGFOOD-WORKLOG.md`). The original Session 3 (GDPR compliance + ops) is **launch-gated, not dogfood-gated**, and moves wholesale into the gated commercial readiness sprint. Hasnath's existing 10-project migration runs independently on its own track.

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

### 2.2 Session 2 — Dogfood readiness

**Reframed 18 May 2026.** The original S2 ("production readiness ops" — Resend paid tier, Upstash production split, Vercel Hobby→Pro, custom-domain DNS) assumed an imminent commercial launch. With launch deferred to an indefinite dogfood phase, those paid-tier + launch-ops items move to the gated commercial readiness sprint (§2.3). S2 now ships only what is worth doing on free tiers for a 2-user dogfood.

**Must-have**

- **DEBT-021** — Message rate limiting. Wrap `sendMessage` / `editMessage` in the existing Upstash limiter (`lib/ratelimit.ts`): per-user global (30/min) + per-user-per-conversation (10/min). Cheap, free-tier, closes a real abuse vector even at dogfood scale.
- **DEBT-025** — Sentry user/org scope context. Set `Sentry.setUser` / `setTag('org_id')` / `setTag('participant_type')` in the auth helpers (`lib/auth/requireAuth.ts`) server-side, and via a `useEffect` client component in the org + portal layouts. Makes dogfood-phase errors diagnosable.
- **Dogfood worklog.** `DOGFOOD-WORKLOG.md` at repo root — a lightweight markdown canvas for the maintainer + Hasnath to capture verified-end-to-end capabilities, findings, and design questions deferred to the post-dogfood brainstorm.

**Optional**

- **Custom domain `portal.plancraftdaily.co.uk`.** Free on Vercel Hobby. Ship only as a pure "add domain in Vercel + hand DNS values to the user for Hostinger" task. Making it the *canonical* app URL (`NEXT_PUBLIC_APP_URL` / `getAppUrl()` priority + the Supabase Auth redirect allowlist) is **not** trivial and is deferred to the commercial readiness sprint.

**Hasnath's 10-project migration track.** Independent — does not block S2 close.

**Phase F walk at S2 close:** Vercel preview smoke — rate limit kicks in on rapid message send (and is per-conversation, not just global); a deliberate test error from a known org user lands in Sentry with `user` + `org_id` tags populated. `DOGFOOD-WORKLOG.md` present and readable.

### 2.3 Commercial readiness sprint (gated — not yet scheduled)

**Trigger:** the maintainer decides to launch commercially. Until then this sprint is not scoped in detail; the list below is the inventory it inherits. It is **gated, not scheduled** — the dogfood phase is indefinite.

**Inherited from the original S2 + S3:**

- **DEBT-024** — Resend paid tier + production domain verification (external-recipient email unblock). Stays Open.
- **Upstash Redis production split** — separate prod workspace with its own keys/limits.
- **Vercel Hobby → Pro** — commercial use is disallowed on Hobby per Vercel ToS.
- **Custom-domain canonicalisation** — point `portal.plancraftdaily.co.uk`, then make it canonical (`NEXT_PUBLIC_APP_URL` + Supabase Auth redirect allowlist + re-test the magic-link / auth-callback round-trip).
- **Repo private + GitHub Team** — ADR-018's "public for free branch protection" choice flips.
- **DEBT-010** — GDPR data export endpoint (Article 20). Legal obligation at commercial launch.
- **DEBT-011** — Audit log retention policy + scheduled DELETE job.
- **DEBT-004** — General retention worker policy (shares DEBT-011's scheduled-job machinery).
- **DEBT-018** — Vercel deployment recommendations sweep.

**Final QA at that sprint's close:** full production verification across mobile + desktop, all critical paths, and a deferral-list audit before declaring launch-ready.

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

1. Sentry scope shape — `user.id + user.email + tag.org_id + tag.participant_type` minimum, or richer (org name, plan tier)?
2. Custom domain `portal.plancraftdaily.co.uk` — add now as a non-canonical alias, or defer the whole thing to the commercial readiness sprint?
3. Dogfood worklog — what conventions for recording findings vs. deferred design questions? (See `DOGFOOD-WORKLOG.md`.)
4. Hasnath's 10-project migration — start during the dogfood phase or after?

**Commercial readiness sprint kickoff:**

1. Audit log retention windows — confirm 7y financial / 1y auth / 90d operational, or revise?
2. General retention windows per table — open decision. §34 leaves this "Pre-launch."
3. Data export format — ZIP of CSVs per table, or single JSON dump? CSV-per-resource is the §34 recommendation.
4. Dogfood spillover — what did the dogfood phase surface that must ship before commercial launch?

---

## 8. Summary — the locked decisions

- **Pre-launch sprint reframed 18 May 2026.** No commercial launch in this window; the project enters an **indefinite MVP dogfood phase** (maintainer + Hasnath). A **commercial readiness sprint** is scoped separately, gated on the launch decision.
- **S1 = UX polish + correctness** (shipped). DEBT-066, DEBT-063, mobile sweep, empty states, DEBT-060/061; should-haves DEBT-031, DEBT-035, copy pass.
- **S2 = dogfood readiness.** Must: DEBT-021 (message rate limit), DEBT-025 (Sentry scope context), `DOGFOOD-WORKLOG.md`. Optional: custom-domain hand-off (non-canonical). All free-tier; no paid upgrades.
- **Commercial readiness sprint (gated)** absorbs the original S2 ops + S3 compliance: Resend paid tier (DEBT-024), Upstash prod split, Vercel Pro, custom-domain canonicalisation, repo-private + GitHub Team, DEBT-010 (data export), DEBT-011 (audit retention), DEBT-004 (general retention), DEBT-018.
- **Hasnath's 10-project migration is independent** — runs on its own track.
- **Hard cuts deferred to post-launch** (unchanged): DEBT-029/058 Realtime, DEBT-041 select-context, DEBT-048 team-internal conversations UI, portal-side document detail pages, in-portal PDF download, stakeholder settings page, React Email migration.
- **Schema-frozen. No Apps Script touches. No automatic ADR filing.**
- **Each session = Phase F walk at close.** Lightweight `POLISH-SPRINT-S{N}-HANDOVER.md` per session.
- **Sprint is not a numbered phase.** Phase tracker stays at Phase 3 = Architect lifecycle next.
