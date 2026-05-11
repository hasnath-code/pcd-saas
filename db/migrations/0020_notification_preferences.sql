CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"client_id" uuid,
	"channel" text NOT NULL,
	"event_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_user_channel_event_uniq" UNIQUE("user_id","channel","event_type"),
	CONSTRAINT "notification_preferences_client_channel_event_uniq" UNIQUE("client_id","channel","event_type"),
	CONSTRAINT "notification_preferences_channel_check" CHECK (channel IN ('email', 'in_app', 'push', 'sms')),
	CONSTRAINT "notification_preferences_owner_xor" CHECK ((user_id IS NOT NULL) <> (client_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — notification_preferences
-- Spec §12.5 + ADR-016 (per-command, never FOR ALL).
--
-- Self-only access on every command. The XOR CHECK guarantees exactly one of
-- user_id / client_id is set, so a row belongs to a single identity and the
-- branches in the policy USING/WITH CHECK clauses are mutually exclusive.
--
-- Server actions write/update prefs through the Drizzle pooler (postgres role,
-- bypasses RLS). These policies guard against unauthorized REST writes —
-- defense-in-depth.
--
-- No deleted_at column on this table (preferences are owned by users/clients
-- and CASCADE when the parent is deleted), so SELECT does not filter on it.
-- =============================================================================
CREATE POLICY "notification_preferences_select_self" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (
    (user_id IS NOT NULL AND user_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (client_id IS NOT NULL AND client_id IN (SELECT auth_user_client_ids()))
  );

CREATE POLICY "notification_preferences_insert_self" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NOT NULL AND user_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (client_id IS NOT NULL AND client_id IN (SELECT auth_user_client_ids()))
  );

CREATE POLICY "notification_preferences_update_self" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (
    (user_id IS NOT NULL AND user_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (client_id IS NOT NULL AND client_id IN (SELECT auth_user_client_ids()))
  )
  WITH CHECK (
    (user_id IS NOT NULL AND user_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (client_id IS NOT NULL AND client_id IN (SELECT auth_user_client_ids()))
  );

CREATE POLICY "notification_preferences_delete_self" ON public.notification_preferences
  FOR DELETE TO authenticated
  USING (
    (user_id IS NOT NULL AND user_id IN (
      SELECT u.id FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL
    ))
    OR
    (client_id IS NOT NULL AND client_id IN (SELECT auth_user_client_ids()))
  );
