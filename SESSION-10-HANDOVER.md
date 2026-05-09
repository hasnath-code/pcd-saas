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
