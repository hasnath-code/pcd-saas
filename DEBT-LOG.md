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

## DEBT-066 — Activity timeline leaks financial event text to non-financial stakeholders
**Added:** 15 May 2026 by Phase 2 Session 14 Phase F walk
**Codebase:** SaaS
**Severity:** Medium
**Type:** Stakeholder data-visibility leak (mild)
**Status:** Open

**The debt:** When a stakeholder has `can_view_financials = false`, the financial section cards (Quotes / Invoices / Payments / Receipts) are correctly removed from the DOM on `/portal/projects/[id]`, but the Activity Timeline on the same page still surfaces strings like "received £400.00, R1" / "invoice / quote / payment / receipt issued". Activity rows for `payment.recorded`, `quote.sent`, `quote.accepted`, `invoice.sent`, `invoice.revised`, `receipt.generated` are written with `visibleToStakeholders: true` because they're part of the project narrative for *financial* stakeholders, but the per-stakeholder financial flag is not consulted at timeline-render time.

**Why it exists:** Session 11 designed the activity timeline gate as a per-row `visible_to_stakeholders` boolean (write-time decision) rather than a per-stakeholder per-event-type matrix. It works for the binary "is this stakeholder-relevant?" axis but doesn't model "is this stakeholder-relevant *for this stakeholder profile*?". Phase 2 Sessions 12–14 added 8 financial event types to the vocabulary and logged them with `visible_to_stakeholders: true` (correct for financial stakeholders); the gap is the read-time filter for non-financial stakeholders.

**Cost of leaving it:** A `progress_only` or `documents_only` stakeholder reading the project timeline learns the rough size of payments and the existence of invoices/quotes — info their visibility profile says they shouldn't see. Mild leak (no exact line items, no PDF access) but contradicts the explicit per-stakeholder visibility contract. Becomes more visible after Phase 3 client-portal polish surfaces the timeline more prominently.

**Fix sketch:** Add a `FINANCIAL_EVENT_TYPES` set in `lib/notifications/events.ts` listing the 8 financial events. In `db/queries/project-activity.ts:listProjectActivity`, when the caller is a stakeholder (already known via the `visibleOnly` flag), look up the caller's `can_view_financials` flag for the project and add `WHERE event_type NOT IN (...)` when false. Mirror the pattern in `db/queries/documents.ts:hasStakeholderFinancialAccess`. ~30 LOC + 2 tests (positive + negative).

**Trigger:** Before Phase 3 client-portal polish, OR when a customer notices.

**Cross-references:** ARCHITECTURE-saas.md §14 (visibility model), §12.7 (project_activity), §12.P2.9 (Session 14 portal financial visibility — this DEBT is the read-time complement of the section-rendering gate); `db/queries/project-activity.ts:listProjectActivity`; `lib/activity/log.ts:logActivityTx`; recordPayment / sendQuote / acceptQuote / sendInvoice / reviseInvoice activity-row writes.

---

## DEBT-065 — Refunds not modelled (payments.amount > 0 CHECK precludes negative rows)
**Added:** 15 May 2026 (Phase 2 Session 13)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision
**Status:** Open

**The debt:** `payments.amount` has a `CHECK (amount > 0)` constraint enforcing positive-only rows. Refunds — money returned to the client — cannot be expressed as a `payments` row. The `derivePaymentStatus` ladder includes no `refunded` state for this reason; the kickoff §4 table called out `refunded` as out of scope.

**Why it exists:** The kickoff locked positive-only payments to keep the running-total SUM intuitive (no signed semantics) and the recordPayment validation simple. Clean refund modelling needs either (a) a separate `payment_refunds` table with its own audit log, or (b) a `refund_for_payment_id` self-FK + inverted-amount convention (rejected — breaks the `amount > 0` invariant).

**Cost of leaving it:** Surveyors who issue a refund have to handle it as an off-portal bank entry — the project's running-total stays inflated unless they `correctPayment` the original row to a smaller value (which loses the audit story of "we received X then refunded Y"). For Phase 2 + 3 timescale this is acceptable; refunds are rare in surveyor practice. Becomes a real problem when (a) Stripe billing lands (Phase 6) and refunds-via-Stripe become a one-click flow, or (b) the financial model deferred to Phase 5+ needs to surface "net revenue per project" accurately.

**Fix sketch:** New table `payment_refunds (id, payment_id FK, amount > 0, refunded_at, refunded_by, reason, created_at, deleted_at)`. RLS mirrors payments. `derivePaymentStatus` ladder grows a `refunded` branch when `SUM(refunds.amount) > 0` for the project. `getProjectPaymentSnapshot` aggregates refunds alongside payments. UI exposes "Record refund" alongside "Record payment". ~half-session of work; ships when (a) Stripe lands or (b) a user actually asks for refund modelling.

**Trigger:** First customer requests refund tracking, OR Stripe billing lands.

**Cross-references:** `db/migrations/0025_payments.sql` (the CHECK); `lib/documents/payment-status.ts` (the ladder; refunded branch absent); ARCHITECTURE-saas.md §12.P2.5; phase-2-kickoff.md §4 (refunds explicitly out of scope).

---

## DEBT-064 — Backfill notification_preferences for new Phase 2 event types
**Added:** 15 May 2026 (Phase 2 Session 12 carryover, ARCHITECTURE-saas.md §35.12)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Operational
**Status:** Resolved (15 May 2026)

**The debt:** Session 11's per-identity notification_preferences seed runs only on identity create. Session 12 added `quote.sent` + `quote.accepted` event types but deferred dispatch wiring. If Session 13/14 wired `dispatchNotification` for those events without a backfill, existing identities would silently never receive the new notifications — `dispatchNotification` returns 0 inserts for unconfigured event types. Not a data leak, but operationally surprising.

**Why it exists:** Session 12's scope was the schema + the four quote actions. Wiring dispatch (and therefore needing the backfill) was a Session 13 follow-up.

**Cost of leaving it:** Existing surveyor / stakeholder identities would not receive in-app or email notifications for `quote.sent` / `quote.accepted` / `invoice.sent` / `invoice.revised` / `payment.recorded` / `payment.corrected`. New identities (created post-Session-11) get them via the per-identity seed.

**Fix:** Session 13 shipped:
- Migration `0027_backfill_notification_prefs_for_phase_2_events.sql` — idempotent `INSERT … SELECT … ON CONFLICT DO NOTHING` for all `users` (where `deleted_at IS NULL`) + all `clients` (with at least one `client_org_memberships` row, `deleted_at IS NULL`) × the 6 new event types × 4 channels. `in_app` + `email` enabled by default; `push` + `sms` disabled (matches `DEFAULT_ENABLED_CHANNELS`). Verified idempotent via `tests/actions/debt-064-backfill.test.ts`.
- Dispatch wiring on `sendQuote` / `acceptQuote` (the Session 12 deferred work) + `sendInvoice` / `recordPayment` / `correctPayment` (Session 13 new). All call sites follow ADR-033 (post-commit, per-recipient try/catch → Sentry, never re-throws). `correctPayment` dispatches to org members only; the rest fan out to org + accepted financial-visible stakeholders. Verified via `tests/actions/debt-064-dispatch.test.ts`.

**Cross-references:** Resolution branch `session-13-invoices-payments-status`; ARCHITECTURE-saas.md §35.13 + §12.P2.6; `actions/documents.ts:dispatchQuoteOrInvoiceNotification`; `actions/payments.ts:dispatchPaymentNotification`; `lib/notifications/seed-defaults.ts` (the per-identity seed that continues to cover new identities).

---

## DEBT-063 — Invitation landing page doesn't guide new invitees to Sign up vs Sign in
**Added:** 15 May 2026 (Phase F UX polish bundle — DEBT-038 verification walk)
**Codebase:** SaaS
**Severity:** Medium
**Type:** UX
**Status:** Open

