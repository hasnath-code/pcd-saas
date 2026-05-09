CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"participant_type" text NOT NULL,
	"participant_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_conversation_participant_uniq" UNIQUE("conversation_id","participant_type","participant_id"),
	CONSTRAINT "conversation_participants_participant_type_check" CHECK (participant_type IN ('user', 'client'))
);
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_participants_conversation" ON "conversation_participants" USING btree ("conversation_id") WHERE left_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_conversation_participants_participant" ON "conversation_participants" USING btree ("participant_type","participant_id");
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — conversation_participants
-- Spec §12.2 + ADR-016 (per-command).
--
-- SELECT: visible if the parent conversation is visible (cross-references
--   conversations.SELECT — non-recursive because conversations.SELECT uses
--   the auth_user_conversation_ids() SECURITY DEFINER helper for the
--   stakeholder branch). Soft-leave (left_at IS NOT NULL) hides the row by
--   default; action-layer queries via Drizzle bypass RLS for history reads.
--
-- INSERT: org admins of the conversation's org. Auto-creators (postgres role
--   tx) bypass RLS.
--
-- UPDATE: self can update their own row (last_read_at via markConversationRead);
--   org admins can update any row in their org's conversations (left_at via
--   removeConversationParticipant).
--
-- DELETE: org admins only. Standard remove is soft (UPDATE left_at); hard
--   DELETE is admin-recovery.
-- =============================================================================
CREATE POLICY "conversation_participants_select" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    left_at IS NULL
    AND conversation_id IN (SELECT id FROM public.conversations)
  );

CREATE POLICY "conversation_participants_insert_org_admins" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND is_org_admin(c.org_id)
    )
  );

CREATE POLICY "conversation_participants_update" ON public.conversation_participants
  FOR UPDATE TO authenticated
  USING (
    (participant_type = 'user' AND participant_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR (participant_type = 'client' AND participant_id IN (SELECT auth_user_client_ids()))
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND is_org_admin(c.org_id)
    )
  )
  WITH CHECK (
    (participant_type = 'user' AND participant_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR (participant_type = 'client' AND participant_id IN (SELECT auth_user_client_ids()))
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND is_org_admin(c.org_id)
    )
  );

CREATE POLICY "conversation_participants_delete_org_admins" ON public.conversation_participants
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND is_org_admin(c.org_id)
    )
  );
