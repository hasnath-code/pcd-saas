-- Cloud Supabase has TWO sets of default privileges configured on the public
-- schema by different grantors:
--   - by postgres:        anon/authenticated/service_role get Dxtm (admin-ish,
--                         no data CRUD) on new tables
--   - by supabase_admin:  same roles get arwdDxtm (full CRUD) on new tables
--
-- `supabase db push` connects as postgres, so tables created by our migrations
-- inherit the limited grant set. service_role has BYPASSRLS=true, but BYPASSRLS
-- only skips policy evaluation — table-level GRANTs are a separate layer, so
-- the seed runner (which uses the service-role JWT) gets "permission denied
-- for table" errors despite bypassing RLS.
--
-- Migration 0001 explicitly granted SELECT/CRUD to anon and authenticated for
-- the tables they need; it didn't grant CRUD to service_role (relying on
-- BYPASSRLS, which doesn't grant). Local Supabase has more permissive
-- postgres-grantor defaults so this gap is invisible there.
--
-- Fix: explicit per-existing-table CRUD grant for service_role + a default-
-- privileges entry so future tables created in public auto-grant to
-- service_role without needing this fix re-applied per session.
--
-- anon / authenticated keep the per-table explicit GRANT pattern from 0001
-- (RLS-gated user-facing roles; explicit control is preferred).

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
