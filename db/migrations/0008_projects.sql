CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_number" text NOT NULL,
	"site_address" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"current_stage_id" uuid NOT NULL,
	"scope_summary" text,
	"created_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_org_project_number_uniq" UNIQUE("org_id","project_number")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_current_stage_id_workflow_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_projects_org" ON "projects" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_projects_stage" ON "projects" USING btree ("current_stage_id") WHERE deleted_at IS NULL;
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Phase 1b backfill (per spec §11): invitations.project_id -> projects(id)
-- The column existed in 0001 as a forward-compat hook for stakeholder invites;
-- the FK lands now that projects exists. CASCADE because deleting a project
-- should clean up any pending stakeholder invitations tied to it.
-- =============================================================================
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS policies further restrict.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — projects
-- Spec §11.5: org members see all org projects; accepted stakeholders see
-- projects they're attached to. The stakeholder branch uses the
-- auth_user_stakeholder_projects() SECURITY DEFINER stub from migration 0001
-- (returns empty set until Session 6 fills its body when project_stakeholders
-- ships).
--
-- Writes restricted to org members (per spec — broader than admin-only).
-- Soft-delete via UPDATE on deleted_at; no hard DELETE policy.
-- =============================================================================
CREATE POLICY "projects_select_org_or_stakeholder" ON public.projects
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      is_org_member(org_id)
      OR id IN (SELECT auth_user_stakeholder_projects())
    )
  );

CREATE POLICY "projects_insert_org_members" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (is_org_member(org_id));

CREATE POLICY "projects_update_org_members" ON public.projects
  FOR UPDATE TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY "projects_delete_org_members" ON public.projects
  FOR DELETE TO authenticated
  USING (is_org_member(org_id));
