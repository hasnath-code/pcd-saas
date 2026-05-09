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

## DEBT-026 — App URL templating not refactored to helper
**Added:** 09 May 2026 (Session 9 / Phase F surfaced — origin Sessions 6-7); priority bumped 10 May 2026 (Session 10 Phase F — bit again)
**Codebase:** SaaS
**Severity:** Medium (was Low — bumped Session 10)
**Type:** Workaround

**The debt:** `NEXT_PUBLIC_APP_URL` env var is referenced directly in email templates and invitation URLs across multiple call sites. Earlier in the session an incorrectly-set production env var (`localhost:3000`) caused invitation emails to embed broken localhost URLs; user had to manually fix in Vercel UI. No `getAppUrl()` helper exists. Vercel's auto-set `VERCEL_URL` is not used as fallback for preview deploys, and there's no localhost fallback for local dev.

**Why it exists:** Session 6/7 era — quick deploy plumbing took the path of least resistance (direct env-var read). No abstraction was needed yet because there was only one live environment.

**Cost of leaving it:** Every preview deploy that should send a real-looking link sends a broken one without manual `NEXT_PUBLIC_APP_URL` override. Friction during preview-based testing; latent foot-gun if the prod var is ever misset again.

**Fix sketch:** Create `lib/utils/app-url.ts` with `getAppUrl()` that checks (1) `NEXT_PUBLIC_APP_URL` → (2) `https://${VERCEL_URL}` → (3) `http://localhost:3000` in priority order. Update email templates and any invitation URL construction to use the helper. Adds preview-deploy resilience without env-var duplication. ~45 min.

**Trigger:** Session 11 — bit Phase F a second time (Session 10) when magic links from preview deploys pointed to production `NEXT_PUBLIC_APP_URL`, forcing manual host swap to test portal-side flows. Cost of leaving it grew with each preview-based QA cycle. Bumped to S11 priority — should land alongside (or before) the notification-dispatch URL templating that S11 will introduce.

**Cross-references:** Vercel auto env vars docs; `lib/email/templates/*`; `actions/users.ts` invitation flow

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

## Session 11 candidates (notifications + activity)
- DEBT-026: `getAppUrl()` helper (priority bumped — bit Phase F twice)
- DEBT-029: Realtime subscription not auto-updating message UI
- DEBT-030: Project detail UI lacks deep-link to conversations (file portion resolved)
- DEBT-031: Unread badge in nav + per-row indicator
- DEBT-034: Stakeholder routing UX (clients with both users + clients rows)
- DEBT-035: File restore UI surface

## Indefinite (revisit at trigger)
- DEBT-015: RLS performance at scale (>$10K MRR or visible latency)
