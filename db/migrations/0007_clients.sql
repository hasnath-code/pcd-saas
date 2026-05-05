CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"company_name" text,
	"company_type" text,
	"billing_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "clients_email_unique" UNIQUE("email"),
	CONSTRAINT "clients_company_type_check" CHECK (
		company_type IS NULL OR company_type IN (
			'architect_firm', 'contractor', 'homeowner', 'engineer', 'developer', 'other'
		)
	)
);
--> statement-breakpoint
CREATE TABLE "client_org_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"first_added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "client_org_memberships_client_org_uniq" UNIQUE("client_id","org_id")
);
--> statement-breakpoint
ALTER TABLE "client_org_memberships" ADD CONSTRAINT "client_org_memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_org_memberships" ADD CONSTRAINT "client_org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clients_auth_user" ON "clients" USING btree ("auth_user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_clients_email" ON "clients" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_client_org_memberships_org" ON "client_org_memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_client_org_memberships_client" ON "client_org_memberships" USING btree ("client_id");
--> statement-breakpoint

-- =============================================================================
-- ===  HAND-WRITTEN BELOW THIS LINE                                         ===
-- ===  Anything above is drizzle-kit-managed (regenerated from db/schema/). ===
-- =============================================================================

-- =============================================================================
-- Cross-schema FK: clients.auth_user_id -> auth.users(id) ON DELETE SET NULL
-- (Drizzle doesn't model cross-schema FKs cleanly; declared in raw SQL.)
-- Phase 1c stakeholders may have a Supabase auth identity once they accept;
-- before acceptance auth_user_id is NULL. SET NULL on auth deletion preserves
-- the client record (history) while severing the auth link.
-- =============================================================================
ALTER TABLE "clients" ADD CONSTRAINT "clients_auth_user_id_auth_users_id_fk"
  FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- =============================================================================
-- Phase 1b backfill (per spec §11): audit_logs.client_id -> clients(id)
-- The column existed in 0001 as a forward-compat hook; the FK lands now that
-- clients exists. ON DELETE SET NULL preserves the audit row when a client
-- is hard-deleted (which shouldn't happen in normal flow — soft-delete only).
-- =============================================================================
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_client_id_clients_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- =============================================================================
-- SECURITY DEFINER helpers for clients + client_org_memberships RLS.
-- Both helpers bypass RLS to break the recursion that would otherwise occur:
-- clients_select needs to consult memberships, and memberships_select needs
-- to consult clients. Without these helpers Postgres detects an infinite-
-- recursion-in-policy error (42P17). search_path is pinned per Phase 1a's
-- helper convention.
-- =============================================================================

-- Replace the auth_user_stakeholder_orgs() stub from migration 0001 with the
-- real implementation. Returns the org_ids of all orgs where the current user
-- has a non-deleted client membership. Signature unchanged; existing callers
-- continue to work (the stub was a no-op SELECT NULL WHERE FALSE).
CREATE OR REPLACE FUNCTION public.auth_user_stakeholder_orgs()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT com.org_id
  FROM public.client_org_memberships com
  JOIN public.clients c ON c.id = com.client_id
  WHERE c.auth_user_id = auth.uid()
    AND c.deleted_at IS NULL;
$$;
--> statement-breakpoint

-- Returns the client_ids where the current auth user IS that client (i.e.
-- clients.auth_user_id = auth.uid()). Used by the client_org_memberships
-- SELECT policy so it can match "my own client row's memberships" without
-- recursing back into clients_select.
CREATE OR REPLACE FUNCTION public.auth_user_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT id FROM public.clients
  WHERE auth_user_id = auth.uid()
    AND deleted_at IS NULL;
$$;
--> statement-breakpoint

-- Returns the client_ids that are linked (via client_org_memberships) to any
-- org the current auth user is a non-deleted member of. Used by the
-- clients_select policy's "I'm an org member of this client's org" branch
-- without recursing back into memberships_select.
CREATE OR REPLACE FUNCTION public.auth_user_org_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT com.client_id
  FROM public.client_org_memberships com
  WHERE com.org_id IN (
    SELECT u.org_id FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.deleted_at IS NULL
  );
$$;
--> statement-breakpoint

-- =============================================================================
-- Role grants
-- clients: authenticated reads gated by RLS (self-or-org-member). Updates
-- restricted to self via RLS. Inserts via service role only (signup or
-- findOrCreateClient action via Drizzle pooler bypasses RLS).
-- client_org_memberships: authenticated reads gated by RLS (org member or
-- self-as-client). Writes via service role only.
-- =============================================================================
GRANT SELECT, UPDATE ON public.clients TO authenticated;
GRANT SELECT ON public.client_org_memberships TO authenticated;
--> statement-breakpoint

-- =============================================================================
-- Enable Row-Level Security
-- =============================================================================
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_org_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — clients
-- A client row is visible to (a) the authenticated user whose auth_user_id
-- matches it (the stakeholder themselves, post-acceptance), or (b) any org
-- member of an org that has a client_org_memberships row pointing at this
-- client. Updates restricted to self only — org users update via service role
-- through the updateClient action (which performs its own org check).
--
-- Recursion-safe: the second OR branch uses auth_user_org_client_ids() which
-- bypasses RLS via SECURITY DEFINER, so this policy doesn't loop through
-- memberships_select.
-- =============================================================================
CREATE POLICY "clients_select_self_or_org_member" ON public.clients
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      auth_user_id = auth.uid()
      OR id IN (SELECT auth_user_org_client_ids())
    )
  );

CREATE POLICY "clients_update_self" ON public.clients
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (auth_user_id = auth.uid());
-- INSERT/DELETE: service role only.
--> statement-breakpoint

-- =============================================================================
-- RLS Policies — client_org_memberships
-- Visible to org members of the linked org, and to the client themselves.
-- Writes (link/unlink) via service role only — managed via findOrCreateClient
-- and Phase 1c stakeholder removal flows.
--
-- Recursion-safe: the second OR branch uses auth_user_client_ids() (SECURITY
-- DEFINER) instead of querying clients directly, so this policy doesn't loop
-- through clients_select.
-- =============================================================================
CREATE POLICY "client_org_memberships_select" ON public.client_org_memberships
  FOR SELECT TO authenticated
  USING (
    is_org_member(org_id)
    OR client_id IN (SELECT auth_user_client_ids())
  );
-- INSERT/UPDATE/DELETE: service role only.
