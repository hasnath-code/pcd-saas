CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"visible_to_stakeholders" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_milestones_project" ON "project_milestones" USING btree ("project_id") WHERE deleted_at IS NULL;
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_milestones TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — project_milestones
-- Spec §11.7: org members of the project's org see all milestones; stakeholders
-- see only milestones flagged visible_to_stakeholders=true on projects where
-- their per-stakeholder can_view_schedule=true.
--
-- Recursion-safe: org-side branch uses auth_user_org_project_ids() (helper
-- added in 0010) instead of subquerying projects directly. Stakeholder branch
-- uses auth_user_stakeholder_project_visibility(project_id) (also from 0010)
-- which returns 0 rows if not an accepted stakeholder; COALESCE coerces the
-- absence to false.
--
-- Modify policy is org-member-only — stakeholders cannot create/edit/delete
-- milestones, even on projects where they have can_view_schedule=true.
-- =============================================================================
CREATE POLICY "project_milestones_select" ON public.project_milestones
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      project_id IN (SELECT auth_user_org_project_ids())
      OR (
        visible_to_stakeholders = true
        AND COALESCE(
          (SELECT can_view_schedule FROM auth_user_stakeholder_project_visibility(project_id)),
          false
        )
      )
    )
  );

CREATE POLICY "project_milestones_modify_org_members" ON public.project_milestones
  FOR ALL TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));