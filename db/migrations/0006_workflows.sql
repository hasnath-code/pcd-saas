CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"org_type_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system_template" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workflows_template_org_check" CHECK (
		(is_system_template = true AND org_id IS NULL)
		OR (is_system_template = false AND org_id IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"requires_action" boolean DEFAULT false NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_stages_workflow_slug_uniq" UNIQUE("workflow_id","slug"),
	CONSTRAINT "workflow_stages_workflow_position_uniq" UNIQUE("workflow_id","position")
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_org_type_id_org_types_id_fk" FOREIGN KEY ("org_type_id") REFERENCES "public"."org_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workflows_org" ON "workflows" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_workflows_templates" ON "workflows" USING btree ("org_type_id") WHERE is_system_template = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workflows_system_slug" ON "workflows" USING btree ("slug") WHERE is_system_template = true;--> statement-breakpoint
CREATE INDEX "idx_workflow_stages_workflow" ON "workflow_stages" USING btree ("workflow_id");
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain tables: authenticated role gets CRUD; RLS policies further restrict.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_stages TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — workflows
-- Spec §11.1 uses raw subqueries on `users`; we rewrite to use the SECURITY
-- DEFINER helpers from migration 0001 to match Phase 1a's pattern and avoid
-- recursion risk on the users table.
--
-- System templates (org_id IS NULL) are readable by every authenticated user
-- so the signup flow can clone them. Writes to system templates are blocked
-- entirely (no policy matches `is_system_template = true` for INSERT/UPDATE/
-- DELETE; service role bypasses RLS for the seed migration).
-- =============================================================================
CREATE POLICY "workflows_select_org_or_template" ON public.workflows
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (is_system_template = true OR is_org_member(org_id))
  );

CREATE POLICY "workflows_insert_org_admins" ON public.workflows
  FOR INSERT TO authenticated
  WITH CHECK (
    is_system_template = false
    AND org_id IS NOT NULL
    AND is_org_admin(org_id)
  );

CREATE POLICY "workflows_update_org_admins" ON public.workflows
  FOR UPDATE TO authenticated
  USING (
    is_system_template = false
    AND org_id IS NOT NULL
    AND is_org_admin(org_id)
  )
  WITH CHECK (
    is_system_template = false
    AND org_id IS NOT NULL
    AND is_org_admin(org_id)
  );

CREATE POLICY "workflows_delete_org_admins" ON public.workflows
  FOR DELETE TO authenticated
  USING (
    is_system_template = false
    AND org_id IS NOT NULL
    AND is_org_admin(org_id)
  );
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — workflow_stages
-- Visibility transitively inherits from the parent workflow's RLS via the
-- `workflow_id IN (SELECT id FROM workflows)` subquery (Postgres applies
-- workflows' RLS to that nested SELECT). Writes restricted to admins of the
-- parent workflow's org, and only for non-system-template workflows.
-- =============================================================================
CREATE POLICY "workflow_stages_select_via_parent" ON public.workflow_stages
  FOR SELECT TO authenticated
  USING (
    workflow_id IN (
      SELECT w.id FROM public.workflows w
      WHERE w.deleted_at IS NULL
        AND (w.is_system_template = true OR is_org_member(w.org_id))
    )
  );

CREATE POLICY "workflow_stages_insert_org_admins" ON public.workflow_stages
  FOR INSERT TO authenticated
  WITH CHECK (
    workflow_id IN (
      SELECT w.id FROM public.workflows w
      WHERE w.deleted_at IS NULL
        AND w.is_system_template = false
        AND w.org_id IS NOT NULL
        AND is_org_admin(w.org_id)
    )
  );

CREATE POLICY "workflow_stages_update_org_admins" ON public.workflow_stages
  FOR UPDATE TO authenticated
  USING (
    workflow_id IN (
      SELECT w.id FROM public.workflows w
      WHERE w.deleted_at IS NULL
        AND w.is_system_template = false
        AND w.org_id IS NOT NULL
        AND is_org_admin(w.org_id)
    )
  )
  WITH CHECK (
    workflow_id IN (
      SELECT w.id FROM public.workflows w
      WHERE w.deleted_at IS NULL
        AND w.is_system_template = false
        AND w.org_id IS NOT NULL
        AND is_org_admin(w.org_id)
    )
  );

CREATE POLICY "workflow_stages_delete_org_admins" ON public.workflow_stages
  FOR DELETE TO authenticated
  USING (
    workflow_id IN (
      SELECT w.id FROM public.workflows w
      WHERE w.deleted_at IS NULL
        AND w.is_system_template = false
        AND w.org_id IS NOT NULL
        AND is_org_admin(w.org_id)
    )
  );
