# Session 9 — Phase 1c Kickoff: Messaging Core

**Branch:** `session-9-phase-1c-messaging-core`
**Off main at:** `06c0961` (docs: discipline framework + SKILL v3.4)
**Date:** 09 May 2026
**ARCHITECTURE-saas.md:** v0.10 → **v0.11** (Phase 1c in progress)

---

## What shipped

Phase 1c Session 9 lights up the asynchronous messaging layer — the spine that Sessions 10 (files) and 11 (notifications + activity) will hang off.

1. **Conversations + messages schema (migrations 0014-0017).** Three new tables (`conversations`, `conversation_participants`, `messages`) + one SECURITY DEFINER helper (`auth_user_conversation_ids()`). Per-command RLS (ADR-016) on all three. Realtime publication on `messages`.

2. **Server actions (`actions/conversations.ts` + `actions/messages.ts`).** 4 public conversation actions (createGroup, addParticipant, removeParticipant, markRead) + 3 public message actions (send, edit, delete) + 2 internal tx-friendly auto-create helpers (one_to_one + general).

3. **Auto-creation hooks** wired into `acceptStakeholderInvitation` (one_to_one on accept) and `findOrCreateClient` + `inviteStakeholder` (general on `client_org_memberships` insert).

4. **Realtime hook (`hooks/use-conversation-messages.ts`).** Subscribes to `postgres_changes` on `messages` filtered by `conversation_id`. Body-blanking for soft-deleted rows happens at the projection layer in TS (Decision 9.4B / Q6).

5. **shadcn AlertDialog + ConfirmDialog wrapper.** Replaces 3 native `confirm()` callsites (DEBT-016 resolved → ADR-025 supersedes ADR-024). Plus new Session 9 confirms (delete message, remove participant) all use the wrapper.

6. **UI: `/conversations` + `/conversations/[id]` (org-side); `/portal/conversations` + `/portal/conversations/[id]` (portal-side).** Inbox with type-grouping + last-message previews + unread badges. Detail with WhatsApp-style scroll, react-markdown render (allowlist: bold/italic/code/links — NO tables/images/raw HTML), participant chips with add/remove header controls.

---

## Commits (chronological)

| SHA | Message | Tests |
|---|---|---|
| `e4cfb40` | feat(messaging): conversations + participants + messages schema | written, unrun |
| `919710d` | feat(messaging): conversations + messages server actions | written, unrun |
| `4621066` | feat(messaging): wire auto-create hooks into existing actions | written, unrun |
| `fa28681` | feat(messaging): useConversationMessages realtime hook | n/a (hook) |
| `003f3a7` | feat(ui): shadcn AlertDialog + ConfirmDialog wrapper, replace 3 native confirms | n/a |
| `c7e3b5f` | feat(messaging): org-side conversations inbox + detail UI | tsc + build clean |
| `703edda` | feat(messaging): portal conversations + nav unread badges | tsc + build clean |
| `326f24e` | test(messaging): RLS + actions + cloud-smoke for Phase 1c S9 | written, unrun |
| `(this)` | docs: ARCHITECTURE-saas v0.11 + SESSION-9-HANDOVER + ADRs 025-028 + DEBT updates | n/a |

**Test count target:** 256 → ~310. Target deltas: +28 RLS / +25 actions / +3 cloud-smoke. Files written: 3 RLS files (~28 tests) + 2 action files (~23 tests) + 1 cloud-smoke file (3 tests). Pending Docker for actual run.

---

## Decisions worth preserving

### 1. `auth_user_conversation_ids()` SECURITY DEFINER helper proactively shipped

The conversations ↔ conversation_participants cross-reference is a textbook 42P17 case. We didn't wait for the failure to discover it (lesson from Phase 1b §35.6 entry 8 — "FOR ALL is a footgun" patterns surface at test time, but we can prevent them at design time per Hard Rule 20).

Pattern: 0014 ships a STUB body (`SELECT NULL::uuid WHERE FALSE`) so policies can reference the function before `conversation_participants` exists. 0017 `CREATE OR REPLACE`s the real body once the participants table is created. Mirrors 0001 → 0013 pattern for `auth_user_stakeholder_projects()`.

