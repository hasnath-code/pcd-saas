# Session 10 — Phase 1c File Uploads

**Branch:** `session-10-file-uploads` (squash-merged to main as PR #5)
**Off main at:** `49993e8` (Session 9 — Phase 1c Kickoff: Messaging Core)
**Date:** 10 May 2026
**ARCHITECTURE-saas.md:** v0.12 → **v0.13** (Phase 1c in progress; S11 remains)

---

## What shipped

Phase 1c Session 10 lights up the file-upload primitive — the first piece of project content that lives in object storage rather than the database. Schema, storage RLS, action layer, two-sided UI, plan-gated quotas, and tests across all three suites.

1. **`project_files` schema (migration 0018).** New table per spec §12.4 + nullable `thumbnail_path` reserved for a future preview pipeline. Per-command RLS (ADR-016): SELECT (org member of project's org OR stakeholder w/ `can_view_drawings` + `org_and_stakeholders` visibility); INSERT split by uploader type (org-members write `surveyor_upload`/`document_artifact`; stakeholders write `client_upload` only with `can_upload_files=true`); UPDATE org-members full + stakeholder uploader-self; DELETE org-admin-only. Reuses `auth_user_org_project_ids()`, `auth_user_stakeholder_project_visibility()`, `auth_user_client_ids()` — no new SECURITY DEFINER helper.

2. **`org-files` bucket + storage RLS (migration 0019).** Single private bucket per spec §18; path layout `org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext}` where subdir is `surveyor-uploads`/`client-uploads`/`documents`. Five `storage.objects` policies mirror `project_files` semantics — SELECT, INSERT-org-members (subdir gated), INSERT-stakeholders (subdir + `can_upload_files`), UPDATE/DELETE admin-only. Idempotent setup via `INSERT … ON CONFLICT` + `DROP POLICY IF EXISTS … CREATE POLICY`.

3. **`lib/features.ts` + plan quota seed.** First implementation of §21 `checkFeature(orgId, flag, ctx?)`. Compound `'upload_file'` flag combines per-file size cap (`max_upload_size_bytes`) with running org-total cap (`max_storage_bytes`) via single SUM query joined across `project_files JOIN projects`. Tier values per ADR-029: `solo_free` 100MB/25MB, `studio` 5GB/100MB, `practice` 50GB/500MB, `enterprise` unlimited/1GB. Plans seed switched to upsert-by-(org_type_id, slug) so plan-shape changes propagate to environments where rows already exist.

4. **Server actions (`actions/files.ts`).** Five actions per §20 standard shape:
   - `createUploadUrl` — validates project access + identity/source match + per-file size + total quota; mints signed upload URL with pre-allocated `fileId` + canonical `storagePath`.
   - `confirmUpload` — re-checks quota (closes create→confirm race window; on failure deletes the orphan storage object and returns `quota_exceeded`); INSERTs `project_files` row; audit-logs `create`.
   - `getDownloadUrl` — 1-hour signed URL via `createSignedUrl(path, 3600)`; visibility=`org_only` hidden from stakeholders even with `can_view_drawings=true`.
   - `softDeleteFile` — uploader-self OR org admin; storage object retained for restore.
   - `restoreFile` — org admin only; clears `deleted_at`; audit-logs `restore`.

5. **Two-sided upload UI.** Three new components: `FileList` (SSR — viewer-aware delete affordance computed server-side), `FileRow` (client — download via signed URL + soft-delete via S9 `ConfirmDialog`), `FileUploadZone` (client — drag-drop + XHR upload with progress; two-step action chain `createUploadUrl` → direct PUT → `confirmUpload`). Wired into:
   - `/dashboard/projects/[projectId]` — replaces the "Coming soon — Messages and files…" placeholder. Resolves the file portion of DEBT-030; conversations deep-link remains open.
   - `/portal/projects/[projectId]` — replaces "Coming in a future update — file sharing lands soon" under `can_view_drawings`. Upload zone gated by `can_upload_files`; read-only file list shown when stakeholder lacks upload permission.

6. **Mimetype icons via lucide-react.** No image thumbnails or PDF previews — descoped per decision 10.3 revised at plan time (DEBT-032). `FileImage`, `FileText`, `FileSpreadsheet`, `FileArchive`, `FileAudio`, `FileVideo`, `File` mapped from MIME prefix in `FileRow:iconForMime`. The descope decision was made up front based on Vercel native-deps + bundle-size + new-async-pipeline-infrastructure cost; user-confirmed before any code was written.

---

## Commits (chronological)

| SHA | Message | Tests |
|---|---|---|
| `67efdb4` | feat(files): project_files table + per-command RLS | n/a (schema) |
| `7412cd1` | feat(files): org-files bucket + storage RLS | n/a (schema) |
| `c03eafe` | feat(features): checkFeature helper + plan storage quotas | n/a (lib) |
| `f631f38` | feat(files): server actions + project files query | n/a (actions) |
| `bcb24d8` | feat(ui): file list + upload zone on project detail (org + portal) | tsc + build clean |
| `d9bbe3d` | test(files): RLS + action + cloud-smoke coverage | **192/145/14** all green |
| `7ad7864` | docs(debt): log DEBT-032 through DEBT-035; bump DEBT-026 priority | n/a (docs) |
| `(this)`   | docs: ARCHITECTURE v0.13 + ADR-029/030 + SESSION-10-HANDOVER (admin docs PR #6) | n/a |

**Test count delta:** 306 → **351** (+45). RLS 172 → 192 (+20: 12 `project_files` + 8 storage). Actions 122 → 145 (+23 across 5 actions). Cloud-smoke 12 → 14 (+2: anon-blocked `project_files` + private bucket).

---

## Phase F — Manual QA (executed against PR preview — passed)

Phase F walked the full 14-step S10 runbook against the PR #5 preview deploy. **Result: 11 PASS / 1 SKIP / 1 N/A / 0 FAIL.** Clean walk — no in-flight hotfixes (contrast S9 which produced three runtime hotfixes during the walk). Cloud verification (`supabase db push --linked` for migrations 0018-0019, plans re-seed, anon-curl, full test suites) completed clean before walk-through.

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Sign in as Hasnath. Navigate to project detail. File list shows empty state | SKIP | Pre-existing test data; couldn't verify true empty-state copy |
| 2 | Upload a 10 MB image (PNG/JPG). Toast confirms upload. File appears in list | PASS | XHR progress visible; appears within 2 sec of confirmUpload |
| 3 | Refresh page. File still in list (persisted) | PASS | |
| 4 | Verify thumbnail rendered for the uploaded image | N/A → DEBT-032 | Thumbnails descoped Session 10; lucide `FileImage` icon shown instead |
| 5 | Upload a 25 MB+ file. Rejected with clear error message | PASS | Toast: "huge.bin is too large for your plan." |
| 6 | Upload until total quota exceeded. Last upload rejected with quota error | PASS | Toast: "Storage quota exceeded for your plan." |
| 7 | Sign in as stakeholder. File list visible (per `can_view_drawings`) | PASS | Cross-context visibility verified — sarah sees Hasnath's surveyor_upload |
| 8 | Stakeholder w/ `can_upload_files=true` upload succeeds; w/ `can_upload_files=false` no upload UI | PASS | Subdir routes correctly to client-uploads; UI gating respects flag |
| 9 | Hasnath downloads Sarah's file; Sarah downloads Hasnath's. Both via signed URLs | PASS | 1-hour TTL on download links verified |
| 10 | Hasnath soft-deletes own file. Disappears from list. Sarah no longer sees it (RLS) | PASS | RLS filtering verified end-to-end |
| 11 | Hasnath restores via recycle bin or admin path | **N/A → DEBT-035** | `restoreFile` action exists; no UI surface yet |
| 12 | Cross-org isolation: Hasnath cannot upload to a project in another org via path manipulation | PASS | Storage RLS rejects with 403; action layer rejects with `not_authorized` |
| 13 | Upload a PDF. Verify first-page preview renders within 30 seconds | **N/A → DEBT-032** | Preview generation descoped; PDF mimetype icon shown |
| 14 | Sentry: zero new errors during the walkthrough | PASS | No new issues raised across all 13 PASS+N/A+SKIP steps |

**Strict result categories** (per POST-SESSION-CHECKLIST.md item 9 / DEBT-017):
- PASS: verified end-to-end as a real human user
- FAIL: failed; documented as DEBT
- N/A: legitimately doesn't apply (descoped or not-yet-shipped capability)
- SKIP: couldn't verify in this run (pre-existing data, infra constraint, etc.)

**Phase F observations not on the runbook:**
- Magic links from preview deploys still point to production `NEXT_PUBLIC_APP_URL`, forcing manual host swap to test portal-side flows. Same shape as DEBT-026 — bumped to Medium / Session 11 trigger because this is the second Phase F to hit it.
- Stakeholders with both `users` and `clients` rows route to `/dashboard` instead of `/portal` after sign-in. RLS still gates data; UX is the actual issue. Logged as DEBT-034.

---

## Decisions worth preserving

### 1. Thumbnail / PDF preview generation DESCOPED entirely (decision 10.3 revised at plan time)

The kickoff brief asked for sync image thumbnails (<5 MB, in `confirmUpload`) plus async PDF first-page previews (Vercel Cron / Edge Function pipeline). Library investigation surfaced three blockers:

1. **`pdf-poppler` requires native libpoppler** — won't link on Vercel serverless functions. The Linux runtime image doesn't ship libpoppler.
2. **`pdfjs-dist` is pure-JS but heavy** — adds ~5 MB to function bundles and is slow per-page. Would push us against Vercel's serverless function size limits and introduce a real latency tax on confirmUpload.
3. **Async pipeline is net-new infrastructure** — Vercel Cron / Inngest / Trigger.dev would each add ~150 LOC + observability + a third-party dependency. None of these are shipped yet.

User confirmed the descope at plan time before any code was written. Mimetype icons via lucide-react cover the file-list UX gap — at a glance users can distinguish PDF / image / spreadsheet / archive / video / audio. `project_files.thumbnail_path` kept nullable so a future session can populate it without a migration. Captured as DEBT-032 with the full diagnosis.

Phase F Step 4 (image thumbnail) and Step 13 (PDF preview) both marked N/A → DEBT-032, accepted by the user as the correct call.

### 2. PostgREST/RLS interaction on stakeholder soft-delete via direct REST UPDATE

Discovered while writing `tests/rls/project-files.test.ts`. When a stakeholder UPDATE sets `deleted_at` to a non-null value, PostgREST returns `42501: new row violates row-level security policy for table "project_files"` — even when the UPDATE policy's USING + WITH CHECK both pass. Cause: the new row fails the SELECT policy's `deleted_at IS NULL` filter, and PostgREST treats post-UPDATE invisibility as a WITH CHECK violation.

This is fine for production: the action-layer `softDeleteFile` uses Drizzle's pooler client (postgres role, bypasses RLS) and writes `deleted_at` successfully. The stakeholder UPDATE policy still earns its keep — it covers legitimate non-RLS-impacting metadata UPDATEs (e.g. future renames where the row stays visible). The RLS test was rewritten to assert uploader-self UPDATE on `original_filename` instead of `deleted_at`. Documented inline in 0018's hand-written comment block + the test file.

**Permanent rule going forward:** when authoring an UPDATE policy whose USING references `deleted_at IS NULL` SELECT visibility, expect REST UPDATE on `deleted_at` to flip-flop. Always invoke soft-delete via Drizzle pooler (action layer), never a stakeholder REST UPDATE.

### 3. `createSignedUploadUrl` upload TTL is hardcoded to 2 hours by Supabase (ADR-030)

`@supabase/storage-js` v2.105 exposes `createSignedUploadUrl(path, options?: { upsert: boolean })` — no `expiresIn` parameter. Supabase hardcodes the TTL to 2 hours. The original spec §18 placeholder of 5 minutes was unreachable without writing custom HMAC signing against the bucket secret (deemed not worth it for a defense-in-depth gain on top of action-layer validation).

Download URLs use the parameterised `createSignedUrl(path, expiresIn)` and pass 3600 (1 hour) — long enough for a click → download → optional redirect chain, short enough that link-sharing leaks expire quickly. Both TTLs documented in §18 as the new reality. ADR-030 captures the divergence from spec.

### 4. Spec divergences explicitly resolved at plan time

The Session 10 kickoff brief diverged from ARCHITECTURE-saas.md §18 / §12.4 on eight points. Resolved up-front (and approved by user) before code was written:

| # | Item | Resolution |
|---|---|---|
| 1 | Bucket name | Spec wins (`org-files`, not kickoff's `pcd-files`) |
| 2 | Path layout | Spec wins (`org/{org_id}/projects/{project_id}/{subdir}/`, subdir-based) |
| 3 | `visibility` column | Spec wins — `org_only`/`org_and_stakeholders` preserved (kickoff omitted; load-bearing for stakeholder gating) |
| 4 | `source` enum values | Spec wins (`surveyor_upload`/`client_upload`/`document_artifact`) |
| 5 | Quota tiers | Hybrid — spec totals (100MB/5GB/50GB/unlimited) + kickoff per-file caps (25MB/100MB/500MB/1GB). ADR-029. |
| 6 | Signed URL TTLs | Pragmatic — SDK doesn't expose upload `expiresIn`. ADR-030 documents 2h upload / 1h download. |
| 7 | Action names | Spec names for first three (`createUploadUrl`, `confirmUpload`, `getDownloadUrl`); add kickoff's `restoreFile`; `softDeleteFile` matches both. |
| 8 | `thumbnail_path` column | Kept nullable (kickoff addition, spec omission); descoped per #5 above but the column survives for future use. |

### 5. Direct-to-Supabase uploads (not proxied)

Two-step flow per §18: (a) action mints signed URL, returns `{ signedUrl, fileId, storagePath, uploadToken, bucket }`; (b) client PUTs the file bytes directly to the signed URL via XHR; (c) action `confirmUpload` creates the `project_files` row. Bytes never traverse Vercel functions — keeps us under serverless size + timeout limits, which would have been a real concern for the 1 GB enterprise per-file cap.

`XMLHttpRequest.upload.onprogress` chosen over `fetch` for progress tracking — fetch's stream API doesn't expose upload progress in browsers without consuming the request body, which would tank memory on large files.

### 6. Plans seed switched from additive-INSERT to upsert (`onConflict: 'org_type_id,slug'`)

The pre-S10 seed only inserted plan rows that didn't already exist (filtered by existing keys). Adding new flags to `feature_flags` JSONB wouldn't propagate to environments where rows had already been seeded — including cloud, where 8 plan rows existed since Phase 1a. Cloud would have been left with stale `feature_flags` lacking the new `max_storage_bytes` / `max_upload_size_bytes` keys, defeating the quota check.

Switched to `.upsert(rows, { onConflict: 'org_type_id,slug' })`. Existing row id is preserved (re-used from the matched row) so FKs from `organizations.plan_id` stay intact. Cloud re-seed at S10 close confirmed: `0 new, 8 refreshed`. Pattern is now permanent — future plan-shape changes propagate via `npm run db:seed`.

### 7. Compound `'upload_file'` flag in `lib/features.ts` evaluates BOTH gates

Per ADR-029, `checkFeature(orgId, 'upload_file', { sizeBytes })` runs:
1. Per-file size check: `sizeBytes > max_upload_size_bytes` → reject with `file_too_large`
2. Total org-storage check: `SUM(size_bytes) FROM project_files JOIN projects ON project_id = projects.id WHERE org_id = ? AND project_files.deleted_at IS NULL AND projects.deleted_at IS NULL` → reject with `quota_exceeded` if `current + sizeBytes > max_storage_bytes`

Both must pass. Same compound check is invoked twice per upload — once at `createUploadUrl` (gate before minting URL) and once at `confirmUpload` (closes create→confirm race). On `confirmUpload` failure the orphan storage object is removed via `supabase.storage.from('org-files').remove([storagePath])` so we don't accumulate paid bytes for files we won't track.

The SUM query is a single indexed scan (via `idx_project_files_project`). Cached counter on `organizations` is YAGNI until EXPLAIN ANALYZE on real data demands it (pre-launch perf pass at the earliest).

---

## State at Session 10 close (pre-merge)

- **Branch:** 7 work commits on `session-10-file-uploads` (off main at `49993e8`); 8th commit on `session-10-admin-docs` carries this handover + ARCHITECTURE v0.13 + DECISIONS ADR-029/030 (PR #6).
- **Cloud Supabase:** migrations 0018-0019 applied via `supabase db push --linked` mid-session (`gcwdasdujivliplthpvv`). Plans re-seeded (8 refreshed, 0 new). Anon-curl on `project_files` returns `42501 permission denied`. `org-files` bucket `public=false`; anon `listBuckets` returns empty array (private buckets filtered for anon).
- **Test gates:**
  - `npm run test:rls` — **192/192** (was 172; +20)
  - `npm run test:actions` — **145/145** (was 122; +23)
  - `npm run test:cloud-smoke` — **14/14** (was 12; +2)
- **TypeScript:** `npx tsc --noEmit` clean
- **Build:** `npm run build` clean. Routes:
  - `/dashboard/projects/[projectId]` — 6.13 kB / 323 kB First Load
  - `/portal/projects/[projectId]` — 4.04 kB / 285 kB First Load
- **Phase F:** 11 PASS / 1 SKIP / 1 N/A / 0 FAIL on PR preview
- **Worktree:** clean before each commit (`session-10-kickoff.md.save` is gitignored noise from VS Code save trail; not committed)

---

## Inherited assumptions Session 11 (notifications + activity) MUST respect

1. **`messages.attachments` JSONB widening (DEBT-033) is still deferred.** S9 inherited assumption #2 was that S10 would widen `sendMessage`'s Zod schema to accept `{ fileId }[]` entries. S10 shipped the file primitive standalone; the attachment integration was decoupled. If S11's notification dispatch needs file metadata in message payloads (e.g. an email "Sarah sent a message and attached survey.pdf"), bundle the Zod widening + composer paperclip UI + bubble file-chip render into S11. ~4-6 hours including tests. Otherwise leave for opportunistic conversation-UI polish.

2. **`thumbnail_path` column (DEBT-032) is reserved.** Never NULL-→-NOT-NULL (hold this commitment) — populating it with a generation pipeline is purely additive work. The simplest first move is a sync `sharp`-based image-thumbnail in `confirmUpload` for `mimeType.startsWith('image/') && sizeBytes < 5_000_000`; PDFs need an out-of-Vercel worker (Inngest / Trigger.dev) which S11 may also want for notification fan-out — bundle if scope allows.

3. **Storage path convention is now contract.** `org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext}` is enforced by the `storage.objects` path-pattern checks (`(storage.foldername(name))[2]` = org, `[4]` = project, `[5]` = subdir). Any future bucket-RLS authoring (e.g. a separate `org-documents` bucket for Phase 2 generated PDFs) must follow the same shape OR ship its own helper for path destructuring. Don't change the existing convention without coordinating storage RLS updates — would silently break uploads cloud-wide.

4. **DEBT-029 (realtime not auto-updating message UI) still deferred to S11.** Was Session 9's main FAIL on Phase F Step 7. S10 didn't touch realtime — file uploads currently require manual refresh to appear (acceptable per kickoff §K). S11's notification subscription work hits the same Supabase Realtime + RLS interaction; bundle the diagnosis. Suspected causes (in order of likelihood): (a) Realtime publication not configured, (b) RLS policy uses helper functions the subscriber can't call, (c) channel auth context lost on subscription, (d) hook lifecycle / unmount timing.

5. **DEBT-026 (`getAppUrl()` helper) priority bumped to Medium / S11 trigger.** Bit Phase F twice now. S11 will introduce more URL-templating call sites (notification dispatch). The helper should land BEFORE or ALONGSIDE notification work, not after. Sketch: `lib/utils/app-url.ts` checking `NEXT_PUBLIC_APP_URL` → `https://${VERCEL_URL}` → `http://localhost:3000` in priority order. ~45 min.

6. **DEBT-031 (no unread badge in nav + per-row indicator) still deferred to S11.** S9 shipped `last_read_at` + `markConversationRead` data layer; UI consumer never landed. S11's notification work surfaces the same unread state — natural fit.

7. **DEBT-030 conversations deep-link from project detail still open.** S10 resolved the file portion only. S11 should add either an embedded `ConversationsInbox` filtered by `project_id` (~3hr, more cohesive UX) or a button "Open project conversations" linking to `/conversations?project_id=X` (~1hr, faster). Notification dispatch will need per-project deep-links anyway; bundle.

8. **`auth_user_stakeholder_project_visibility(p_project_id)` is the canonical 5-flag visibility lookup.** S10 used it for both `project_files` SELECT (via `can_view_drawings`) and storage RLS INSERT (via `can_upload_files`). S11 will need it too — for `project_activity` SELECT (filter by `visible_to_stakeholders` × any flag, depending on event type) and possibly for notification preferences. Don't subquery `project_stakeholders` inline; reuse the helper.

9. **`auth_user_org_project_ids()` covers the org-side branch of any project-scoped policy.** Same pattern as #8 above. Used by `project_files`, `project_milestones`, `project_stakeholders`, and (S11) will be used by `project_activity`.

10. **The §20 standard action shape held up across 5 new actions.** No deviations needed. S11 actions (`dispatchNotification`, `markNotificationRead`, etc.) should follow the same Zod parse → auth → access check → feature flag → mutation tx → audit log → discriminated return shape.

---

## Decisions logged this session

- **ADR-029** — Plan-gated storage quotas (per-file cap + total cap; SUM-query computation; race re-check on confirmUpload)
- **ADR-030** — Signed URL TTLs (download 1h via `createSignedUrl`; upload 2h hardcoded by Supabase storage-js v2.105)

## Debt logged this session

**Resolved:**
- **DEBT-030 partial** — file-sharing placeholder portion resolved by commit `bcb24d8` (both org and portal sides). Conversations deep-link portion remains open.

**New (Phase F):**
- **DEBT-032** — Thumbnail + PDF preview generation deferred (decision 10.3 revised at plan time; pdf-poppler/pdfjs-dist + Vercel constraints)
- **DEBT-033** — `messages.attachments` Zod widening deferred (decoupled from S10 file primitive)
- **DEBT-034** — Stakeholder routing UX (Phase F observation; **superseded by DEBT-037** below — entry retained for traceability)
- **DEBT-035** — File restore UI surface (`restoreFile` action exists; admin recycle-bin UI deferred)

**New (production smoke test, post-merge):**
- **DEBT-036** — File download opens in new tab instead of saving (Low; UX paper-cut)
- **DEBT-037** — Stakeholder accounts silently become org owners on sign-in (**HIGH — HOTFIX BEFORE SESSION 11 STARTS**; supersedes DEBT-034 with corrected severity. Stakeholder sign-in spawns a new org and routes to `/dashboard` instead of `/portal`. Confirmed end-to-end on production. Don't kick S11 off until this is fixed; production also needs cleanup of any auto-spawned orgs from the smoke-test session.)
- **DEBT-038** — Project-create form doesn't send invitation emails (Medium; two divergent code paths for adding stakeholders)
- **DEBT-039** — Multi-file selection via file picker fails (Medium; FileUploadZone click handler vs drop handler divergence)

**Bumped:**
- **DEBT-026** — `getAppUrl()` helper priority bumped to Medium / S11 trigger (bit Phase F twice now)

---

## What's left for Session 11 (notifications + activity)

Per ARCHITECTURE-saas.md §33 Session 11 row + S11 candidates carryover from S9 + S10:

- Migrations: `notification_preferences`, `notifications`, `project_activity`
- RLS policies + tests (project_activity uses `auth_user_stakeholder_project_visibility` for the stakeholder branch + a `visible_to_stakeholders` boolean per row)
- Default notification preferences seeded on user/client creation
- `lib/notifications/dispatch.ts`: `dispatchNotification(eventType, recipients, payload)`
- Notification preferences UI matrix (per channel × per event)
- In-app notification inbox (Realtime subscription)
- Email notifications for `message.new`, `project.stage_changed`, `file.uploaded`, etc.
- Activity log writes throughout the codebase (every status change, message, file upload, soft-delete, restore)
- Project activity timeline UI (visible to org users + stakeholders per visibility)

**Bundle into S11 (carryover priority):**
- DEBT-026 — `getAppUrl()` helper (before email-notification dispatch)
- DEBT-029 — Realtime subscription not auto-updating UI (same realtime infra)
- DEBT-030 — Conversations deep-link from project detail (notification deep-links overlap)
- DEBT-031 — Unread badge in nav + per-row indicator (same unread-state surface)
- DEBT-022 — Auto-join new org members to existing one_to_one threads (if notification dispatch makes the gap painful)

**Bundle if scope allows:**
- DEBT-032 — Thumbnail / PDF preview generation (if S11 stands up an Inngest/Trigger.dev worker for notification fan-out, the same worker can host PDF rendering)
- DEBT-033 — `messages.attachments` Zod widening (if notification payloads need file metadata)
- DEBT-034 — Stakeholder routing UX (pre-launch trigger; S11 is the natural carve-out)
- DEBT-035 — File restore UI (admin recycle-bin; could pair with a broader admin panel)

**Done when:** notifications dispatch on events; in-app updates land in realtime (DEBT-029 closed); activity timeline shows per-stakeholder filtered events. Phase 1c exit criteria are met — Hasnath's existing Apps Script projects can be migrated using `MIGRATION-MAP.md`, RLS suite continues to pass, manual exploratory testing finds no critical bugs.

---

— end —
