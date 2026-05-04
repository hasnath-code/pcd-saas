-- Cloud Supabase auto-enables RLS on every new public-schema table by default;
-- local Supabase does not. Migration 0001 only included `ENABLE ROW LEVEL SECURITY`
-- statements (relying on the absence of ENABLE to mean "stays off"), which works
-- locally but leaves cloud with RLS=true on org_types, plans, webhook_events.
--
-- Per ARCHITECTURE-saas.md §10.1 / §10.2 / §10.8 these three tables MUST have
-- RLS disabled:
--   - org_types, plans   reference data, anon SELECT required for signup UI
--   - webhook_events      system table, service-role-only access
--
-- Pattern locked in for future sessions (per Session 2 handover): every new
-- public-schema table gets an explicit ENABLE or DISABLE statement, never
-- left to default.

ALTER TABLE public.org_types DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.plans DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.webhook_events DISABLE ROW LEVEL SECURITY;