Helper signature:
```sql
CREATE FUNCTION public.auth_user_conversation_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, auth, pg_temp
AS $$
  SELECT cp.conversation_id FROM conversation_participants cp
  JOIN users u ON u.id = cp.participant_id AND cp.participant_type = 'user'
  WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL AND cp.left_at IS NULL
  UNION
  SELECT cp.conversation_id FROM conversation_participants cp
  JOIN clients c ON c.id = cp.participant_id AND cp.participant_type = 'client'
  WHERE c.auth_user_id = auth.uid() AND c.deleted_at IS NULL AND cp.left_at IS NULL
$$;
```

Returns conversation_ids the auth user actively participates in (filtered by `left_at IS NULL`). Used by `conversations_select` (stakeholder branch) and `messages_insert_participants` (gate).

### 2. `messages_select` does NOT filter `deleted_at IS NULL` (Q6)

Soft-deleted messages remain queryable so the UI can render `'[deleted]'` inline. Body-blanking happens in TypeScript:
- `db/queries/conversations.ts` projects `displayBody = deletedAt !== null ? '[deleted]' : body`
- `hooks/use-conversation-messages.ts` does the same in `projectRow`

The raw `body` is preserved in DB so admin recovery + audit are possible. Both surfaces share the same projection contract.

### 3. `conversation_participants.left_at` over `deleted_at`

Spec §12.2 didn't specify a soft-delete column. Going with `left_at` (ADR-028) because:
- Verb match — participants don't get "deleted," they leave
- Default queries filter `left_at IS NULL`
- `removeConversationParticipant` sets it to `now()` paired with a system message in the same tx
- Hard DELETE remains org-admin-only as a recovery path (rarely used)

### 4. System messages stored in `messages.sender_type='system'` — participant changes only

Decision 9.6 / S4b (ADR-027): Session 9 ships system messages for participant add/remove only. Stage transitions, file uploads, milestone events all defer to Session 11 when `project_activity` ships.

The `messages_sender_id_consistency` CHECK (sender_type='system' AND sender_id IS NULL) is enforced at DB level. RLS does NOT permit authenticated INSERTs with sender_type='system' — only postgres pooler tx writes them via `insertSystemMessageTx` inside add/remove transactions.

### 5. Cross-org client validation in createGroupConversation + addConversationParticipant

Without an explicit `client_org_memberships` join in the action layer, an attacker could grant a cross-org auth user visibility into the org's conversations via `auth_user_conversation_ids()`. The helper resolves participations regardless of which org owns the conversation.

