CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	CONSTRAINT "messages_sender_type_check" CHECK (sender_type IN ('user', 'client', 'system')),
	CONSTRAINT "messages_sender_id_consistency" CHECK ((sender_type = 'system' AND sender_id IS NULL) OR (sender_type <> 'system' AND sender_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_created" ON "messages" USING btree ("conversation_id", created_at DESC);--> statement-breakpoint
CREATE INDEX "idx_messages_sender" ON "messages" USING btree ("sender_type","sender_id");
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — messages
-- Spec §12.3 + ADR-016 (per-command) + Q6 (no deleted_at filter on SELECT).
--
-- SELECT: visible if the parent conversation is visible. NO deleted_at IS NULL
--   filter — soft-deleted messages remain queryable so the UI can render
--   '[deleted]' inline. Body-blanking happens in the action/query projection
--   layer in TypeScript (Decision 9.4B / Q6 answer).
--
-- INSERT: sender must be a current participant (helper); sender_type must
--   match auth identity (no impersonation); for client senders, the parent
--   project must have can_message=true on the stakeholder row. system
--   messages have no policy entry — service-role transactional helpers
--   bypass RLS to insert them.
--
-- UPDATE: sender-only. Used for editMessage (sets edited_at + body) and
--   deleteMessage (soft-delete via deleted_at). Senders cannot edit OTHER
--   senders' messages.
--
-- DELETE: org admins of the conversation's org only. Hard DELETE is admin
--   recovery; routine "delete" is soft via UPDATE deleted_at.
-- =============================================================================
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (SELECT id FROM public.conversations)
  );

CREATE POLICY "messages_insert_participants" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    conversation_id IN (SELECT auth_user_conversation_ids())
    AND (
      (sender_type = 'user' AND sender_id IN (
        SELECT u.id FROM public.users u
        WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
      ))
      OR (sender_type = 'client' AND sender_id IN (SELECT auth_user_client_ids()))
    )
    AND (
      sender_type <> 'client'
      OR EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
          AND (
            c.project_id IS NULL
            OR EXISTS (
              SELECT 1 FROM public.project_stakeholders ps
              WHERE ps.project_id = c.project_id
                AND ps.client_id = messages.sender_id
                AND ps.can_message = true
                AND ps.accepted_at IS NOT NULL
                AND ps.deleted_at IS NULL
            )
          )
      )
    )
  );

CREATE POLICY "messages_update_sender" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    (sender_type = 'user' AND sender_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR (sender_type = 'client' AND sender_id IN (SELECT auth_user_client_ids()))
  )
  WITH CHECK (
    (sender_type = 'user' AND sender_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR (sender_type = 'client' AND sender_id IN (SELECT auth_user_client_ids()))
  );

CREATE POLICY "messages_delete_org_admins" ON public.messages
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND is_org_admin(c.org_id)
    )
  );
--> statement-breakpoint

-- =============================================================================
-- Realtime publication
-- Add public.messages to supabase_realtime so postgres_changes events fire on
-- INSERT / UPDATE / DELETE. The hook (hooks/use-conversation-messages.ts)
-- subscribes with filter `conversation_id=eq.<id>`. RLS on messages applies
-- at the subscription layer per ARCHITECTURE-saas.md §19.
--
-- Wrapped in a guard for re-runnability — supabase_realtime is created by
-- the platform; ALTER PUBLICATION ADD TABLE errors if the table is already
-- a member.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
