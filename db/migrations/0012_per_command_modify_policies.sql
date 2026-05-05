-- =============================================================================
-- Per-command modify policies for project_stakeholders + project_milestones.
--
-- Migrations 0010/0011 used `FOR ALL` for the modify policy on both tables
-- (mirroring the spec literal). In Postgres, multiple PERMISSIVE policies on
-- the same command (here SELECT) are OR'd. So FOR ALL — which applies to
-- SELECT, INSERT, UPDATE, DELETE — was OR'd with the FOR SELECT policy at
-- read time, allowing rows that satisfied "I'm an org member of this project"
-- to bypass the SELECT policy's `deleted_at IS NULL` filter. Result: org
-- members could SELECT soft-deleted rows. Caught by the project_milestones
-- soft-delete RLS test.
--
-- Fix: drop the FOR ALL policies; replace with three separate INSERT / UPDATE
-- / DELETE policies. SELECT is now governed only by the FOR SELECT policy
-- with its deleted_at filter. Modify policies intentionally lack a
-- `deleted_at IS NULL` clause so the re-invite path (UPDATE-back-to-non-
-- deleted) keeps working.
--
-- This pattern matches 0008_projects.sql's per-command policy structure.
-- =============================================================================

DROP POLICY IF EXISTS "project_stakeholders_modify_org_members" ON public.project_stakeholders;
--> statement-breakpoint

CREATE POLICY "project_stakeholders_insert_org_members" ON public.project_stakeholders
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "project_stakeholders_update_org_members" ON public.project_stakeholders
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "project_stakeholders_delete_org_members" ON public.project_stakeholders
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()));
--> statement-breakpoint

DROP POLICY IF EXISTS "project_milestones_modify_org_members" ON public.project_milestones;
--> statement-breakpoint

CREATE POLICY "project_milestones_insert_org_members" ON public.project_milestones
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "project_milestones_update_org_members" ON public.project_milestones
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "project_milestones_delete_org_members" ON public.project_milestones
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()));