**The debt:** The invitation landing page presents Sign up / Sign in / "Accept invitation" affordances with no guidance for brand-new invitees. A first-time invited stakeholder (their `clients` row exists from `inviteStakeholder`'s tx, but no `auth.users` row yet) who instinctively clicks "Sign in" hits "Invalid login credentials" with no redirect to Sign up. The natural recovery path (try the other option) is not surfaced.

**Why it exists:** The landing page was built before ADR-031's dual-context routing. Sign-in vs sign-up disambiguation wasn't a Phase 1 priority; the magic-link flow assumed users would click the email's button rather than landing on the page first via the URL.

**Cost of leaving it:** Conversion-funnel friction at a new client's first product interaction. They may interpret the "Invalid login credentials" message as evidence that the invitation is broken and abandon. Highest-value entry point for stakeholders, so the cost is over-indexed.

**Fix sketch:** Distinguishing copy on the landing page ("New to PCD? Sign up" vs "Already have an account? Sign in") with Sign up as the visually primary action. Consider folding "Accept invitation" into the Sign in path so a first-time user is auto-routed to signup (or have the Sign in form detect "no account exists for this email" and redirect to `/signup?invitation=<token>`). ~30-45 min including a Phase F runbook addition. Related to DEBT-R008's copy clarity work in the same flow.

**Trigger:** Pre-launch — a first stakeholder confusion report would surface this as urgent.

**Cross-references:** invitation landing page component (TBD during fix); DEBT-R008 (same flow, post-signup copy clarity); DEBT-R015 (DEBT-038 verification walk surfaced this observation)

---

## DEBT-062 — Dashboard URL redirects to `/onboarding` in specific Chrome profile
**Added:** 14 May 2026 (MINI-SESSION-DEBT-059 Phase F observation)
**Codebase:** SaaS
**Severity:** Low
**Type:** Bug (suspected stale auth state)
**Status:** Open

**The debt:** A particular Chrome profile, when navigating to `/dashboard/projects/[projectId]` on the Vercel preview, redirects to `/onboarding` instead of rendering the org dashboard. Other Chrome profiles for the same org user navigate successfully. Profile had been used repeatedly across sessions — suspected stale Supabase auth cookie or `users` table row mismatch in the org-bootstrap redirect logic.

**Why it exists:** Unknown root cause. Observed during DEBT-059 Phase F walk; not introduced by the fix (DEBT-059 changes don't touch middleware, layout auth checks, or onboarding routing).

**Cost of leaving it:** Confusion for users who switch browser profiles or have cookie/storage drift; possible support load if real users hit it. Magnitude bounded — may be specific to this developer profile's stale state.

**Fix sketch:** Reproduce in a fresh incognito window with clean state. If reproducible from clean state → real bug in middleware/org-bootstrap redirect logic (investigate). If only reproducible with stale cookies/storage → document the cookie-clear workaround for users, optionally add a "stuck on onboarding?" recovery path.

**Trigger:** Real user reports the issue OR pre-launch operational pass.

**Cross-references:** Observed during MINI-SESSION-DEBT-059 Phase F walk; URL `pcd-saas-git-debt-059-stakeholde-c875c9-saliqueh-6333s-projects.vercel.app/dashboard/projects/019e2336-7768-711a-9a76-93e077417f94` redirected to `/onboarding` in one Chrome profile while working correctly in others.

---

## DEBT-061 — `listMessagesForConversation` pooler-bypass: caller-enforced participation gate (no query-level filter)
**Added:** 14 May 2026 (MINI-SESSION-DEBT-059 audit observation; sibling of DEBT-060)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Bug / Security (defense-in-depth)
**Status:** Open

**The debt:** `db/queries/conversations.ts:listMessagesForConversation` scopes only by `conversationId`. The Drizzle pooler `db` bypasses RLS so the `messages` SELECT policy doesn't apply. Stakeholder portal pages (`app/portal/conversations/[conversationId]/page.tsx`) re-enforce participation via a separate query before calling (line 33–45 → `notFound()` on mismatch), so the SQL layer fetches arbitrary rows but they're never user-surfaced. Same shape as DEBT-060.

**Why it exists:** Surfaced during the DEBT-059 audit (Phase 1 inventory). Different bug class than DEBT-059: visibility here is participation-based (`conversation_participants` join on `participantType + participantId`), not a single-column visibility flag — the `visibleOnly: boolean` pattern doesn't naturally extend.

**Cost of leaving it:** Defense-in-depth gap. If the page-level participation check were ever removed or a new caller forgot it, the leak would become live (identical risk class to pre-fix DEBT-059).

**Fix sketch:** Add a required `participant: { participantType: 'user' | 'client'; participantId: string }` parameter; AND it into the WHERE via an EXISTS sub-query on `conversation_participants` (active row, matching participantType + participantId, leftAt IS NULL). Bundle with DEBT-060 — the two functions are siblings, one PR makes sense. ~30–45 min including regression tests for both.

**Trigger:** Pre-launch operational pass OR a future change that touches portal conversation rendering.

**Cross-references:** `db/queries/conversations.ts:listMessagesForConversation`; `app/portal/conversations/[conversationId]/page.tsx:33-47` (caller-side participation check); DEBT-060 (sibling); DEBT-R006 (DEBT-059 fix as pattern reference); ARCHITECTURE-saas.md §12.3 (`messages`)

---

## DEBT-060 — `getConversationDetail` pooler-bypass: caller-enforced participation gate (no query-level filter)
**Added:** 14 May 2026 (MINI-SESSION-DEBT-059 audit observation; same bug-class family as DEBT-059)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Bug / Security (defense-in-depth)
**Status:** Open

**The debt:** `db/queries/conversations.ts:getConversationDetail` scopes only by `conversationId` and `deletedAt IS NULL`. The Drizzle pooler `db` bypasses RLS so the `conversations` SELECT policy doesn't apply. Stakeholder portal pages (`app/portal/conversations/[conversationId]/page.tsx:29`) call this query BEFORE the participation check at lines 33–45, so the SQL fetches arbitrary conversation metadata; rendering is gated by `notFound()` afterwards. Caller-enforced gate, not query-level — defense-in-depth gap.

**Why it exists:** Surfaced during the DEBT-059 audit. Different bug class than DEBT-059: visibility here is participation-based (requires join to `conversation_participants` for `participantType + participantId` match), not a single-column visibility flag. The DEBT-059 `visibleOnly: boolean` pattern doesn't naturally extend; needs a `participant: { type, id }` argument with an EXISTS sub-query instead.

**Cost of leaving it:** Active SQL-level fetch of arbitrary conversation rows by ID for any authenticated user who hits the portal detail page. Not user-visible today (page-level participation check filters), but the leak window opens if the page-level check is ever removed or a new caller forgets it. Same shape as pre-fix DEBT-059.

**Fix sketch:** Add a required `participant: { participantType: 'user' | 'client'; participantId: string }` parameter; AND it into the WHERE via an EXISTS sub-query on `conversation_participants`. Update both callers (`app/portal/conversations/[conversationId]/page.tsx`, `app/(org)/conversations/[conversationId]/page.tsx`). Bundle with DEBT-061. ~30–45 min including regression tests.

**Trigger:** Pre-launch operational pass OR a future change that touches portal conversation rendering.

**Cross-references:** `db/queries/conversations.ts:getConversationDetail`; `app/portal/conversations/[conversationId]/page.tsx:29-45` (call site + caller-side check); DEBT-061 (sibling); DEBT-R006 (DEBT-059 fix as the canonical visibility-column variant of this pattern); ARCHITECTURE-saas.md §12.1 (`conversations`)

---

## DEBT-058 — Notifications Realtime delivery broken locally (DEBT-029 pattern)
**Added:** 14 May 2026 (Session 11 Phase 8 observation)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Bug
**Status:** Open

**The debt:** `scripts/realtime-smoke-notifications.mjs` confirms that subscriptions to `notifications:<recipientType>:<recipientId>` transition to `CLOSED` immediately on local Supabase — the same failure mode DEBT-029 documents for the `messages` channel. The `notifications` table IS in the `supabase_realtime` publication (verified Phase 1 cloud + local), RLS policies allow the subscriber to see their own rows (verified Phase 2), but the WebSocket channel handshake itself fails locally.

**Why it exists:** Root cause uncharacterized — could be (a) Realtime container config in the local OrbStack stack, (b) a JWT/auth-context bridging issue in the local Realtime worker, (c) a Supabase Realtime CLI version drift. Cloud Realtime status during Phase F was inconclusive (the polling fallback masks the difference if Realtime ever fired faster than 30s).

**Cost of leaving it:** Inbox UX has up to 30s lag on new notifications even when the publication and RLS are correctly wired. Polling fallback in `hooks/use-notifications.ts` handles it but burns DB cycles every 30s × every open notifications page. Not blocking — Phase F passed all 19 checks with polling alone. Worsens proportionally as more Realtime-dependent features land (presence indicators, typing dots in Phase 3+).

**Fix sketch:** Same investigation path as DEBT-029. Suspected causes documented in DEBT-029's "Why it exists" section. The reproducer `scripts/realtime-smoke-notifications.mjs` is in the repo; pair with the existing `tests/rls/notifications.test.ts` for subscription-side RLS validation. 30-60 min diagnosis once budget is allocated.

**Trigger:** Either (a) DEBT-029 gets prioritized — they're the same bug — or (b) a Realtime-dependent feature lands that can't tolerate 30s polling lag.

**Cross-references:** DEBT-029 (same pattern, messages channel); `hooks/use-notifications.ts` (polling fallback implementation); `scripts/realtime-smoke-notifications.mjs` (reproducer); ARCHITECTURE-saas.md §17 (Realtime + polling design); migration `0021_notifications.sql` (publication wiring)

---

## DEBT-057 — `updateMilestone` doesn't dispatch / log activity when `scheduledAt` is set on an existing placeholder
**Added:** 14 May 2026 (Session 11 Phase 5/6 observation)
**Codebase:** SaaS
**Severity:** Low
**Type:** Bug / Missing feature
**Status:** Open

**The debt:** `createMilestone` correctly dispatches `milestone.scheduled` + writes a `project_activity` row when `scheduledAt` is provided. But if the user creates a placeholder milestone (no `scheduledAt`) and later sets the date via `updateMilestone`, no notification fires and no activity row is written. The "milestone got scheduled" event silently passes through.

**Why it exists:** Session 11 plan §F wired the dispatcher into 5 specific actions; `updateMilestone` wasn't on the list because the kickoff focused on creation events. The two-step "create placeholder, schedule later" workflow wasn't surfaced as a primary path.

**Cost of leaving it:** Users who use the placeholder pattern lose visibility on the "milestone scheduled" event entirely — no email, no in-app, no activity row. Survey teams who track tentative dates separately from confirmed ones may rely on this workflow.

**Fix sketch:** Add to `actions/milestones.ts:updateMilestone`: when `patch.scheduledAt` transitions from `NULL` to a value (and only on that transition), dispatch + log activity per the same post-commit pattern as `createMilestone`. The transition check is the tricky bit — read the old row inside the action to detect it. ~30 min including a regression test.

**Trigger:** First user complaint about a "silently-scheduled milestone" OR pre-launch operational pass.

**Cross-references:** `actions/milestones.ts:createMilestone` (the wired path); `actions/milestones.ts:updateMilestone` (the missing wire); ADR-033 (post-commit dispatch pattern)

---

## DEBT-056 — `acceptInvitation` non-transactional 3-write sequence
**Added:** 14 May 2026 (Session 11 Phase 3 observation)
**Codebase:** SaaS
**Severity:** Low
**Type:** Workaround / Risk
**Status:** Open

**The debt:** `actions/users.ts:acceptInvitation` does three DB writes in sequence outside any transaction: (1) `db.insert(users)` (new team member row), (2) `seedNotificationDefaultsTx(db, ...)` (48 preference rows), (3) `db.update(invitations)` (set `acceptedAt`). If any one fails, the others remain — partial state.

**Why it exists:** `acceptInvitation` was a pre-Session-11 action that already shipped without a transaction. Session 11 Phase 3 wired the seed call but didn't refactor the existing structure — scope creep avoidance. The seed is idempotent so re-running the action would just re-attempt the invitation update, but the failure modes still produce partial states.

**Cost of leaving it:** Edge case. Most common failure mode (seed fails → invitation never marked accepted) results in the user being able to re-click the magic link, hitting `STAKEHOLDER_ALREADY_INVITED` (since the users row exists), and seeing a confusing error. Won't surface in 99% of flows.

**Fix sketch:** Wrap the three writes in `db.transaction(async (tx) => { ... })`. Per ADR-033 / Hard Rule 27, any side effects (email send, dispatcher) stay post-commit. The seed call accepts `DbOrTx` so it composes cleanly. ~20 min including a regression test.

**Trigger:** First Sentry report of "user in users table without accepted invitation" OR opportunistic next-time-the-action-is-modified.

**Cross-references:** `actions/users.ts:acceptInvitation`; `lib/notifications/seed-defaults.ts:seedNotificationDefaultsTx`; SKILL.md Hard Rule 19 (atomic multi-table writes); ADR-033 (post-commit dispatch carveout, doesn't apply here since there's no I/O)

---

## DEBT-055 — Conversations nav badge count appears inflated
**Added:** 14 May 2026 (Session 11 Phase F)
**Codebase:** SaaS
**Severity:** Low
**Type:** Bug
**Status:** Open

**The debt:** During Phase F, the Conversations nav badge in the org layout displayed an unread count that appeared higher than the actual unread state when verified by visiting `/conversations`. May be: (a) a stale `totalUnreadForOrgUser` query result cached at SSR time; (b) counting deleted-but-not-yet-acknowledged conversations; (c) counting messages where the user already navigated past via Realtime without a `markConversationRead` round-trip. Not reproducible enough during Phase F for a clean repro.

**Why it exists:** Unknown — needs targeted investigation.

**Cost of leaving it:** Mild user confusion. "Says 3 unread but I see 1" is annoying but not data-loss. The count refreshes correctly on next nav, so the discrepancy is transient.

**Fix sketch:** Add Sentry breadcrumb logging on the `totalUnreadForOrgUser` query result vs the actual conversations-page-load count. Reproduce in a controlled scenario (send N messages, mark M read, expect N-M). ~1-2 hours including instrumentation + fix.

**Trigger:** Pre-launch UX polish pass OR if customers complain about the badge.

**Cross-references:** `app/(org)/layout.tsx` (badge render); `db/queries/conversations.ts:totalUnreadForOrgUser`

---

## DEBT-049 — Vercel 504 on `inviteStakeholder` from tx-bounded dispatcher + email sends
**Added:** 13 May 2026 (Session 11 Phase F)
**Codebase:** SaaS
**Severity:** High (was — closed by hotfix)
**Type:** Bug / Performance
**Status:** **Resolved** 14 May 2026 (commit `61510b1`, ADR-033)

**The debt (resolved):** Session 11 Phase 5 originally wired `dispatchNotification` INSIDE each action's `db.transaction(...)` per the kickoff's then-current Hard Rule 6. The dispatcher's email channel called Resend HTTPS for each recipient — every call held the transaction open for ~1-2s. Phase F's first `inviteStakeholder` walk on PR #12 preview hit Vercel 504 because total wall-clock exceeded the 10s function limit; the tx rolled back leaving a partial state (orphan `auth.users` row from an earlier sign-in attempt, no `clients`/`project_stakeholders`/`invitations` rows).

**Resolution:** Adopted post-commit dispatch pattern (ADR-033). All 5 wired actions refactored in one pass: DB-only writes (domain mutation + `logActivityTx` rows) stay inside the transaction; dispatcher fan-out + outbound `sendEmail` calls move post-commit. Per-recipient failures captured to Sentry with isolated try/catch — one Resend hiccup doesn't kill the rest of the fan-out, and no notification failure ever rolls back a committed domain write. Cleanup script `scripts/cleanup-debt049-orphans.ts` removed the orphaned `auth.users` row so the test email could be re-used. Phase F re-walk post-hotfix: 19/19 PASS. SKILL.md Hard Rule 27 codifies the pattern for future I/O-emitting actions.

**Cross-references:** ADR-033; SKILL.md Hard Rule 27 (v3.6 → v3.7); commit `61510b1` (hotfix); `actions/{messages,projects,files,stakeholders,milestones}.ts` (all 5 refactored); `scripts/cleanup-debt049-orphans.ts` (orphan cleanup tool)

---

## DEBT-048 — No UI for team-internal conversations
**Added:** 14 May 2026 (Session 11 Phase F UX)
**Codebase:** SaaS
**Severity:** Low
**Type:** Missing feature
**Status:** Open

**The debt:** Session 9 shipped the conversations primitive with `general`, `one_to_one`, and `group` types. The org-side `/conversations` inbox shows org↔client threads but offers no path to create a team-only conversation (e.g., two surveyors chatting about a project without the client seeing). The `general` type with no client participant is structurally possible but there's no UI button to create one.

**Why it exists:** S9 scope was org↔client messaging; team-internal was a known absent feature. Session 11 didn't add it either.

**Cost of leaving it:** Surveyors who want to chat about a project privately fall back to Slack / iMessage / email — losing the in-app context. Adoption headwind.

**Fix sketch:** Add a "New team thread" button next to the existing "New conversation" affordance. Wire to a new `createTeamConversation` action that inserts a `group`-type conversation with only org-member participants (no client). RLS already supports this — client-side queries already filter by participation. ~2-3 hours including UI + action + tests.

**Trigger:** First user request for team-only chat OR pre-launch UX pass.

**Cross-references:** `app/(org)/conversations/page.tsx`; `actions/conversations.ts:createGroupConversation` (existing, can be reused with the new entry point)

---

## DEBT-042 — Functional index `lower(clients.email)` if seq-scan dominates auth-callback latency
**Added:** 10 May 2026 (DEBT-037 hotfix follow-up)
**Codebase:** SaaS
**Severity:** Low
**Type:** Performance

**The debt:** `resolvePostAuthIdentity` in `lib/auth/postAuthResolve.ts` looks up `clients` by `lower(email) = lower($1)` for case-insensitive match (defends against legacy mixed-case `clients.email` rows). The `idx_clients_email` index is on `email` (not `lower(email)`), so this lookup uses a sequential scan. Acceptable at current scale (~10s of clients rows) but linear-cost as `clients` grows.

**Why it exists:** Adding a functional index would have been a schema change, out of DEBT-037 hotfix scope (Hard Rule: no schema changes in the hotfix). Auth-callback latency at current scale is ~10ms total — seq-scan cost is negligible.

**Cost of leaving it:** Auth callback latency grows linearly with `clients` row count. At 10K clients, scan likely dominates the callback's 50ms budget. Once it does, this becomes user-visible login lag.

**Fix sketch:** Add migration creating `CREATE INDEX idx_clients_email_lower ON clients (lower(email)) WHERE deleted_at IS NULL`. Update `lib/auth/postAuthResolve.ts` to ensure the lower() expression uses the index. RLS test addition not needed (no policy change). ~30 min including the migration + smoke verification via EXPLAIN ANALYZE.

**Trigger:** Either (a) `clients` row count exceeds 5K (track via periodic check), or (b) Sentry traces show auth-callback p95 latency >100ms.

**Cross-references:** ADR-031, `lib/auth/postAuthResolve.ts`, `db/schema/clients.ts:36-42` (current index)

---

## DEBT-041 — `/select-context` page for dual-context users (Phase 1c)
**Added:** 10 May 2026 (DEBT-037 hotfix follow-up)
**Codebase:** SaaS
**Severity:** Low
**Type:** UX / Deferred decision

**The debt:** ARCHITECTURE-saas.md §8's documented login decision tree includes a `/select-context` route for users with both `users` and `clients` rows ("dual_context"). This route does not yet exist. The DEBT-037 hotfix's `pickDestination` helper currently defaults dual-context users to `/dashboard` (team-context bias), with the user able to navigate to `/portal/projects` via direct URL.

**Why it exists:** Dual-context UX is Phase 1c work; the §8 spec written in Phase 1a anticipated it but the implementation was deferred. DEBT-037 hotfix's locked scope explicitly excluded this.

**Cost of leaving it:** Dual-context users (architect with own firm + stakeholder on partner firm's project) don't get a clean "switch context" UI. They have to URL-type. Likely rare cohort pre-launch; commercially relevant once architect customers refer each other.

**Fix sketch:** New route `/select-context` rendering both contexts (firm name + role + recent activity preview). Sets cookie remembering last-chosen context. Update `pickDestination` to route `dual_context` to `/select-context`. Update `app/(org)/layout.tsx` and `app/portal/layout.tsx` to surface a context-switcher chip in the header. ~half day including tests.

**Trigger:** Session 11 (notifications + activity) — natural bundle with DEBT-040.

**Cross-references:** ADR-031, ARCHITECTURE-saas.md §8 (decision tree), `lib/auth/postAuthResolve.ts:pickDestination`

---

## DEBT-037 — Stakeholder accounts silently become org owners on sign-in
**Added:** 10 May 2026 (Session 10 / production smoke test)
**Codebase:** SaaS
**Severity:** HIGH (was HOTFIX-flagged before resolution)
**Type:** Bug — security / product
**Status:** Resolved 10 May 2026 (commit 0565777, PR #7) — see ADR-031

**The debt:** Signing in fresh as a user who has only a `clients` row (stakeholder, not an org member) auto-creates an organization and makes them the owner. Confirmed end-to-end via production smoke test 10 May 2026: stakeholder `sarhads@plancraftdaily.co.uk` signed in incognito, was routed to `/dashboard` with a freshly-spawned org, created a project, invited `saliqueh@plancraftdaily.co.uk` as stakeholder. Saliqueh's portal then showed the new project from the auto-spawned org. **Three things happened that should not have:** (a) a stakeholder became an autonomous tenant, (b) an org was created without an explicit signup intent, (c) the new "owner" gained the ability to invite other users into a tenancy they shouldn't control.

**Why it exists:** Suspected. Auth callback or middleware checks `org_memberships` only when deciding routing. If empty → spawns a new org + routes to `/dashboard`. The check doesn't first look at `clients` table to detect "this auth user is a stakeholder, route them to `/portal`." This is the same root cause as the milder DEBT-034 ("stakeholder routing UX"), but the actual impact is silent org creation, not just a wrong landing page — DEBT-037 supersedes DEBT-034 with the corrected severity.

**Cost of leaving it:**
- **Security/product:** silent org creation as a side effect of sign-in. Stakeholders accidentally gain owner-level powers in tenancies that shouldn't exist.
- **Billable usage potential:** every stakeholder signing in spawns a new "Solo Free" org row. If billing ever ties to org count (Phase 6 Stripe), this is a leak.
- **Data integrity:** the auto-spawned orgs have no real billing intent, no settings, no business identity — they're orphan tenancies that pollute `organizations` and any analytics/admin reports.
- **User confusion:** the user thinks "I just signed in to view my portal" but ends up in a dashboard for an org they didn't create. UX at minimum, trust-violating at worst.

**Fix sketch:** In the routing/onboarding middleware (likely `middleware.ts` or `actions/auth/*`), after auth resolution, check identities in priority:
1. Has rows in `users` (org member) → `/dashboard`
2. Has rows in `clients` but no `users` rows → `/portal`
3. Has rows in NEITHER → onboarding flow that asks the user explicitly which they are (org-create vs. accept-invitation). **Do not silently spawn an org.**

Likely also need to audit `actions/orgs.ts createOrganization` for any callers that fire on auth callback rather than explicit user intent. ~2-4 hours investigation + fix + targeted Phase F walk to confirm fixed (incognito sign-in as a stakeholder → /portal, no new org row).

**Trigger:** **HOTFIX before Session 11 starts.** Don't kick Session 11 off until this is resolved. Production currently has at least one auto-spawned org from the smoke-test session — that row + any others should be identified and cleaned up via service-role SQL once the routing fix lands (audit step in the hotfix session).

**Resolution (10 May 2026):** Hotfix PR #7 (commit `0565777`, pre-fix tag `pre-debt-037-hotfix` at `8ac9c0c`) restored the §8 contract. Three invariants enshrined in ADR-031: `createOrganization` requires `intent='wizard_signup'` Zod literal; all post-auth routing flows through new `lib/auth/postAuthResolve.ts:pickDestination` helper; auth callback only links `clients.auth_user_id` (idempotent + anti-hijack), never inserts into orgs/users. Phase F walk on Vercel preview confirmed all three §8 identities route correctly (stakeholder-only → /portal/projects, net-new owner → /onboarding → /dashboard, dual-context Sarah Step 2 → /portal/projects then /onboarding → /dashboard with `dual_context_signup=true` audit metadata). Production cleanup script `scripts/cleanup-debt-037-orphan-orgs.ts` shipped — dry-run identified 2 candidate orgs (PCD/sarhads@ + Plan Daily/saliqueh@), both have activity → both protected by per-row pre-flight, manual product judgment required for each (not auto-cleanup). New SKILL.md Hard Rule 25 added (`pickDestination` centralization); v3.4 → v3.5.

**Cross-references:** DEBT-034 (this supersedes — milder UX framing was an undercount of severity); production smoke test 10 May 2026 (sarhads@/saliqueh@ pair); `middleware.ts`; `actions/auth/*`; `actions/orgs.ts createOrganization`; ADR-009 (single-clients-row guarantee — the basis for stakeholder identity resolution); ADR-031 (closure ADR — three invariants enshrined); commit `0565777` (PR #7); `lib/auth/postAuthResolve.ts`; `tests/actions/auth-callback.test.ts`; `docs/debt-037-investigation.md`; `scripts/cleanup-debt-037-orphan-orgs.ts`

---

## DEBT-035 — File restore UI surface
**Added:** 10 May 2026 (Session 10 / Phase F Step 13 marked N/A)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision

**The debt:** `restoreFile` server action exists in `actions/files.ts` (org-admin-only, clears `deleted_at` + audit-logs `restore`) but no UI surface exposes it. Once a file is soft-deleted via `softDeleteFile`, an admin currently has to undo it via service-role SQL or Supabase Studio.

**Why it exists:** Session 10 scope shipped the action layer to keep the server-side contract complete (mirroring Phase 1b's restore patterns on workflows + projects + stakeholders) but didn't carve room for the admin recycle-bin UI. Phase F Step 13 ("Hasnath restores via recycle bin or admin path") was marked N/A because no UI exists.

**Cost of leaving it:** Stakeholders/org users who soft-delete a file by mistake have no in-app recovery path. Workaround is admin-managed via DB. Friction grows as files become a high-traffic surface — pre-launch this is unsustainable.

**Fix sketch:** Add a `/dashboard/projects/[id]/files/recycle` page (org admin only) that lists soft-deleted `project_files` rows with a "Restore" button calling `restoreFile`. ~2 hours including test coverage. Could also bundle into a future "admin" panel that includes other admin recovery flows.

**Trigger:** Pre-launch operational pass (alongside DEBT-006 items) OR sooner if any production user reports an accidental soft-delete.

**Cross-references:** `actions/files.ts:restoreFile`; SESSION-10-HANDOVER.md Phase F Step 13; ADR-022 (soft-delete + admin restore convention)

---

## DEBT-034 — Stakeholder routing UX (clients with both `users` and `clients` rows)
**Added:** 10 May 2026 (Session 10 / Phase F observation)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Deferred decision
**Status:** Resolved 10 May 2026 — superseded by DEBT-037, which was closed by hotfix PR #7 commit `0565777` (ADR-031). The routing fix addresses both the original UX framing (this entry) and the actual security/product bug (DEBT-037). Original SUPERSEDED context: production smoke test surfaced the actual root cause as silent org creation, not just routing UX; severity was undercounted at Phase F and corrected to HIGH under DEBT-037.

**The debt:** Stakeholders who have both a `users` row (e.g. they joined an org as a team member) AND a `clients` row (they were also invited as a stakeholder on someone else's project), or first-time stakeholders, route to `/dashboard` after sign-in instead of `/portal`. RLS still blocks data exposure across contexts, but the destination UI is wrong for the stakeholder context. Phase F observed this on Sarah's account and noted "data pollution from test fixtures" — but the underlying routing logic is the actual bug.

**Why it exists:** `requireOrgUser` resolves first (favouring `users` row presence); only if the auth user has zero `users` rows does `requireStakeholder` get a chance. There's no "active context" notion the way `active_org_id` exists for multi-org users. Acceptable for Phase 1b (no real stakeholders yet) but Session 10's two-sided file flow makes the gap user-visible.

**Cost of leaving it:** UX-only — stakeholders see an org-side dashboard they don't belong in (RLS strips the data so they see "no projects"); they'd have to manually navigate to `/portal/projects`. Friction at launch when real stakeholders sign up. Not a security issue.

**Fix sketch:** Two options. (a) After auth, add a route resolver that checks for `clients` row + `client_org_memberships` and prefers `/portal` if the user has at least one stakeholder relationship and the URL doesn't explicitly point elsewhere. (b) Add a context-switcher header chip ("Org view ↔ Portal view") for users who hold both identities, defaulting to whichever was used last. Option (a) is cleaner for the typical case; (b) handles the edge case of someone who's both a team member AND a stakeholder. ~2-3 hours for (a), ~half-day for (b).

**Trigger:** Pre-launch (before first commercial onboarding). If launch is delayed and the dogfood phase is short, can defer to Phase 2.

**Cross-references:** `lib/auth/requireAuth.ts:requireOrgUser`; SESSION-10-HANDOVER.md Phase F observations; ADR-009 (single-clients-row guarantee — the basis for the routing decision)

---

## DEBT-033 — `messages.attachments` Zod widening deferred
**Added:** 10 May 2026 (Session 10)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision

**The debt:** Per Session 9 inherited assumption #2, the `sendMessage` Zod schema was supposed to be widened in Session 10 to accept file metadata in the `attachments` array (currently `z.array(z.unknown()).max(0).default([])` — explicit empty-only). Session 10 shipped file uploads as a standalone surface; the message-attachment integration was decoupled from scope.

**Why it exists:** Session 10 scope was already at the upper end of a single session (~6-7 hours focused). Wiring `messages.attachments` would have required: extending the Zod schema, the message composer UI to support file picking, the message bubble UI to render file links, an action to validate the attached `file_id` belongs to a file the sender uploaded on the same conversation's project. Decoupling kept Session 10 shippable.

**Cost of leaving it:** Users can't drag a file into a conversation thread the way Slack/Teams users expect. Workaround is upload-then-mention in two steps. Discoverability gap, not a security one. Increases chance of broken cross-references if a file is soft-deleted while still referenced in a message body.

**Fix sketch:** (a) Extend `SendMessageInput` Zod with `attachments: z.array(z.object({ fileId: z.string().uuid() })).max(5)`. (b) Action validates each fileId via `project_files` SELECT (RLS auto-filters to caller-visible rows on the conversation's project). (c) Composer adds a paperclip button + file picker that calls `createUploadUrl`/`confirmUpload` then references the resulting fileId. (d) Bubble renders inline file chips with download links. ~4-6 hours including tests.

**Trigger:** Session 11 if notification dispatch needs file metadata in message payloads. Otherwise opportunistic when next polishing the conversation UI.

**Cross-references:** SESSION-9-HANDOVER.md Inherited Assumption #2; `actions/messages.ts:SendMessageInput`; `actions/files.ts`

---

## DEBT-032 — Thumbnail + PDF preview generation deferred
**Added:** 10 May 2026 (Session 10 / decision 10.3 revised at plan time)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision

**The debt:** Original Session 10 brief called for image thumbnails + PDF first-page previews generated either synchronously in `confirmUpload` (small images <5 MB) or asynchronously via Vercel Cron / Edge Functions (PDFs + larger images). Dropped from scope at plan time; file rows show generic lucide mimetype icons. `project_files.thumbnail_path` column kept nullable so a future session can populate it without a migration.

**Why it exists:** Library investigation surfaced three blockers: (1) `pdf-poppler` requires native libpoppler — won't link on Vercel serverless; (2) `pdfjs-dist` is pure-JS but ~5 MB function bundle + slow per-page rendering; (3) async pipeline (Cron / Inngest) is net-new infrastructure not yet shipped, adding ~150 LOC + observability surface. Decision 10.3 was revised at plan time (user-confirmed) to drop preview generation entirely; mimetype icons make the file list usable without thumbnails. Phase F confirmed the descope is acceptable for Session 10 ship.

**Cost of leaving it:** UX gap — users can't tell at a glance which file is which without opening it. Mitigated by filename + uploader + date in the row. Becomes more visible once a project accumulates 10+ files. Not a blocker; lucide icons cover the mime-type-family signal (PDF / image / spreadsheet / archive distinguishable).

**Fix sketch:** Pick one approach and ship in a follow-up session. (a) Sync image-only thumbs in `confirmUpload` using `sharp` (Next.js already bundles it for Image optimization) — handles JPG/PNG/WebP <5 MB; ~2 hours. (b) Defer PDFs to a server-side worker via Inngest or Trigger.dev that runs `pdfjs-dist` outside Vercel function limits; ~1 day including infra setup. Probably (a) first as a quick win, then (b) if customer feedback demands PDF previews.

**Trigger:** Customer feedback after launch ("I can't tell my drawings apart"), OR opportunistically when a future session needs a worker pipeline anyway (Inngest for notifications could host PDF rendering as a side-effect).

**Cross-references:** ARCHITECTURE-saas.md §12.4 (`thumbnail_path` column); SESSION-10-HANDOVER.md decision 10.3 revision; commits `67efdb4` (column), `bcb24d8` (lucide icons); `components/files/FileRow.tsx:iconForMime`

---

## DEBT-031 — No unread badge in conversation nav
**Added:** 09 May 2026 (Session 9 / Phase F Step 11)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision

**The debt:** Top nav links (PCD / Projects / Conversations / Team / Settings) are plain text with no unread-count indicator next to "Conversations." The conversation list itself sorts by recency but has no visual read/unread distinction.

**Why it exists:** ADR-026 added `last_read_at` on `conversation_participants`, the `markConversationRead` server action is wired up, and `useConversationMessages` is in place — but no UI consumer surfaces unread count in nav OR a per-conversation unread indicator on list rows. Session 9 scope ended at "data layer ready"; the badge surface was deferred.

**Cost of leaving it:** Users won't notice new messages without re-opening `/conversations`. UX gap, not a bug. Becomes painful once project volume grows past a handful.

**Fix sketch:** Add `/api/conversations/unread-count` endpoint returning count where `last_read_at < last_message_at` for the current user/client. Subscribe via SWR or server-component poll. Render a numeric badge on the Conversations nav item. Bold/dot indicator on each list row where unread > 0. ~2 hours.

**Trigger:** Session 11 (notifications + activity) — natural fit since both surface unread state.

**Cross-references:** ADR-026 (last_read_at column); Session 11 notifications roadmap; `markConversationRead` action; Phase F Step 11

---

## DEBT-030 — Project detail UI doesn't link to conversations
**Added:** 09 May 2026 (Session 9 / Phase F Step 4 setup); file portion resolved 10 May 2026 (Session 10 commit `bcb24d8`)
**Codebase:** SaaS
**Severity:** Low
**Type:** Deferred decision
**Status:** Open (file portion resolved Session 10; conversations deep-link portion remains)

**The debt:** ~~Both `/projects/[id]` (org-side) and `/portal/projects/[id]` (portal-side) project detail pages still show "Coming soon — Messages and files land in the next sessions" placeholder.~~ **Updated 10 May 2026:** Session 10 replaced the file-sharing placeholder on both surfaces with the actual `FileList` + `FileUploadZone`. The remaining open item is the conversations deep-link from project detail — both surfaces have file UI now but still don't link to per-project conversation views.

**Why it exists:** Session 9 shipped messaging as a top-level surface and didn't update the placeholder OR add deep-link buttons. Two design questions deferred: do project detail pages embed a per-project conversation list, or deep-link to the standalone surface filtered by `project_id`?

**Cost of leaving it:** Users navigate to a project, see file UI but no messaging surface, don't realize per-project conversation context is one extra click away on `/conversations?project_id=X` (which already filters by URL param). Discoverability gap; not a security/data problem.

**Fix sketch:** Two options. (a) Replace with embedded `ConversationsInbox` component filtered to the project's conversations (~3 hours). (b) Add a button "Open project conversations" linking to `/conversations?project_id=X` (~1 hour). Option (a) is more cohesive UX; (b) is faster. Session 10 declined to bundle this since the file-list addition already grew the project detail page significantly.

**Trigger:** Session 11 — notification dispatch will need per-project deep-links anyway; bundle the cleanup.

**Cross-references:** ARCHITECTURE-saas.md §12.4; Session 10 commit `bcb24d8` (file portion resolved); Session 11 notifications roadmap; Phase F Step 4 setup

---

## DEBT-029 — Realtime subscription not auto-updating message UI
**Added:** 09 May 2026 (Session 9 / Phase F Step 7)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Bug

**The debt:** When a stakeholder sends a message in the portal, the org-side conversation page does NOT auto-update — manual refresh required to see new messages. Confirmed bidirectional (same on portal side when org sends). Phase F Step 7 marked FAIL.

**Why it exists:** Suspected. The `useConversationMessages` hook subscribes to `postgres_changes` on the `messages` table filtered by `conversation_id`. INSERTs aren't triggering re-renders. Possible causes: (1) channel auth context lost on subscription, (2) filter syntax incorrect, (3) hook lifecycle / unmount timing, (4) Realtime publication not configured for the messages table, (5) RLS interaction — Realtime checks RLS on subscribe; if the policy uses helper functions in `auth_user_orgs()` not yet visible to the subscriber, the subscription silently rejects.

**Cost of leaving it:** Messaging feels broken at first impression — users assume their messages aren't being sent. Critical UX paper-cut for a real-time-feel feature. Not a security issue.

**Fix sketch:** (1) Confirm Realtime is enabled for `messages` in Supabase dashboard. (2) Manually trigger a `postgres_changes` event via `supabase` CLI to see if the subscription receives anything. (3) If silent, log `onSubscribe` state to detect channel join failure. (4) Verify RLS allows the subscriber to see the rows. 30–60 min investigation + fix.

**Trigger:** Session 11 (notifications + activity) — same realtime infrastructure; bundle the diagnosis with notification work.

**Cross-references:** ADR-027 (system messages stored in messages); Session 11 notifications roadmap; Supabase Realtime + RLS docs; `hooks/use-conversation-messages.ts`; Phase F Step 7

---

## DEBT-028 — OrbStack idle auto-shutdown breaks test runs
**Added:** 09 May 2026 (Session 9 / Phase F)
**Codebase:** SaaS (test infrastructure)
**Severity:** Low
**Type:** Operational / Tooling

**The debt:** Mid-session, `npm run test:actions` failed with "no tests found" / 15 test files reporting 0 tests. Cause: OrbStack had idle-shut-down between an earlier verification and the next run, so local Supabase containers weren't running. Recovery required `open -a OrbStack` + waiting for containers + re-running.

**Why it exists:** The test runner doesn't precondition on Docker / Supabase being up. Silent fall-through to "no tests" instead of a clear "infrastructure not ready" error.

**Cost of leaving it:** ~5 min of confusion per occurrence. Hits during long sessions where tests run multiple times across breaks. Wasted time tracking down a non-issue, plus risk of mistaking infra failure for code regression.

**Fix sketch:** (a) Add a `pretest` hook that checks `docker ps` and starts OrbStack if not running (~30 min). (b) Move action tests to a connection-pooled cloud test database (non-prod), removing the local Docker dependency entirely (several hours + DB provisioning). Option (a) is the right starting point; (b) is the correct long-term answer for CI consistency.

**Trigger:** When this bites a third time, or as part of a broader test-infra polish pass.

**Cross-references:** Vitest config; `.github/workflows/rls-gate.yml`; `tests/setup.ts:72`

---

## DEBT-027 — `sql<Date | null>` annotations are runtime liars
**Added:** 09 May 2026 (Session 9 / Phase F)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Bug / Deferred decision

**The debt:** Phase F caught `TypeError: x.getTime is not a function` thrown when sorting/comparing conversation `lastMessageAt`. Two instances patched at point-of-use (commit `9fc485b` in `db/queries/conversations.ts`, commit `3e650b4` in `components/conversations/ConversationsInbox.tsx`). Underlying type-honesty bug remains: `db/queries/conversations.ts:66` and `:221` use `sql<Date | null>` annotation on raw SQL subqueries. Drizzle's column-level type coercion only runs for properly mapped table columns, NOT for `sql<>`-tagged expressions inside subqueries. Postgres `timestamptz` returned via raw `sql` comes back as ISO string at runtime. TypeScript trusts the annotation, so the lie propagates downstream into `ConversationListItem.lastMessageAt: Date | null`.

**Why it exists:** Convention from Phase 1a — author trusted the `sql<>` generic to round-trip the type. No precedent had exposed the gap because earlier `sql<>` uses returned scalar types that were already strings/numbers. Tests didn't catch it because action/RLS test fixtures construct `Date` objects directly; the bug only manifests against real Postgres connections, where the value is an ISO string. Phase F caught it because the preview deploy hits real cloud Supabase.

**Cost of leaving it:** Any future `.getTime()` / `.toISOString()` / `.toLocaleString()` consumer on these fields will crash again. Same pattern likely lurks in any other `sql<Date>` usage shipped in the future. Class of bug, not a one-off.

**Fix sketch:** Two options. (a) Tighten the `sql<>` annotation to `sql<string | null>`, change `ConversationListItem.lastMessageAt` to `Date | string | null`, coerce at every consumer. (b) Coerce inside the query result `.map()` block — `new Date(r.lastMessageAt)` — so the public type stays honest as `Date | null`. Option (b) is cleaner: confines the lying to one boundary. 1–2 hours.

**Trigger:** Next time a developer adds a `.getTime()` / Date-method consumer, OR opportunistically before Phase 1c S11 starts. Latent foot-gun until then.

**Cross-references:** Commits `9fc485b`, `3e650b4` (point-of-use patches); ARCHITECTURE-saas.md §16.4 (Drizzle ORM conventions); `db/queries/conversations.ts:66`, `:221`

---

## DEBT-025 — Sentry user/org context not attached to scope
**Added:** 09 May 2026 (Session 9 / Phase F)
**Codebase:** SaaS
**Severity:** Low
**Type:** Operational / Documentation

**The debt:** Sentry events from Phase F crashes had no `user_id` or `org_id` tags. Sentry's "Users affected" count showed 0 for real crashes that affected the test user. Production triage will be harder without these.

**Why it exists:** Sentry initialization in `instrumentation.ts` and the client config doesn't currently set user/org context on the Sentry scope after auth resolution. The auth helpers (`requireOrgUser`, `requireAuth`) return user data but don't push it into Sentry.

**Cost of leaving it:** Production incidents land with no user/org attribution. Can't filter Sentry events by org for tenant-specific triage. Friction every time we triage a real bug post-launch. Gets more expensive as customer count grows.

**Fix sketch:** In `instrumentation.ts` server hook, after middleware auth resolution, call `Sentry.setUser({ id: authUser.id, email })` and `Sentry.setTag('org_id', activeOrgId)`. Mirror in client-side Sentry config via a `useEffect` in the dashboard layout. ~30 min.

**Trigger:** Pre-launch operational pass (alongside DEBT-006 items).

**Cross-references:** `instrumentation.ts`; `lib/auth/require-org-user.ts`; SKILL.md Hard Rule 18 (cloud-vs-local divergence — related observability concern)

---

## DEBT-024 — Resend free-tier domain restriction
**Added:** 09 May 2026 (Session 9 / Phase F)
**Codebase:** SaaS
**Severity:** Medium
**Type:** Operational / Deferred decision

**The debt:** Invitations to recipients outside the verified Resend domain (e.g. arbitrary `@gmail.com` addresses) fail with HTTP 403 from Resend. Toast says "email could not be delivered." Partially mitigated by commit `6bba94b` (switched from-address to `noreply@plancraftdaily.co.uk`, the verified domain), which unblocks sends TO non-owner addresses at the verified domain. Sends to gmail/outlook/etc. external addresses still require Resend paid tier OR per-recipient verification allowlist OR account owner address.

**Why it exists:** Resend free tier blocks sends to recipients that aren't (a) the account owner email or (b) at the verified sending domain — regardless of from-address. We were sending from `onboarding@resend.dev` (test sandbox), which compounded the restriction to "account owner only." Phase F surfaced both layers; the from-address half is fixed, the recipient-restriction half remains.

**Cost of leaving it:** Pre-launch — none (no real customers receiving mail). At launch — impossible. Every customer invitation that goes to an external address (clients, stakeholders, contractors with their own domains) silently 403s. Hard blocker for first commercial onboarding.

**Fix sketch:** Upgrade Resend to paid tier ($20/mo) before onboarding the first real customer. Add `RESEND_FROM_ADDRESS` env var override in Vercel for staging/preview environments if a different sender is desired. ~30 min ops + payment setup.

**Trigger:** Pre-launch operational pass (alongside DEBT-006 items).

**Cross-references:** ADR-006 (email transport); commit `6bba94b` (partial mitigation); SESSION-9-HANDOVER.md Phase F findings; DEBT-006

---

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

## DEBT-R015 — Project-create form doesn't send invitation emails
**Resolved:** 15 May 2026 in commit `299beef` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Medium → Resolved
**Type:** Bug (was DEBT-038)

**The debt was:** `actions/projects.ts:createProject` inserted a `project_stakeholders` row inline (with `acceptedAt: new Date()`) when given a `clientId`, but it skipped the invitation email entirely. Stakeholders attached at project-create time were silently added — they never received the magic-link email telling them they had access. The workaround was to delete + re-invite from the project detail page (which routes through `inviteStakeholder` and sends the email correctly). Caught by the 10 May 2026 production smoke test.

**Resolution:** `createProject` now inserts only the `projects` row in its transaction and delegates stakeholder attachment to `inviteStakeholder` post-commit. When `clientId` is supplied, the action looks up the client's email/name/phone/companyName/companyType from the `clients` table and calls `inviteStakeholder({ projectId, …, role: 'primary_client', visibilityProfile: 'full' })`. `inviteStakeholder` runs its full canonical flow — atomic `project_stakeholders` + `invitations` + auto-create general conversation + activity log inside its own tx, then post-tx the magic-link email (Resend), notification dispatch, and audit log.

Two behavioural changes worth flagging:

1. **`acceptedAt` is now `null` on first attach** (was `new Date()`). The stakeholder must click the magic link to flip to accepted. This matches the contract the project-detail "Invite" path already used. The org-side `listStakeholdersForProject` query doesn't filter on `acceptedAt`, so the `/dashboard/projects` UI is unchanged. The portal-side queries in `db/queries/portal-projects.ts` already filtered `isNotNull(projectStakeholders.acceptedAt)` — so a stakeholder added at project-create time won't see the project in `/portal/projects` until they click the email link. Consistent with how a normal invite from the project detail page worked.
2. **Project + stakeholder are no longer one tx.** If `inviteStakeholder` fails after the `projects` row commits (rate limit, transient DB issue, Resend down), `createProject` returns `success: true` with a new `data.stakeholderWarning: 'invite_failed'` field. `ProjectCreateForm` consumes this and surfaces a `toast.warning` ("Stakeholder invitation didn't send. You can re-invite from the project page.") so the user can re-invite manually.

3 new regression tests in `tests/actions/projects.test.ts`: (1) clientId triggers `sendEmail` with `template='stakeholder_invitation'` — the load-bearing assertion (this is the email-send signal that was missing pre-fix and the precondition for the `outbound_emails` row the DEBT entry referenced), (2) no clientId sends no email, (3) a rejected `sendEmail` surfaces `stakeholderWarning='invite_failed'` to the caller. The existing happy-path test required adding `sendEmail` / `sentry` / `ratelimit` mocks since it now passes through `inviteStakeholder`. Phase F verified end-to-end on Vercel preview: project created with fresh-email stakeholder → invitation email arrived → stakeholder signed up → magic-link auto-confirmed → stakeholder landed in portal with project visible.

**Cross-references:** commit `299beef`; `actions/projects.ts:createProject`; `actions/stakeholders.ts:inviteStakeholder`; `components/projects/ProjectCreateForm.tsx`; `tests/actions/projects.test.ts`; production smoke test 10 May 2026; DEBT-063 (invitation landing page Sign up vs Sign in disambiguation — surfaced during this fix's Phase F walk)

---

## DEBT-R014 — Multi-file selection via file picker fails
**Resolved:** 15 May 2026 in commit `6dbde00` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Medium → Resolved
**Type:** Bug (was DEBT-039)

**The debt was:** Selecting 2-3+ files via the "Choose files" button in `FileUploadZone` silently dropped every file beyond the first. Drag-drop with the same set of files worked. Bulk-upload flows were broken on the click path.

**Resolution:** The DEBT-039 hypotheses ("missing `multiple` attribute" / "click handler reads `[0]`") were both false — `<input multiple>` was set and both handlers already routed through `handleFiles(fileList)`. Actual root cause: `input.files` is a **live** FileList tied to the input element. The click handler invoked `void handleFiles(e.target.files)` followed synchronously by `inputRef.current.value = ''` (the existing line that lets re-selecting the same file fire `onChange` again). `handleFiles` ran synchronously up through its first `await uploadOne(file)` (reading file 0); control returned; the value-reset emptied the live FileList; when the await resolved and the loop checked `i < fileList.length`, length was now 0 and the loop exited. Drag-drop was unaffected because `dataTransfer.files` is a separate, non-live FileList.

Fix: snapshot the FileList to a plain `File[]` array at both handler boundaries (`Array.from(e.target.files)`, `Array.from(e.dataTransfer.files)`) so the iteration is decoupled from the input element. Extracted the iteration loop into `components/files/upload-helpers.ts:uploadBatchSequentially` so it's unit-testable from Vitest's Node environment without a React render tree; `handleFiles` in `FileUploadZone` is now a one-line wrapper. 3 unit tests cover ordered iteration, the load-bearing async-iteration regression (the exact case the bug produced), and empty-batch tolerance. Phase F verified on Vercel preview by selecting 3 files via the picker and confirming all 3 land in the upload queue.

**Cross-references:** commit `6dbde00`; `components/files/upload-helpers.ts` (new); `components/files/FileUploadZone.tsx`; `tests/actions/upload-helpers.test.ts`; production smoke test 10 May 2026

---

## DEBT-R013 — File download opens in new tab instead of saving
**Resolved:** 15 May 2026 in commit `f0806dd` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** Bug / UX (was DEBT-036)

**The debt was:** `actions/files.ts:getDownloadUrl` minted a signed URL with no Content-Disposition hint. Supabase Storage's default behaviour served PDFs and images inline, so clicking the FileRow download icon opened the file in a new tab rather than triggering a save dialog. Caught by the 10 May 2026 production smoke test.

**Resolution:** Per the kickoff fix sketch option (b) — server-side, central: pass `{ download: file.originalFilename }` to `createSignedUrl(path, expiresIn, options)`. Supabase Storage appends `?download=<encoded-filename>` to the signed URL and responds with `Content-Disposition: attachment; filename="<originalFilename>"`. The browser now saves regardless of MIME type, using the original filename. `FileRow.handleDownload`'s `window.open(url, '_blank')` is unchanged — its existing comment ("Browser handles the download based on Content-Disposition header from Supabase Storage") is now factually accurate. One regression test in `tests/actions/files.test.ts` asserts the returned `downloadUrl` exposes the disposition param via `URL.searchParams.get('download')`. Phase F verified by downloading a PDF and confirming a browser Save dialog instead of an inline preview tab.

**Cross-references:** commit `f0806dd`; `actions/files.ts:getDownloadUrl`; `tests/actions/files.test.ts`; `components/files/FileRow.tsx:handleDownload`; production smoke test 10 May 2026

---

## DEBT-R012 — Conversation thread empty-state layout pushes input to bottom
**Resolved:** 15 May 2026 in commit `2dfb28c` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** UX (was DEBT-054)

**The debt was:** `ConversationDetailClient.tsx` used a single full-height flex layout (`h-[calc(100vh-12rem)]` + `flex-1` on the message scroll area) for all states. When the message list was empty, the flex-1 div still reserved every available pixel, pushing the composer to the viewport bottom — visually disconnected from the empty-state copy. First-message UX was slightly awkward.

**Resolution:** Added an early-return compact layout for the fully-loaded empty case (`!loading && !error && messages.length === 0`) — empty-state copy stacked directly above the composer with simple `space-y-3` padding, no flex-fill. As soon as the thread has any message (or while loading / on error), the existing full-height layout takes over. The auto-scroll and mark-read effects already short-circuit on empty threads, so swapping which JSX subtree renders has no behavioural effect on those paths — only the visual layout changes. Phase F verified on Vercel preview by opening a newly-created empty conversation.

**Cross-references:** commit `2dfb28c`; `components/conversations/ConversationDetailClient.tsx`

---

## DEBT-R011 — "Direct" conversation label misleading with 3+ participants
**Resolved:** 15 May 2026 in commit `016f39e` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** UX (was DEBT-052)

**The debt was:** `ConversationsInbox.tsx:deriveTitle` switched on `conversation.type` to label rows in the inbox. `type` is set at row-creation time and never mutated — when a `one_to_one` thread gained a third participant via `addConversationParticipant`, the inbox row continued labeling itself "Direct" forever. The data and the label drifted.

**Resolution:** Extracted `deriveTitle` to `components/conversations/deriveTitle.ts` so the function is unit-testable from the Node Vitest environment without pulling the client component's JSX import chain through. Rewrote per the kickoff fix sketch option (b): label from the current participant count, not `type`. Logic — explicit name override wins; `general` threads join other-participant names ("General" fallback); `participantNames.length ≤ 2` → join other names ("Direct" fallback); 3+ → "Group". The `type` column is now history-only. 7 unit tests in `tests/actions/derive-title.test.ts` cover all branches; the load-bearing assertion: a 3-participant thread with `type='one_to_one'` labels as "Group." Phase F verified by adding a 3rd participant to a one_to_one thread and confirming the inbox row's label flipped from "Direct" to "Group."

Two intentional scope limits: (1) the `TYPE_LABELS` Badge in the same component still reads `c.type` — same bug class, fix would have been mechanical, but kicked out per Hard Rule 1 ("no scope expansion"). (2) the conversation **detail page heading** (separate title source) also still shows "Direct" for promoted 1:1 threads — observed during Phase F. Both could be follow-up DEBTs if a user-driven signal makes them urgent; not yet warranted.

**Cross-references:** commit `016f39e`; `components/conversations/deriveTitle.ts` (new); `components/conversations/ConversationsInbox.tsx`; `tests/actions/derive-title.test.ts`; `actions/conversations.ts:addConversationParticipant`; ADR-026

---

## DEBT-R010 — "Create your own firm" link on /portal/projects for dual-context discoverability
**Resolved:** 15 May 2026 in commit `0796a9b` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** UX / Deferred decision (was DEBT-040)

**The debt was:** ADR-031 made `/onboarding` accept dual-context callers (a stakeholder creating their own firm — the Sarah-Step-2 cohort) but no UI affordance pointed stakeholders at the path. The DEBT-037 hotfix scope was locked to routing + guard, leaving the UX bridge open.

**Resolution:** Added a bottom CTA Card on `/portal/projects` ("Running your own firm?") with a soft "Create your own firm" button linking to `/onboarding?from=portal`. On the wizard side, `OnboardingStartPage` now reads the `from` searchParam (Next 15 async pattern) and passes a `fromPortal` prop to `OrgTypePicker`, which renders a muted banner above the firm-type cards reassuring the stakeholder that their existing access stays intact. The `dual_context_signup` audit metadata was already firing inside `createOrganization` for callers with a pre-existing `clients` row — no audit change needed; this is the matching UX. Phase F verified the click-through from portal projects → onboarding banner → firm-type picker.

**Cross-references:** commit `0796a9b`; `app/portal/projects/page.tsx`; `app/(onboarding)/onboarding/page.tsx`; `components/onboarding/OrgTypePicker.tsx`; ADR-031; ARCHITECTURE-saas.md §8

---

## DEBT-R009 — Stakeholder portal nav missing Settings link
**Resolved:** 15 May 2026 in commit `65166c3` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** UX (was DEBT-051)

**The debt was:** Session 11 Phase 9 added `/portal/settings/notifications` (stakeholder notification preferences) but the portal nav (`app/portal/layout.tsx`) had no link to it. Stakeholders had to know the URL or paste it in manually.

**Resolution:** Added a "Settings" `<Link>` to the portal nav after the bell-icon notifications link, matching the existing "My projects" link's pattern (plain text, hover state, no badge). Phase F verified the link is visible and clicks land on `/portal/settings/notifications`.

**Cross-references:** commit `65166c3`; `app/portal/layout.tsx`

---

## DEBT-R008 — Misleading "check email to confirm" copy on stakeholder signup form
**Resolved:** 15 May 2026 in commit `4aaf79b` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** UX / Copy (was DEBT-050)

**The debt was:** `/signup?invitation=<token>` (the stakeholder signup form linked from the invitation email) showed "Check your email to confirm your account" post-submit. Supabase Auth auto-confirms via the magic-link, so stakeholders were already signed in by the time the message rendered — the copy told them to do something they didn't need to do, leading to confusion or abandoned signups.

**Resolution:** Branched the signup page's success state by `invitationToken`. When the search param is set, the form renders "Welcome — you're signed in. Redirecting to your portal…" in a green confirmation block with a "Continue to portal" fallback link, then `useRouter().push` to `/invitations/<token>/accept` via a 500 ms timeout (so the copy is visible before navigation). The non-invitation signup path keeps the existing "Check your email to confirm…" copy unchanged — that flow still requires email confirmation under current Supabase project settings. CardDescription for the invitation case updated to match. Phase F verified end-to-end with a fresh `+alias@gmail.com` invitee.

**Cross-references:** commit `4aaf79b`; `app/(auth)/signup/page.tsx`; related DEBT-063 (invitation landing page Sign up vs Sign in disambiguation, surfaced during this fix's verification)

---

## DEBT-R007 — Notification bell icon styling polish
**Resolved:** 15 May 2026 in commit `4e3a7f6` (Phase F UX polish bundle, branch `phase-f-ux-polish-bundle`)
**Codebase:** SaaS
**Severity:** Low → Resolved
**Type:** UX (was DEBT-053)

**The debt was:** Phase 8 used a 🔔 emoji for the notification bell in both `app/(org)/layout.tsx` and `app/portal/layout.tsx`. The emoji rendered inconsistently across platforms (macOS Chrome vs iOS Safari) and didn't match the visual weight of the lucide icons used elsewhere in the nav.

**Resolution:** Swapped `<span aria-hidden>🔔</span>` for `<Bell aria-hidden="true" className="size-4" />` from `lucide-react` (already a project dep). The Notifications link's `inline-flex items-center gap-1.5` container was already consistent with the adjacent Conversations link, so only the icon glyph changed. No tests; visual verification on Vercel preview confirmed the icon matches adjacent nav weight on both org and portal sides.

**Cross-references:** commit `4e3a7f6`; `app/(org)/layout.tsx`; `app/portal/layout.tsx`

---

## DEBT-R006 — `listFilesForProject` pooler-bypass of `project_files` visibility RLS
**Resolved:** 14 May 2026 in commit `1a958dd` (MINI-SESSION-DEBT-059, branch `debt-059-stakeholder-files-filter`)
**Codebase:** SaaS
**Severity:** HIGH → Resolved
**Type:** Bug / Security (was DEBT-059)

**The debt was:** `db/queries/files.ts:listFilesForProject` claimed in its header comment "RLS enforces access" but used the Drizzle pooler (`db`, postgres role) which bypasses RLS. The query filtered only by `project_id` and `deleted_at IS NULL`. Stakeholders viewing `/portal/projects/[projectId]` could receive `project_files` rows where `visibility = 'org_only'` — rows the table's SELECT RLS policy would otherwise hide. Pre-existing from Session 10; surfaced during Session 11 Phase 9 timeline wiring.

**Resolution:** Refactored `listFilesForProject` signature to `opts: { projectId: string; visibleOnly: boolean }`. `visibleOnly` is REQUIRED — TypeScript fail-fast catches missed callers. When `visibleOnly === true`, the WHERE adds `eq(visibility, 'org_and_stakeholders')`. Mirrors `db/queries/project-activity.ts:listProjectActivity` (Session 11 Phase 9 canonical pattern). Stakeholder portal caller (`app/portal/projects/[projectId]/page.tsx`) passes `true`; org-side caller (`app/(org)/dashboard/projects/[projectId]/page.tsx`) passes `false`. Header comment block rewritten to explain the pooler-bypass-RLS reality + defense-in-depth role of the flag (RLS policy from migration 0018 is still canonical at the DB boundary if the query is ever re-routed through the Supabase REST client).

Two regression tests added in `tests/actions/files.test.ts` (`describe('listFilesForProject — visibleOnly filter (DEBT-059)')`): asserts that `visibleOnly: true` returns only `org_and_stakeholders` rows; asserts that `visibleOnly: false` returns all visibilities. Suite results: Actions 198 → 200; RLS 221/221 unchanged; cloud-smoke 14/14 unchanged; TypeScript clean. Phase F manual flow on Vercel preview verified end-to-end: org user uploads `org_only` + `org_and_stakeholders` files, stakeholder signs in via magic link, asserts `org_only` file hidden + `org_and_stakeholders` file visible.

Phase 1 audit covered all 30 exported functions across 13 `db/queries/*.ts` files. **1 BUG-verdict** (`listFilesForProject` — same shape as the documented DEBT-059); **2 YELLOW-verdict** (`getConversationDetail`, `listMessagesForConversation` — different bug class: participation-based gate enforced caller-side, filed as DEBT-060 + DEBT-061); **27 SAFE-verdict**. The single BUG count means Decision 3 path (a) from the kickoff: no new SKILL Hard Rule, no new ADR — the resolution paragraph + `listProjectActivity` cross-ref serve as the canonical pattern.

**Cross-references:** PR (TBD on merge — `debt-059-stakeholder-files-filter` branch); commits `19b3f3f` (kickoff doc) + `1a958dd` (fix + tests); pre-fix tag `pre-mini-debt-059` at `36dd5a2`; canonical pattern reference `db/queries/project-activity.ts:listProjectActivity` (Session 11 Phase 9); ARCHITECTURE-saas.md §12.4 (project_files RLS policy from migration 0018, unchanged); related siblings DEBT-060 + DEBT-061 (different bug class, recommend bundling); kickoff doc `mini-session-debt-059-kickoff.md`

---

## DEBT-R005 — `VERCEL_BRANCH_URL` preference for preview magic-link PKCE
**Resolved:** 11 May 2026 in PR #11 commit `6b17806` (Phase 0 of Session 11)
**Codebase:** SaaS
**Severity:** Medium → Resolved
**Type:** Bug (was DEBT-043)

**The debt was:** Magic-link Phase F walks on Vercel preview PRs always failed PKCE verification. The form submitted at the stable branch alias (`pcd-saas-git-<branch>-…vercel.app`) wrote the Supabase Auth `code_verifier` cookie scoped to that hostname; `getAppUrl()` returned `https://${VERCEL_URL}` which is the per-deploy URL (`pcd-saas-<hash>-…vercel.app`). The magic-link email's `redirect_to` pointed to the per-deploy URL; the callback opened there with no cookie and PKCE failed. Surfaced during the DEBT-026 mini-session's Phase F walk — DEBT-026's fix was correct (no more localhost leaks) but exposed this latent Vercel per-deploy vs branch-alias cookie-domain split. Blocked every magic-link Phase F walk from Session 9 onwards.

**Resolution:** `lib/get-app-url.ts` now prefers `VERCEL_BRANCH_URL` over `VERCEL_URL` on preview/dev deploys. Vercel sets `VERCEL_BRANCH_URL` to the stable per-branch alias — same hostname as where the form was submitted, so the PKCE cookie survives the round-trip. Production chain unchanged (`NEXT_PUBLIC_APP_URL` custom-domain override → `VERCEL_URL` production alias). Test suite extended 5 → 6 cases covering "VERCEL_BRANCH_URL + VERCEL_URL both set on preview → branch URL wins." Shipped as Session 11 Phase 0 to unblock the rest of the session's Phase F walks. Verified by user: "Magic-link round-trip verified. Email redirect_to pointed to branch alias (pcd-saas-git-debt-043-pkce-branch-url-…), clicked successfully, landed at /onboarding authenticated. No PKCE error."

**Cross-references:** ADR-032 (`getAppUrl()` contract — reconsider-if clause anticipated this); SKILL.md Hard Rule 26; PR #11; commit `6b17806`; pre-fix tag `pre-session-11` at `d56b568`; DEBT-R004 (DEBT-026, the trigger that exposed this); Vercel system env var docs (`VERCEL_BRANCH_URL` vs `VERCEL_URL`)

---

## DEBT-R004 — `getAppUrl()` helper for app-public URL construction
**Resolved:** 11 May 2026 in PR #9 commit `aa6899d`
**Codebase:** SaaS
**Severity:** Medium → Resolved
**Type:** Workaround (was DEBT-026)

**The debt was:** `env.NEXT_PUBLIC_APP_URL` was referenced directly at 5 server-side call sites (3 inside `actions/auth.ts:callbackUrl` powering `signUp`/`sendMagicLink`/`sendPasswordReset`, plus `actions/users.ts:113` and `actions/stakeholders.ts:278` for invitation accept URLs). Vercel preview deploys sent magic links pointing at `http://localhost:3000` or stale URLs. Bit Phase F twice (Sessions 9 and 10) and forced a magic-link → password sign-in pivot during the DEBT-037 hotfix walk.

**Resolution:** `lib/get-app-url.ts` centralizes origin resolution with a VERCEL_ENV-aware priority: production lets `NEXT_PUBLIC_APP_URL` override (custom domain) or falls back to `https://${VERCEL_URL}`; preview/dev always use `https://${VERCEL_URL}` (defeats the localhost-leak class of bugs); local falls back to `NEXT_PUBLIC_APP_URL` or `http://localhost:3000`. All 5 call sites routed through the helper. 5-test regression suite in `tests/actions/get-app-url.test.ts` covers local / preview / production default / production override / defensive default. Phase F walk on PR preview confirmed the magic-link email's `redirect_to` points to the preview domain (not localhost). See ADR-032.

**Cross-references:** ADR-032, PR #9, commit `aa6899d`, pre-fix tag `pre-debt-026-mini-session` at `d221142`, `lib/get-app-url.ts`, follow-up DEBT-043 (PKCE cookie mismatch on preview, surfaced by this fix)

---

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
- DEBT-024: Resend paid tier (external-recipient unblock)
- DEBT-025: Sentry user/org scope context

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
- DEBT-027: `sql<Date>` runtime lie — coerce inside query result projection
- DEBT-028: OrbStack idle-shutdown silent test failure
- DEBT-032: Thumbnail + PDF preview generation deferred
- DEBT-033: `messages.attachments` Zod widening deferred

## HOTFIX before Session 11 (must land before S11 kickoff)
- _(empty — DEBT-037 resolved 10 May 2026 by PR #7 commit `0565777`, ADR-031)_

## Session 11 candidates (notifications + activity) — ✓ SHIPPED 14 May 2026
- DEBT-043: PKCE cookie mismatch on Vercel preview magic-link walks → **Resolved** 11 May 2026 (Phase 0 of Session 11, PR #11 commit `6b17806`) — see DEBT-R005
- DEBT-029: Realtime subscription not auto-updating message UI
- DEBT-030: Project detail UI lacks deep-link to conversations (file portion resolved)
- DEBT-031: Unread badge in nav + per-row indicator
- DEBT-035: File restore UI surface
- DEBT-036: File download opens in new tab instead of saving → **Resolved** 15 May 2026 (Phase F UX polish bundle, commit `f0806dd`) — see DEBT-R013
- DEBT-038: Project-create form doesn't send invitation emails → **Resolved** 15 May 2026 (Phase F UX polish bundle, commit `299beef`) — see DEBT-R015
- DEBT-039: Multi-file selection via file picker fails → **Resolved** 15 May 2026 (Phase F UX polish bundle, commit `6dbde00`) — see DEBT-R014
- DEBT-040: "Create your own firm" link on /portal/projects (dual-context discoverability) → **Resolved** 15 May 2026 (Phase F UX polish bundle, commit `0796a9b`) — see DEBT-R010
- DEBT-041: `/select-context` page for dual-context users

## Indefinite (revisit at trigger)
- DEBT-015: RLS performance at scale (>$10K MRR or visible latency)
- DEBT-042: Functional index `lower(clients.email)` (>5K clients OR auth-callback p95 >100ms)