RLS via `conversation_participants_insert_org_admins` would technically also reject (the policy chains through the conversation's org_id → is_org_admin), but action-layer validation gives a clean `not_authorized: cross_org_client` error rather than a Postgres violation. Defense-in-depth pattern matching Session 8's "include org_id even when querying by globally-unique FK" guidance.

### 6. shadcn AlertDialog migration as ADR-025 (supersedes ADR-024)

DEBT-016 is closed. Three callsites + two new Session 9 callsites all use `<ConfirmDialog>`. The wrapper supports async `onConfirm` (auto-closes on Promise settle) + `busy` state (disables both buttons during in-flight server actions) + `variant="destructive"` for delete flows.

### 7. Auto-create hook idempotency + ordering

Both `autoCreateOneToOneConversationTx` and `autoCreateGeneralConversationTx` SELECT existing first; INSERT only if none. Re-runs on existing memberships are no-ops. This makes them safe to call multiple times — important for `inviteStakeholder` (which is rate-limited but a user could trigger duplicate invites) and `acceptStakeholderInvitation` (which has cancellation flows that could replay).

The auto-create runs INSIDE the calling action's existing transaction (Hard Rule 19). For acceptStakeholderInvitation, that's the existing accept tx (lines ~389-417). For findOrCreateClient + inviteStakeholder, that's the existing client-creation tx.

### 8. Realtime publication on messages only

`ALTER PUBLICATION supabase_realtime ADD TABLE public.messages` lands in 0016 inside a `DO $$` guard for re-runnability. `conversation_participants` was NOT added — left_at and last_read_at updates don't propagate live in this session. Inbox badge refresh relies on `router.refresh()` after mark-read.

If Session 11+ wants real-time participant-change feedback (e.g. seeing "Sarah just left" without a refresh), add `conversation_participants` to the publication.

---

## Inherited assumptions Session 10 (file uploads) MUST respect

1. **`auth_user_stakeholder_project_visibility(p_project_id)` from migration 0010 returns the 5 visibility flags including `can_view_drawings`.** Session 10 `project_files.SELECT` policy should use this helper for the stakeholder branch (per spec §12.4 + S6 carryover entry 6). Don't subquery `project_stakeholders` inline.

2. **`messages.attachments` is JSONB '[]' but Session 9 doesn't write to it.** Session 10 ships file uploads; once implemented, the Zod schema in `actions/messages.ts sendMessage` should expand `attachments` to accept the file metadata shape. Currently the Zod schema rejects non-empty arrays explicitly.

3. **Soft-delete pattern: `project_files` will use `deleted_at`** (per spec §12.4 + §23). Decision 9.4B's "soft-deleted rows visible, body blanked" pattern applies here too — soft-deleted files should remain visible in the file list with a `[deleted]` placeholder rather than disappearing.

4. **Storage bucket name: `org-files` per spec §18.** Path convention: `org/{org_id}/projects/{project_id}/{client-uploads,surveyor-uploads,documents}/`. RLS-mirrored bucket policies needed.

5. **shadcn AlertDialog + ConfirmDialog wrapper available.** Reuse `<ConfirmDialog>` for delete-file confirms (don't reach for `window.confirm`).

## Inherited assumptions Session 11 (notifications + activity) MUST respect

1. **`project_activity` is the canonical store for non-message events** (ADR-020 + ADR-027 / S4b). Session 9 system messages cover ONLY participant changes. Session 11 ships `project_activity` per spec §12.7 + adds:
   - Stage transitions backfill from `audit_logs` where `action='stage_changed'` (per Session 8 §35.8 entry 1 — 9-field metadata schema is locked).
   - File uploads (Session 10) write project_activity rows.
   - Milestone events write project_activity rows.

2. **Decision: do non-message events also surface as system messages in conversations?** Two options:
   - (a) UI overlay — conversation detail interleaves project_activity events alongside messages chronologically, but messages table doesn't gain new system rows.
   - (b) DB derived — a trigger or scheduled job creates `messages.sender_type='system'` rows mirroring project_activity.

   Pick in S11 plan. Both are viable. (a) keeps messages clean; (b) keeps the realtime subscription simple.

3. **Notification dispatch reads `messages` events.** Per spec §17, `message.new` is one of the Phase 1c starting event types. Session 11 wires the dispatcher to fire on message INSERT (via realtime + a server-side worker). Soft-deleted messages should NOT trigger notifications — check `deleted_at IS NULL` in the trigger condition.

4. **Unread count computation** uses `last_read_at` on conversation_participants (already shipped). Notification "you have N unread messages" emails read from the same source.

5. **Auto-join new org members to existing one_to_ones (DEBT-022)** — if Session 11's notification dispatch makes the gap painful (e.g. a new team member doesn't get their inbox primed), bundle DEBT-022 into S11 scope.

---

## Phase F — Manual QA (deferred to user execution)

Docker daemon was offline during the session, so the 14-step Phase F runbook is pending user execution. Setup:

**Prerequisites (do these first):**
1. Start Docker / OrbStack
2. `npm run db:reset` → applies 0014-0017 locally
3. `npm run db:seed:local` → seeds reference data
4. `npm run test:rls` → expect ~175 (currently 147 + 28 new = 175)
5. `npm run test:actions` → expect ~125 (currently 100 + 23 new = 123, close enough)
6. `npm run test:cloud-smoke` → expect 12 (cloud secrets must be set; 9 + 3 new)
7. `supabase db push --linked` → push 0014-0017 to cloud
8. Cloud anon curl smoke: `curl -s "$CLOUD_SUPABASE_URL/rest/v1/messages?select=id&limit=1" -H "apikey: $CLOUD_SUPABASE_ANON_KEY"` → expect `[]`
9. Hard refresh production at https://pcd-saas.vercel.app (per ADR-023)

**14-step walkthrough (from kickoff brief):**

| # | Step | PASS/FAIL/N/A | Notes |
|---|---|---|---|
| 1 | Sign in as Hasnath. `/conversations` shows empty state | _ | |
| 2 | Create project. Invite Sarah. Sarah accepts | _ | |
| 3 | Org-side `/conversations` shows one-to-one auto-created with Sarah | _ | Auto-create |
| 4 | Org-side: send "Hello Sarah" — appears | _ | |
| 5 | Sign in as Sarah at `/portal/conversations` — one-to-one with Hasnath's org appears | _ | Two-context |
| 6 | Sarah opens, sees Hasnath's message, sends reply "Hi back" | _ | |
| 7 | Both browsers open simultaneously: realtime updates without refresh | _ | Realtime |
| 8 | Org-side: edit own message. `(edited)` shows. Content updates | _ | |
| 9 | Org-side: delete own message. `[deleted]` placeholder. ConfirmDialog confirms | _ | DEBT-016 verify |
| 10 | Org-side: create group conversation. Add team member. System message "X was added" appears | _ | |
| 11 | Mark conversation read; unread drops to 0. Sarah sends new message; unread becomes 1 | _ | |
| 12 | Send `**bold**` `_italic_` `[link](https://example.com)` — renders. Send `<script>alert(1)</script>` — sanitized | _ | |
| 13 | Empty message → Zod rejects. 10001-char message → Zod rejects | _ | |
| 14 | `/settings/workflows` delete workflow → AlertDialog (not native confirm). Cancel + Confirm both work | _ | DEBT-016 verify |

**Strict result categories** (per POST-SESSION-CHECKLIST.md item 9 / DEBT-017):
- PASS: verified end-to-end as a real human user
- FAIL: failed; document and either fix or file as DEBT
- N/A: legitimately doesn't apply (e.g. step 5/6/7 if you don't have a second browser context)

