CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"document_number" text NOT NULL,
	"sequence" integer NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"vat_applicable" boolean DEFAULT false NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT 0 NOT NULL,
	"vat_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by_name" text,
	"supersedes_document_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_project_type_sequence_uniq" UNIQUE("project_id","type","sequence"),
	CONSTRAINT "documents_type_check" CHECK (type IN ('quote', 'invoice', 'receipt')),
	CONSTRAINT "documents_status_check" CHECK (status IN ('draft', 'sent', 'superseded', 'void')),
	CONSTRAINT "documents_discount_pct_range" CHECK (discount_pct >= 0 AND discount_pct <= 100),
	CONSTRAINT "documents_sequence_positive" CHECK (sequence >= 1),
	CONSTRAINT "documents_amounts_non_negative" CHECK (subtotal >= 0 AND vat_amount >= 0 AND total >= 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supersedes_document_id_documents_id_fk" FOREIGN KEY ("supersedes_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_documents_project" ON "documents" USING btree ("project_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_documents_org" ON "documents" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS further restricts. Writes
-- from token-authorized public contexts (acceptQuote) route through the
-- Drizzle pooler (postgres role, bypasses RLS) — see ADR-034 for the
-- token-authorized public-write pattern. service_role inherits CRUD via
-- migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — documents
-- Phase 2 §2.2 + §14 (stakeholder visibility model) + ADR-016 (per-command,
-- never FOR ALL). The SELECT branch on can_view_financials is the exact case
-- ARCHITECTURE-saas.md §26's stub test targets — a progress_only stakeholder
-- (can_view_financials=false) must see zero documents on a project, while a
-- full-profile stakeholder must see them.
--
-- Helper reuse — NO new SECURITY DEFINER helper needed:
--   - auth_user_org_project_ids() (added 0010) — org-member branch
--   - auth_user_stakeholder_project_visibility(p_project_id) (added 0010) —
--     returns the 5 visibility flags; we read can_view_financials.
--
-- SELECT: deleted_at IS NULL AND (
--   org member of the project's org
--   OR stakeholder of the project with can_view_financials=true
-- ). Stakeholder branch uses COALESCE on the helper to short-circuit cleanly
-- when there is no stakeholder row (returns NULL → COALESCE to false).
--
-- INSERT (org-members): authenticated user is an org-member of the project's
-- org AND created_by matches the caller's public.users.id. created_by is a
-- mandatory column; we don't allow it to point at a different user.
--
-- UPDATE (org-members): any org-member of the project's org. Covers
-- updateQuoteDraft (org-side mutation). The token-authorized acceptQuote
-- write does NOT go through this policy — the action layer uses the pooler
-- (postgres role bypasses RLS); per ADR-034.
--
-- DELETE (org-admins): hard delete is admin-recovery only. Standard delete
-- is soft (UPDATE deleted_at). Mirrors project_files DELETE pattern in 0018.
-- =============================================================================

CREATE POLICY "documents_select" ON public.documents
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

CREATE POLICY "documents_insert_org_members" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    project_id IN (SELECT auth_user_org_project_ids())
    AND created_by IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    )
  );

CREATE POLICY "documents_update_org_members" ON public.documents
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT auth_user_org_project_ids()))
  WITH CHECK (project_id IN (SELECT auth_user_org_project_ids()));

CREATE POLICY "documents_delete_org_admins" ON public.documents
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
