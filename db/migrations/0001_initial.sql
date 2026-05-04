CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"client_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"org_id" uuid,
	"message_id" text NOT NULL,
	"recipient" text NOT NULL,
	"event_type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_event_type_check" CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "org_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"default_workflow_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_type_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"price_monthly_pence" integer DEFAULT 0 NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_org_type_slug_uniq" UNIQUE("org_type_id","slug")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"custom_email_domain" text,
	"custom_email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_auth_user_org_uniq" UNIQUE("auth_user_id","org_id"),
	CONSTRAINT "users_role_check" CHECK (role IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invitation_type" text NOT NULL,
	"role" text,
	"project_id" uuid,
	"stakeholder_role" text,
	"visibility_profile" text,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invitations_token_unique" UNIQUE("token"),
	CONSTRAINT "invitations_type_check" CHECK (invitation_type IN ('team_member', 'stakeholder'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_verified" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_source_external_uniq" UNIQUE("source","external_event_id"),
	CONSTRAINT "webhook_events_source_check" CHECK (source IN ('resend', 'stripe', 'twilio'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_org_type_id_org_types_id_fk" FOREIGN KEY ("org_type_id") REFERENCES "public"."org_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_type_id_org_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."org_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_org_created" ON "audit_logs" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_email_events_message" ON "email_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_email_events_org_recipient" ON "email_events" USING btree ("org_id","recipient");--> statement-breakpoint
CREATE INDEX "idx_plans_org_type" ON "plans" USING btree ("org_type_id");--> statement-breakpoint
CREATE INDEX "idx_organizations_type" ON "organizations" USING btree ("type_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_organizations_plan" ON "organizations" USING btree ("plan_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_auth_user" ON "users" USING btree ("auth_user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_org" ON "users" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "org_settings_org_key_active_uniq" ON "org_settings" USING btree ("org_id","key") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_org_settings_org" ON "org_settings" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_invitations_token" ON "invitations" USING btree ("token") WHERE accepted_at IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_invitations_email" ON "invitations" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_invitations_org" ON "invitations" USING btree ("org_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_webhook_events_source_created" ON "webhook_events" USING btree ("source","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_webhook_events_unprocessed" ON "webhook_events" USING btree ("source") WHERE processed_at IS NULL;
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Cross-schema FK: users.auth_user_id -> auth.users(id)
-- (Drizzle doesn't model cross-schema FKs cleanly; we declare in raw SQL here.)
-- =============================================================================
ALTER TABLE "users" ADD CONSTRAINT "users_auth_user_id_auth_users_id_fk"
  FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- =============================================================================
-- SECURITY DEFINER helper functions
-- These wrap RLS-recursive lookups (a users-table policy can't query users
-- directly without infinite recursion). Helpers are STABLE = cached per query.
-- search_path is pinned to prevent search-path attacks.
-- See ARCHITECTURE-saas.md §9 (Multi-Tenancy & RLS Conventions).
-- =============================================================================

-- All non-deleted org memberships of the current user (org_id only).
CREATE OR REPLACE FUNCTION public.auth_user_orgs()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT org_id FROM public.users
  WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
$$;
--> statement-breakpoint

-- True iff the current user is a non-deleted member of the given org.
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid()
      AND deleted_at IS NULL
      AND org_id = _org_id
  );
$$;
--> statement-breakpoint

-- True iff the current user is owner OR admin of the given org.
CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid()
      AND deleted_at IS NULL
      AND org_id = _org_id
      AND role IN ('owner', 'admin')
  );
$$;
--> statement-breakpoint

-- True iff the current user is owner of the given org.
CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid()
      AND deleted_at IS NULL
      AND org_id = _org_id
      AND role = 'owner'
  );
$$;
--> statement-breakpoint

-- STUB until Phase 1b ships clients + client_org_memberships tables.
-- Phase 1b first migration replaces the body to query stakeholder org membership.
CREATE OR REPLACE FUNCTION public.auth_user_stakeholder_orgs()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT NULL::uuid WHERE FALSE;
$$;
--> statement-breakpoint

-- STUB until Phase 1b ships project_stakeholders table.
-- Phase 1b first migration replaces the body to query stakeholder project access.
CREATE OR REPLACE FUNCTION public.auth_user_stakeholder_projects()
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
-- Supabase typically grants public schema usage to anon/authenticated by
-- default, but we declare per-table grants explicitly for clarity and to make
-- intent reviewable in one place.
-- =============================================================================

-- Reference data: anyone (incl. anon) reads, no writes from app roles.
GRANT SELECT ON public.org_types TO anon, authenticated;
GRANT SELECT ON public.plans TO anon, authenticated;
--> statement-breakpoint

-- Domain tables: authenticated role gets CRUD; RLS policies further restrict.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
--> statement-breakpoint

-- Append-only tables: authenticated reads (filtered by RLS); writes via service role only.
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.email_events TO authenticated;
--> statement-breakpoint

-- webhook_events: service role only. No grants for anon/authenticated.

-- =============================================================================
-- Enable Row-Level Security
-- Six domain tables: organizations, users, org_settings, invitations,
-- audit_logs, email_events.
-- Three remain DISABLED: org_types, plans (reference data),
-- webhook_events (system table, service-role only).
-- =============================================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies
-- Naming: <table>_<operation>_<scope> per ARCHITECTURE-saas.md §5.
-- All policies scope to authenticated; anonymous gets no access by default.
-- INSERTs done by service role bypass RLS entirely (signup, invitation accept,
-- webhook ingest, audit log writes).
-- =============================================================================

-- ----- organizations ---------------------------------------------------------
CREATE POLICY "organizations_select_members" ON public.organizations
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_org_member(id));

CREATE POLICY "organizations_update_owners" ON public.organizations
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND is_org_owner(id))
  WITH CHECK (is_org_owner(id));
-- INSERT: service role only (signup flow). DELETE: soft-delete only.
--> statement-breakpoint

-- ----- users -----------------------------------------------------------------
CREATE POLICY "users_select_org_members" ON public.users
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_org_member(org_id));

CREATE POLICY "users_update_self_or_admin" ON public.users
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (auth_user_id = auth.uid() OR is_org_admin(org_id))
  )
  WITH CHECK (auth_user_id = auth.uid() OR is_org_admin(org_id));
-- INSERT: service role only (signup, invitation accept).
-- DELETE: soft-delete only.
--> statement-breakpoint

-- ----- org_settings ----------------------------------------------------------
CREATE POLICY "org_settings_select_members" ON public.org_settings
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_org_member(org_id));

CREATE POLICY "org_settings_insert_admins" ON public.org_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_org_admin(org_id));

CREATE POLICY "org_settings_update_admins" ON public.org_settings
  FOR UPDATE TO authenticated
  USING (is_org_admin(org_id))
  WITH CHECK (is_org_admin(org_id));
-- DELETE: soft-delete via UPDATE; no hard delete.
--> statement-breakpoint

-- ----- invitations -----------------------------------------------------------
CREATE POLICY "invitations_select_admins" ON public.invitations
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND is_org_admin(org_id));

CREATE POLICY "invitations_insert_admins" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (is_org_admin(org_id));

CREATE POLICY "invitations_update_admins" ON public.invitations
  FOR UPDATE TO authenticated
  USING (is_org_admin(org_id))
  WITH CHECK (is_org_admin(org_id));
-- Acceptance flow (writes accepted_at) goes via service role.
--> statement-breakpoint

-- ----- audit_logs ------------------------------------------------------------
-- Append-only. SELECT for admins; INSERT via service role only (logAudit()).
CREATE POLICY "audit_logs_select_admins" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND is_org_admin(org_id));
--> statement-breakpoint

-- ----- email_events ----------------------------------------------------------
-- Projection table. SELECT for admins; INSERT via service role (webhook ingest).
CREATE POLICY "email_events_select_admins" ON public.email_events
  FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND is_org_admin(org_id));