**Two-context limitation note (per Rule 21):** Steps 5-7 need both an org browser (Hasnath) and portal browser (Sarah) signed in simultaneously. Workarounds:
- Use two different browsers (Chrome + Safari, or Chrome + Firefox)
- Use Chrome incognito for one identity
- If neither works, mark steps 5-7 N/A and substitute backend verification (service-role REST query for participant rows + Postgres realtime client subscription test)

---

## Build / test state at session close (pre-merge, pre-QA)

- `npx tsc --noEmit` — clean
- `npm run build` — clean. Conversation routes: /conversations 4.99 kB / 283 kB; /conversations/[id] 2.74 kB / 323 kB; /portal/conversations 515 B / 260 kB; /portal/conversations/[id] 519 B / 384 kB (markdown deps add ~40 kB First Load on detail).
- `npm test:rls` — written but unrun (Docker offline)
- `npm test:actions` — written but unrun (Docker offline)
- `npm test:cloud-smoke` — written but unrun (Docker offline + cloud secrets needed for env)
- Worktree: clean status before each commit

---

## Decisions logged this session

- **ADR-025** — shadcn AlertDialog migration; supersedes ADR-024
- **ADR-026** — `last_read_at` placement on `conversation_participants`
- **ADR-027** — System messages in `messages` table (participant changes only Session 9; defer rest to S11)
- **ADR-028** — `conversation_participants.left_at` for soft-leave

## Debt logged this session

- **DEBT-016 RESOLVED** (was: browser-Claude can't verify native confirms; now: shadcn AlertDialog migration shipped)
- **DEBT-019** (drizzle journal/snapshot drift for migrations 0012-0017)
- **DEBT-020** (system message sources beyond participant changes deferred to S11)
- **DEBT-021** (message rate limiting deferred to pre-launch ops)
- **DEBT-022** (new org members not auto-joined to existing one_to_ones)

---

## What's left for Session 10 (file uploads)

Per ARCHITECTURE-saas.md §33 Session 10 row:
- Migration: `project_files`
- RLS policies + tests (use `auth_user_stakeholder_project_visibility(p_project_id)` for the can_view_drawings branch — it already exists from 0010)
- Supabase Storage bucket `org-files` with RLS-mirrored bucket policies
- `actions/files.ts`: `createUploadUrl`, `confirmUpload`, `getDownloadUrl`, `softDeleteFile`
- Upload UI for both org users and stakeholders
- File list UI per project
- Plan-gated quota enforcement (placeholder limits)
- Wire into `messages.attachments` JSONB (extend Zod in `sendMessage` to accept file metadata)

Done when both sides can upload, files appear in project detail, quota enforcement works.

---

— end —
