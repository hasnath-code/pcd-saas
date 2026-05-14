# Session 11 Handover

**Status:** ✓ Shipped 14 May 2026
**Phase:** 1c — **CLOSED** with this session
**PR:** #12 (`session-11-notifications-activity` → `main`)

## What shipped

Notifications system + project activity timeline + DEBT-043 PKCE fix (Phase 0). Five existing server actions (`sendMessage`, `moveProjectToStage`, `confirmUpload`, `inviteStakeholder`, `createMilestone`) wired with post-commit notification fan-out and in-transaction activity log writes. Preferences matrix UI on both org and portal sides; in-app inbox with Realtime + 30s polling fallback; bell-icon nav badges; project activity timeline on both project detail pages with stakeholder visibility gating.

## Test counts at close

| Suite | Before | After | Delta |
|---|---|---|---|
| RLS | 192 | **221** | +29 |
| Actions | 159 | **198** | +39 |
| Cloud-smoke | 14 | 14 | unchanged |
| TypeScript | clean | clean | — |
| Phase F | n/a | **19/19 PASS** | post-DEBT-049-hotfix re-walk |

## Where the full handover lives

**The full Session 11 handover is in `ARCHITECTURE-saas.md §35.11`** — a 13-row carryover table covering schema, dispatcher pattern evolution (in-tx → post-commit via ADR-033), DEBT-049 hotfix narrative, Realtime fallback design, the DEBT-059 pooler-bypass observation, the Decision-2 backfill override, preferences seeding entry points, test count breakdown, cloud migration push log, and Phase 1c closure rationale. Plus state-at-close + open-follow-up summaries.

Session 11 trialed an "in-architecture carryover" pattern as the handover surface: putting the §35.N carryover row in `ARCHITECTURE-saas.md` itself rather than a standalone `SESSION-N-HANDOVER.md`. Reasoning: the carryover content overlaps heavily with the architecture's own "what's in production now?" intent, so duplicating it across two files invites drift. This stub file exists so the `SESSION-N-HANDOVER.md` filename convention isn't broken — future sessions searching the repo for past handovers can still find Session 11 here, then follow the pointer to §35.11.

## Convention note for future sessions

The §35-carryover-in-arch pattern is **being trialed** with Session 11. Future sessions can either:

- **Continue the trial:** ship the carryover content inside `ARCHITECTURE-saas.md §35.N` and leave only a stub `SESSION-N-HANDOVER.md` like this one. Pros: single source of truth; the architecture stays self-contained. Cons: §35 grows long; mining for "what did Session N specifically do" requires scrolling.
- **Revert to standalone:** author full content in `SESSION-N-HANDOVER.md` per the Session 1-10 convention. Pros: per-session focus; easier to diff a single session. Cons: duplication with §35.N entries (which still need to exist for the architecture's own consistency).

Decide once at Session 12 / mini-session kickoff time; either is acceptable.

## Open follow-up

- ~~**MINI-SESSION-DEBT-059**~~ — **Shipped 14 May 2026** on branch `debt-059-stakeholder-files-filter` (commits `19b3f3f` + `1a958dd`); DEBT-059 → DEBT-R006. Audit also surfaced DEBT-060 + DEBT-061 (participation-gate variants on portal conversation queries — Medium severity, recommend bundling into a future mini-session). See `ARCHITECTURE-saas.md §35.11` row 4 + `DEBT-LOG.md` DEBT-R006.
- ~~**Phase F UX polish bundle** — DEBT-048 / 050-055 (7 entries from the Phase F walk). Pre-launch session.~~ — **Shipped 15 May 2026** on branch `phase-f-ux-polish-bundle` (tag `phase-f-polish-shipped`). Final scope: 9 entries closed (036, 038, 039, 040, 050, 051, 052, 053, 054) → DEBT-R007 through R015. Two original candidates remain Open: **DEBT-048** (team-internal conversations — new feature, deferred to standalone session) and **DEBT-055** (unread badge count inflation — needs Sentry reproducer). One new entry filed during Phase F: **DEBT-063** (invitation landing page Sign up vs Sign in disambiguation, surfaced during DEBT-038 verification). Phase F manual: 9/9 PASS. Test deltas: Actions 200 → 214 (+14). See `ARCHITECTURE-saas.md §35.11` row 5 + `DEBT-LOG.md` DEBT-R007 through R015.
- **Realtime root-cause** — DEBT-029 / DEBT-058 both reproduce the same `subscribe()` → `CLOSED` pattern locally. Polling fallback handles the UX; targeted diagnosis deferred until a feature can't tolerate 30s lag.
- **DEBT-060 + DEBT-061** — caller-enforced participation gates on `getConversationDetail` + `listMessagesForConversation`. Medium severity defense-in-depth; surfaced during DEBT-059 audit. Bundle into a future mini-session (Decision 3 path (a) chose not to expand DEBT-059's scope per Hard Rule 1).

## State at session close

- Branch: `session-11-notifications-activity` (10 commits since `main` at `6b17806` / PR #11)
- Cloud Supabase: migrations 0020/0021/0022 applied 12 May 2026 via `supabase db push --linked`; anon REST returns 42501 on the new tables (RLS + no-anon-GRANT shape correct); `notifications` in `supabase_realtime` publication alongside `messages`.
- Production deploy: gated on PR #12 merge. Vercel preview deploy verified via Phase F 19/19 PASS.
- New surfaces:
  - Routes: `/notifications`, `/portal/notifications`, `/settings/notifications`, `/portal/settings/notifications`
  - Nav: 🔔 bell icon + count on both `(org)/layout.tsx` and `portal/layout.tsx`
  - Components: `NotificationPreferencesMatrix`, `InboxList`, `ActivityTimeline`
  - Hooks: `useNotifications` (Realtime + polling fallback)
  - Helpers: `lib/notifications/{events,seed-defaults,subjects,dispatch}.ts`, `lib/email/templates/notification-generic.ts`, `lib/activity/{log,labels}.ts`
- 1 new ADR (033 — post-commit dispatch pattern); 11 new DEBT entries (048, 050-059); 1 closed (DEBT-049 → resolved in-place; DEBT-043 → DEBT-R005).
- SKILL.md v3.6 → v3.7 (Hard Rule 27 codifies the post-commit dispatch pattern).

## Last commit before merge

See `git log` on the `session-11-notifications-activity` branch. The session bundle is 10 commits; the final docs commit (this one) updates `ARCHITECTURE-saas.md` to v0.16, closes DEBT-043 → DEBT-R005, adds the 11 new DEBT entries, points to MINI-SESSION-DEBT-059, and creates this stub. After merge: tag the merge commit `session-11-shipped` per repo convention.
