CREATE TABLE "project_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_to_stakeholders" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_activity_actor_type_check" CHECK (actor_type IN ('user', 'client', 'system'))
);
--> statement-breakpoint
ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_activity_project_created" ON "project_activity" USING btree ("project_id", created_at DESC);
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets SELECT only. INSERT/UPDATE/DELETE are
-- NOT granted — activity rows are written exclusively by server actions
-- through the Drizzle pooler (postgres role, bypasses RLS) inside the same
-- transaction as the action they describe (sendMessage / moveProjectToStage /
-- confirmUpload / inviteStakeholder / createMilestone). Mirrors the spec
-- literal in §12.7 which only defines a SELECT policy.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT ON public.project_activity TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.project_activity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — project_activity
-- Spec §12.7 + §14 (visibility model) + ADR-016 (per-command, never FOR ALL).
--
-- Helper reuse — NO new SECURITY DEFINER helper needed in this migration:
--   - auth_user_org_project_ids() (added in 0010) — org-member branch
--   - auth_user_stakeholder_project_visibility(p_project_id) (added in 0010) —
--     returns the 5 visibility flags; existence of any row implies the auth
--     user is an accepted, non-deleted stakeholder on the project. We don't
--     read any specific flag — visible_to_stakeholders on the activity row
--     is the only stakeholder gate (per §14: visibility profile gates project_activity
--     SELECT only via the visible_to_stakeholders column, not via the 5 flags).
--
-- SELECT: visible to org members of the project's org always; visible to
--   accepted stakeholders only when visible_to_stakeholders = true. The
--   stakeholder check uses EXISTS against the visibility helper so the
--   policy short-circuits cleanly for non-stakeholders without scanning
--   project_stakeholders directly (which would otherwise apply that table's
--   RLS — not recursive but slower).
--
-- INSERT / UPDATE / DELETE: no authenticated policy. Server actions write
-- via the pooler inside the same transaction as the action they describe
-- (Hard Rule 6). Activity rows are append-only in normal operation; UPDATEs
-- and DELETEs are admin-recovery paths only.
-- =============================================================================
CREATE POLICY "project_activity_select" ON public.project_activity
  FOR SELECT TO authenticated
  USING (
    project_id IN (SELECT auth_user_org_project_ids())
    OR (
      visible_to_stakeholders = true
      AND EXISTS (
        SELECT 1 FROM auth_user_stakeholder_project_visibility(project_id)
      )
    )
  );
