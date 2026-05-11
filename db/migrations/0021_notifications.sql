CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_recipient_type_check" CHECK (recipient_type IN ('user', 'client')),
	CONSTRAINT "notifications_channel_check" CHECK (channel IN ('email', 'in_app', 'push', 'sms'))
);
--> statement-breakpoint
CREATE INDEX "idx_notifications_recipient_unread" ON "notifications" USING btree ("recipient_type","recipient_id") WHERE read_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_notifications_unsent" ON "notifications" USING btree ("channel") WHERE sent_at IS NULL;
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Role grants
-- Domain table: authenticated role gets SELECT + UPDATE; RLS policies further
-- restrict. INSERT and DELETE are NOT granted to authenticated — the dispatcher
-- and any cleanup jobs write through the Drizzle pooler (postgres role) which
-- bypasses RLS. This mirrors the spec literal in §12.6 which only defines
-- SELECT and UPDATE policies.
-- service_role inherits CRUD via migration 0003's ALTER DEFAULT PRIVILEGES.
-- =============================================================================
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — notifications
-- Spec §12.6 + ADR-016 (per-command, never FOR ALL).
--
-- Duck-typed recipient: recipient_type + recipient_id together identify which
-- identity (user or client) owns the row. NO foreign key — recipient_id is a
-- plain uuid resolved at dispatch time, because the same column lookup needs
-- to work for both users.id and clients.id with no FK relationship to either.
--
-- SELECT (self only): match recipient_type='user' against users.auth_user_id,
-- or recipient_type='client' against the SECURITY DEFINER helper from 0007.
-- Defense against a row pointed at the wrong identity table (recipient_type=
-- 'client' but recipient_id is a users.id) — the lookup naturally returns
-- zero matches, so the row stays invisible.
--
-- UPDATE (self only): same identity match. Used by markRead / markAllRead.
-- WITH CHECK mirrors USING so a user cannot UPDATE another user's row by
-- supplying their own identity in WHERE and another's in SET.
--
-- INSERT + DELETE: no authenticated policy. Dispatcher writes via the pooler.
-- =============================================================================
CREATE POLICY "notifications_select_self" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    (recipient_type = 'user' AND recipient_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (recipient_type = 'client' AND recipient_id IN (SELECT auth_user_client_ids()))
  );

CREATE POLICY "notifications_update_self" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    (recipient_type = 'user' AND recipient_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (recipient_type = 'client' AND recipient_id IN (SELECT auth_user_client_ids()))
  )
  WITH CHECK (
    (recipient_type = 'user' AND recipient_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (recipient_type = 'client' AND recipient_id IN (SELECT auth_user_client_ids()))
  );
--> statement-breakpoint

-- =============================================================================
-- Realtime publication
-- Add public.notifications to supabase_realtime so postgres_changes events fire
-- on INSERT / UPDATE / DELETE. The hook (hooks/use-notifications.ts, Phase 8)
-- subscribes with filter `recipient_id=eq.<id>`. RLS on notifications applies
-- at the subscription layer per ARCHITECTURE-saas.md §19 + §17.
--
-- Wrapped in a guard for re-runnability — supabase_realtime is created by
-- the platform; ALTER PUBLICATION ADD TABLE errors if the table is already
-- a member. Mirrors the 0016_messages.sql pattern.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
