CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"type" text NOT NULL,
	"name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "conversations_type_check" CHECK (type IN ('one_to_one', 'group', 'general'))
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversations_project" ON "conversations" USING btree ("project_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_conversations_org" ON "conversations" USING btree ("org_id") WHERE deleted_at IS NULL;
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- SECURITY DEFINER helper STUB — auth_user_conversation_ids().
--
-- Mirrors the Phase 1a stub pattern (auth_user_stakeholder_projects() in 0001
-- → unstubbed in 0013). The real body references conversation_participants
-- which doesn't exist yet at this point in the migration sequence; ships in
-- 0017_conversation_helpers.sql once 0015 has created the dependency.
--
-- Returns SETOF uuid (empty until unstubbed). Used by per-command RLS
-- policies on conversations / conversation_participants / messages to break
-- the conversations ↔ conversation_participants recursion (textbook 42P17;
-- see SKILL.md Hard Rule 20). search_path pinned per the Phase 1a convention.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_conversation_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT NULL::uuid WHERE FALSE;
$$;
--> statement-breakpoint

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets CRUD; RLS policies further restrict.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — conversations
-- Spec §12.1 + ADR-016 (per-command, never FOR ALL).
--
-- SELECT: org members of conversations.org_id see all org conversations
--   (transparency model — replaces shared inbox). Stakeholders see only
--   conversations they actively participate in (via SECURITY DEFINER helper
--   to break recursion).
--
-- INSERT: org members only, and the created_by must match the auth user's
--   own users.id row. Stakeholders cannot create conversations directly —
--   only via auto-create transactional helpers (autoCreateOneToOneConversationTx,
--   autoCreateGeneralConversationTx) which run with postgres role and bypass
--   RLS.
--
-- UPDATE: org admins only (rename, soft-delete).
--
-- DELETE: org admins only. Standard delete is soft (UPDATE deleted_at);
--   hard delete is admin-recovery.
-- =============================================================================
CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      is_org_member(org_id)
      OR id IN (SELECT auth_user_conversation_ids())
    )
  );

CREATE POLICY "conversations_insert_org_members" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_org_member(org_id)
    AND created_by IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    )
  );

CREATE POLICY "conversations_update_org_admins" ON public.conversations
  FOR UPDATE TO authenticated
  USING (is_org_admin(org_id))
  WITH CHECK (is_org_admin(org_id));

CREATE POLICY "conversations_delete_org_admins" ON public.conversations
  FOR DELETE TO authenticated
  USING (is_org_admin(org_id));
