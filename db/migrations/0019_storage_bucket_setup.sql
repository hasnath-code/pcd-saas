-- =============================================================================
-- Storage bucket + RLS for Phase 1c file uploads.
-- Spec §18. Single bucket 'org-files'; path prefixes enforce isolation.
--
-- Path layout (set by application code, NOT by DB):
--   org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext}
-- where {subdir} is one of: surveyor-uploads | client-uploads | documents
-- (mirrors project_files.source mapping in 0018).
--
-- storage.foldername(name) splits the path into a text[] of directory
-- components (excluding the basename). For our layout:
--   [1] = 'org'
--   [2] = <org_id>
--   [3] = 'projects'
--   [4] = <project_id>
--   [5] = <subdir>
--
-- Policy logic mirrors 0018's project_files policies:
--   - SELECT: org member of [2] OR stakeholder with can_view_drawings on [4]
--   - INSERT (org-member): org member of [2]; subdir [5] in surveyor-uploads/documents
--   - INSERT (stakeholder): can_upload_files on [4]; subdir [5] = client-uploads
--   - UPDATE: org admins only (rare — used for storage object metadata patches)
--   - DELETE: org admins only — soft-delete in project_files leaves the storage
--     object intact; hard delete is admin-recovery
--
-- All policies require bucket_id = 'org-files' to scope away from any other
-- bucket added later. Idempotent: re-running the migration is safe via
-- INSERT … ON CONFLICT DO NOTHING + DROP POLICY IF EXISTS … CREATE POLICY.
--
-- Cloud divergence note (Hard Rule 18): supabase_storage_admin owns
-- storage.objects on cloud and local. The postgres role used by Drizzle has
-- the BYPASSRLS attribute via the migration runner — policies are managed
-- here via SQL DDL. No SECURITY DEFINER helper is needed; storage RLS calls
-- are auth.uid() based.
-- =============================================================================

-- Idempotent bucket creation. private (public=false) — all access via
-- signed URLs minted by server actions.
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-files', 'org-files', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- Drop any prior shape (re-runnability). Names are idempotent — these are
-- the canonical Session 10 names.
DROP POLICY IF EXISTS "org_files_select" ON storage.objects;
DROP POLICY IF EXISTS "org_files_insert_org_members" ON storage.objects;
DROP POLICY IF EXISTS "org_files_insert_stakeholders" ON storage.objects;
DROP POLICY IF EXISTS "org_files_update_org_admins" ON storage.objects;
DROP POLICY IF EXISTS "org_files_delete_org_admins" ON storage.objects;
--> statement-breakpoint

-- SELECT: org members of path[2] OR stakeholders with can_view_drawings on
-- path[4]. Mirrors project_files.SELECT but operates on the storage object
-- metadata layer — required because Supabase Realtime / signed-URL flows
-- read from storage.objects directly, not via project_files.
CREATE POLICY "org_files_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'org-files'
    AND (
      (storage.foldername(name))[2] IN (
        SELECT u.org_id::text FROM public.users u
        WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.auth_user_stakeholder_project_visibility(
          ((storage.foldername(name))[4])::uuid
        ) v
        WHERE v.can_view_drawings = true
      )
    )
  );
--> statement-breakpoint

-- INSERT (org-members): org member uploading to a path scoped to their own
-- org_id, into a non-stakeholder subdir. Subdir gating ensures org users
-- can't accidentally write into the client-uploads namespace.
CREATE POLICY "org_files_insert_org_members" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-files'
    AND (storage.foldername(name))[2] IN (
      SELECT u.org_id::text FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    )
    AND (storage.foldername(name))[5] IN ('surveyor-uploads', 'documents')
  );
--> statement-breakpoint

-- INSERT (stakeholders): stakeholder with can_upload_files=true on the
-- project_id at path[4], writing only into the client-uploads subdir.
-- Defense-in-depth — even with a forged stakeholder token, path manipulation
-- can't write outside client-uploads.
CREATE POLICY "org_files_insert_stakeholders" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-files'
    AND (storage.foldername(name))[5] = 'client-uploads'
    AND EXISTS (
      SELECT 1 FROM public.auth_user_stakeholder_project_visibility(
        ((storage.foldername(name))[4])::uuid
      ) v
      WHERE v.can_upload_files = true
    )
  );
--> statement-breakpoint

-- UPDATE: org admins only. Rare — used for storage object metadata patches.
-- Standard upload-then-finalize flow doesn't UPDATE storage.objects.
CREATE POLICY "org_files_update_org_admins" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-files'
    AND (storage.foldername(name))[2] IN (
      SELECT u.org_id::text FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('owner', 'admin')
        AND u.deleted_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'org-files'
    AND (storage.foldername(name))[2] IN (
      SELECT u.org_id::text FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('owner', 'admin')
        AND u.deleted_at IS NULL
    )
  );
--> statement-breakpoint

-- DELETE: org admins only. softDeleteFile in actions/files.ts updates
-- project_files.deleted_at and leaves the storage object in place; hard
-- delete is admin-recovery. Keeps the recovery surface narrow.
CREATE POLICY "org_files_delete_org_admins" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-files'
    AND (storage.foldername(name))[2] IN (
      SELECT u.org_id::text FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('owner', 'admin')
        AND u.deleted_at IS NULL
    )
  );
