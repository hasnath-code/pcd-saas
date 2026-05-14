CREATE TABLE "document_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_tokens_document_type_check" CHECK (document_type IN ('quote', 'invoice', 'receipt'))
);
--> statement-breakpoint
ALTER TABLE "document_tokens" ADD CONSTRAINT "document_tokens_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_document_tokens_token" ON "document_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_document_tokens_document" ON "document_tokens" USING btree ("document_id");--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS further restricts. The
-- public-page lookup at /q/[token] does NOT use the authenticated REST
-- client — it queries via the Drizzle pooler (postgres role, bypasses RLS)
-- because token-gated routes are never auth-walled (Hard Rule 14).
-- service_role inherits CRUD via migration 0003.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_tokens TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.document_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — document_tokens
-- Phase 2 §2.2 + ADR-016 (per-command, never FOR ALL). Token rows are
-- org-internal: stakeholders reach documents via the public /q/[token] URL
-- and never list tokens; org members may need to see tokens (e.g. to copy
-- a public link from the dashboard).
--
-- All four policies gate on org-membership of the underlying document's
-- project. The pattern is `document_id IN (SELECT id FROM documents WHERE
-- project_id IN (SELECT auth_user_org_project_ids()))` — the inner
-- subquery hits documents' RLS, but since the outer WHERE filter already
-- requires `project_id IN auth_user_org_project_ids()`, a non-org-member
-- (stakeholder) gets an empty inner result and is denied access to tokens
-- regardless of their can_view_financials flag. The trade-off: a
-- can_view_financials stakeholder COULD see token rows through the
-- documents RLS branch — but `auth_user_org_project_ids()` only includes
-- org-member projects, so the WHERE filter eliminates them anyway.
-- =============================================================================

CREATE POLICY "document_tokens_select_org_members" ON public.document_tokens
  FOR SELECT TO authenticated
  USING (
    document_id IN (
      SELECT d.id FROM public.documents d
      WHERE d.deleted_at IS NULL
        AND d.project_id IN (SELECT auth_user_org_project_ids())
    )
  );

CREATE POLICY "document_tokens_insert_org_members" ON public.document_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    document_id IN (
      SELECT d.id FROM public.documents d
      WHERE d.deleted_at IS NULL
        AND d.project_id IN (SELECT auth_user_org_project_ids())
    )
  );

CREATE POLICY "document_tokens_update_org_members" ON public.document_tokens
  FOR UPDATE TO authenticated
  USING (
    document_id IN (
      SELECT d.id FROM public.documents d
      WHERE d.deleted_at IS NULL
        AND d.project_id IN (SELECT auth_user_org_project_ids())
    )
  )
  WITH CHECK (
    document_id IN (
      SELECT d.id FROM public.documents d
      WHERE d.deleted_at IS NULL
        AND d.project_id IN (SELECT auth_user_org_project_ids())
    )
  );

CREATE POLICY "document_tokens_delete_org_admins" ON public.document_tokens
  FOR DELETE TO authenticated
  USING (
    document_id IN (
      SELECT d.id FROM public.documents d
      WHERE d.deleted_at IS NULL
        AND d.project_id IN (SELECT auth_user_org_project_ids())
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role IN ('owner', 'admin')
        AND u.deleted_at IS NULL
    )
  );
