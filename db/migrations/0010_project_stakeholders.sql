CREATE TABLE "project_stakeholders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" text NOT NULL,
	"visibility_profile" text NOT NULL,
	"can_message" boolean DEFAULT true NOT NULL,
	"can_upload_files" boolean DEFAULT true NOT NULL,
	"can_view_financials" boolean DEFAULT false NOT NULL,
	"can_view_drawings" boolean DEFAULT true NOT NULL,
	"can_view_schedule" boolean DEFAULT true NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_stakeholders_project_client_uniq" UNIQUE("project_id","client_id"),
	CONSTRAINT "project_stakeholders_role_check" CHECK (role IN ('primary_client', 'collaborator', 'observer', 'billing_contact')),
	CONSTRAINT "project_stakeholders_visibility_profile_check" CHECK (visibility_profile IN ('full', 'progress_only', 'documents_only', 'schedule_only', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_stakeholders_project" ON "project_stakeholders" USING btree ("project_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_project_stakeholders_client" ON "project_stakeholders" USING btree ("client_id") WHERE deleted_at IS NULL;
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- SECURITY DEFINER helpers for project_stakeholders + project_milestones RLS.
--
-- Both helpers are added in this migration so they're available when 0011's
-- project_milestones policy lands AND so the recursion that 0012 introduces
-- (projects.select calls auth_user_stakeholder_projects() which queries
-- project_stakeholders) is broken proactively per Rule 20 of SKILL.md v3.2.
--
-- search_path is pinned per the Phase 1a helper convention (0001 + 0007).
-- =============================================================================

-- Returns project_ids visible to the current auth user via org membership.
-- Used by project_stakeholders.select (org-side branch) and by
-- project_milestones.select (org-side branch). Without this helper those
-- policies would have to subquery projects directly, which after 0012 calls
-- back into project_stakeholders RLS — recursion error 42P17.
CREATE OR REPLACE FUNCTION public.auth_user_org_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT p.id FROM public.projects p
  WHERE p.org_id IN (
    SELECT u.org_id FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.deleted_at IS NULL
  )
  AND p.deleted_at IS NULL;
$$;
--> statement-breakpoint

-- Returns one row of (5 visibility flags) for the (auth.uid(), p_project_id)
-- tuple, or zero rows if the auth user is not an accepted, non-deleted
-- stakeholder on that project. Used by project_milestones.select (checks
-- can_view_schedule) and Phase 1c project_files.select (will check
-- can_view_drawings).
--
-- Returning a TABLE rather than SETOF uuid lets one helper power any
-- per-flag policy check without per-flag function explosion.
CREATE OR REPLACE FUNCTION public.auth_user_stakeholder_project_visibility(p_project_id uuid)
RETURNS TABLE (
  can_message boolean,
  can_upload_files boolean,
  can_view_financials boolean,
  can_view_drawings boolean,
  can_view_schedule boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT ps.can_message, ps.can_upload_files, ps.can_view_financials,
         ps.can_view_drawings, ps.can_view_schedule
  FROM public.project_stakeholders ps
  JOIN public.clients c ON c.id = ps.client_id
  WHERE c.auth_user_id = auth.uid()
    AND c.deleted_at IS NULL
    AND ps.deleted_at IS NULL
    AND ps.accepted_at IS NOT NULL
    AND ps.project_id = p_project_id;
$$;
--> statement-breakpoint

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS policies further restrict.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_stakeholders TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.project_stakeholders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — project_stakeholders
-- Spec §11.6: org members of the project's org see all stakeholder rows for
-- that project; the stakeholder themselves sees their own row (matched by
-- client_id via auth_user_client_ids() from 0007).
--
-- Modify is org-member-only — stakeholders cannot edit their own visibility
-- flags or role. This is intentional per §11.6.
--
-- Recursion-safe: org-side branch uses auth_user_org_project_ids() (added in
-- this migration); self-side branch uses auth_user_client_ids() (from 0007).
-- Both bypass RLS via SECURITY DEFINER.
-- =============================================================================
CREATE POLICY "project_stakeholders_select" ON public.project_stakeholders
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      project_id IN (SELECT auth_user_org_project_ids())
      OR client_id IN (SELECT auth_user_client_ids())
    )
  );

CREATE POLICY "project_stakeholders_modify_org_members" ON public.project_stakeholders
  FOR ALL TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));
