CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correction_log_payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payments_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payments_project" ON "payments" USING btree ("project_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_payments_org" ON "payments" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS further restricts. Writes
-- from server actions (recordPayment / correctPayment) route through the
-- Drizzle pooler (postgres role bypasses RLS) like every other server action,
-- but caller-side authz still enforces org membership before the write.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — payments
-- Phase 2 §2.3 (kickoff) + §14 (stakeholder visibility model) + ADR-016
-- (per-command, never FOR ALL). The SELECT branch on can_view_financials
-- mirrors documents_select exactly — payments are the second financial-
-- visibility-gated table after documents (§14 + §26 stub case).
--
-- Helper reuse — NO new SECURITY DEFINER helper needed:
--   - auth_user_org_project_ids() (added 0010) — org-member branch
--   - auth_user_stakeholder_project_visibility(p_project_id) (added 0010) —
--     returns the 5 visibility flags; we read can_view_financials.
--
-- SELECT: deleted_at IS NULL AND (
--   org member of the project's org
--   OR stakeholder of the project with can_view_financials=true
-- ). COALESCE on the helper short-circuits cleanly when no stakeholder row
-- exists (returns NULL → COALESCE to false).
--
-- INSERT (org-members): authenticated user is an org-member of the project's
-- org AND recorded_by matches the caller's public.users.id. recorded_by is
-- mandatory — we don't allow it to point at a different user. Mirrors the
-- documents_insert_org_members cross-user check.
--
-- UPDATE (org-members): any org-member of the project's org. Covers
-- correctPayment (the amount-mutation path). Stakeholders cannot UPDATE —
-- payment corrections are an org-internal administrative action.
--
-- DELETE (org-admins): hard delete is admin-recovery only. Standard delete
-- is soft (UPDATE deleted_at). Mirrors documents / project_files DELETE.
-- =============================================================================

CREATE POLICY "payments_select" ON public.payments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      project_id IN (SELECT auth_user_org_project_ids())
      OR COALESCE(
        (SELECT can_view_financials FROM auth_user_stakeholder_project_visibility(project_id)),
        false
      )
    )
  );

CREATE POLICY "payments_insert_org_members" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    project_id IN (SELECT auth_user_org_project_ids())
    AND recorded_by IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    )
  );

CREATE POLICY "payments_update_org_members" ON public.payments
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "payments_delete_org_admins" ON public.payments
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
