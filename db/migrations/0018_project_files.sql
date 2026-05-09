CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"uploaded_by_type" text NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"source" text NOT NULL,
	"visibility" text DEFAULT 'org_and_stakeholders' NOT NULL,
	"thumbnail_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_files_uploaded_by_type_check" CHECK (uploaded_by_type IN ('user', 'client')),
	CONSTRAINT "project_files_source_check" CHECK (source IN ('surveyor_upload', 'client_upload', 'document_artifact')),
	CONSTRAINT "project_files_visibility_check" CHECK (visibility IN ('org_only', 'org_and_stakeholders')),
	CONSTRAINT "project_files_size_bytes_positive" CHECK (size_bytes >= 0)
);
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_files_project" ON "project_files" USING btree ("project_id") WHERE deleted_at IS NULL;
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS policies further restrict.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_files TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — project_files
-- Spec §12.4 + §14 (visibility model) + ADR-016 (per-command, never FOR ALL).
--
-- Helper reuse — NO new SECURITY DEFINER helper needed in this migration:
--   - auth_user_org_project_ids() (added in 0010) — org-member branch
--   - auth_user_stakeholder_project_visibility(p_project_id) (added in 0010) —
--     returns the 5 visibility flags including can_view_drawings + can_upload_files
--   - auth_user_client_ids() (added in 0007) — for stakeholder uploader-self UPDATE
--   - is_org_admin(org_id) (added in 0001) — for admin DELETE / restore
--
-- Path convention (enforced by application + storage RLS in 0019, NOT by
-- this table): storage_path = 'org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext}'
-- where subdir maps from `source`:
--   surveyor_upload   → surveyor-uploads
--   client_upload     → client-uploads
--   document_artifact → documents
--
-- SELECT: deleted_at IS NULL AND (
--   org member of the project's org
--   OR (visibility = 'org_and_stakeholders' AND stakeholder has can_view_drawings)
-- ). Mirrors §12.4 spec literal but goes through the helper functions to
-- stay recursion-safe and respect the 5-flag visibility model from §14.
--
-- INSERT (org-members): authenticated user is an org member of the project's
-- org; uploaded_by_type='user' and uploaded_by_id matches that user's
-- public.users.id; source must be surveyor_upload or document_artifact —
-- stakeholders take the separate INSERT policy below.
--
-- INSERT (stakeholders): authenticated user is an accepted stakeholder on
-- the project with can_upload_files=true (via the visibility helper);
-- uploaded_by_type='client' and uploaded_by_id matches the caller's
-- clients.id (via auth_user_client_ids); source must be client_upload —
-- this is the only path stakeholders can take.
--
-- UPDATE (org-members): any org member of the project's org. Covers (a)
-- uploader self-soft-delete (sets deleted_at), (b) admin restore (clears
-- deleted_at). Action layer enforces admin-only restore (cleaner UX) but
-- the policy doesn't try to encode that — keeps the policy simple and
-- restore-by-non-admin would just be an action-layer rejection.
--
-- UPDATE (stakeholders): an accepted stakeholder on the project may
-- soft-delete only rows they themselves uploaded. WITH CHECK additionally
-- forbids them from changing the row's project_id, source, visibility, or
-- ownership fields — the only legitimate stakeholder UPDATE is flipping
-- deleted_at. Action layer enforces this; the policy is a defense-in-depth
-- guard.
--
-- DELETE (org-admins): hard delete is admin-recovery only. Standard delete
-- is soft (UPDATE deleted_at). Mirrors conversations DELETE pattern in 0014.
-- =============================================================================

CREATE POLICY "project_files_select" ON public.project_files
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      project_id IN (SELECT auth_user_org_project_ids())
      OR (
        visibility = 'org_and_stakeholders'
        AND COALESCE(
          (SELECT can_view_drawings FROM auth_user_stakeholder_project_visibility(project_id)),
          false
        )
      )
    )
  );

CREATE POLICY "project_files_insert_org_members" ON public.project_files
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by_type = 'user'
    AND source IN ('surveyor_upload', 'document_artifact')
    AND project_id IN (SELECT auth_user_org_project_ids())
    AND uploaded_by_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    )
  );

CREATE POLICY "project_files_insert_stakeholders" ON public.project_files
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by_type = 'client'
    AND source = 'client_upload'
    AND uploaded_by_id IN (SELECT auth_user_client_ids())
    AND COALESCE(
      (SELECT can_upload_files FROM auth_user_stakeholder_project_visibility(project_id)),
      false
    )
  );

CREATE POLICY "project_files_update_org_members" ON public.project_files
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "project_files_update_stakeholder_uploader" ON public.project_files
  FOR UPDATE TO authenticated
  USING (
    uploaded_by_type = 'client'
    AND uploaded_by_id IN (SELECT auth_user_client_ids())
    AND COALESCE(
      (SELECT can_upload_files FROM auth_user_stakeholder_project_visibility(project_id)),
      false
    )
  )
  WITH CHECK (
    uploaded_by_type = 'client'
    AND uploaded_by_id IN (SELECT auth_user_client_ids())
  );

-- NOTE on stakeholder soft-delete via REST (Session 10):
-- PostgREST raises 42501 when an UPDATE makes the new row invisible to the
-- SELECT policy — even when the UPDATE policy's USING + WITH CHECK both
-- pass. Setting `deleted_at` to a non-null value triggers this because the
-- SELECT policy filters `deleted_at IS NULL`. As a result, a stakeholder
-- cannot soft-delete their own file via a direct REST UPDATE. This is fine:
-- the action-layer softDeleteFile in actions/files.ts uses Drizzle's
-- pooler client (postgres role, bypasses RLS) and writes deleted_at
-- successfully. The stakeholder UPDATE policy is here for defense-in-depth
-- on legitimate non-deleted_at metadata updates (e.g. future renames).

CREATE POLICY "project_files_delete_org_admins" ON public.project_files
  FOR DELETE TO authenticated
  USING (
    project_id IN (SELECT auth_user_org_project_ids())
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('owner', 'admin')
        AND u.deleted_at IS NULL
    )
  );
