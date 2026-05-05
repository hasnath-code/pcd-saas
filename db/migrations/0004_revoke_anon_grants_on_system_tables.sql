-- Migration 0001 left an implicit local-vs-cloud divergence on system-table
-- GRANTs: cloud Supabase's `postgres`-grantor default privileges grant only
-- the limited Dxtm set to anon/authenticated on new public tables, while local
-- Supabase's `supabase_admin` default privileges grant the full arwdDxtm set.
-- Result: locally, anon could SELECT/INSERT/UPDATE/DELETE on webhook_events
-- and email_events even though both are designed as service-role-only paths
-- (with one exception below). Cloud was unaffected because the more restrictive
-- default privileges already blocked anon. Session 3's RLS test caught the
-- divergence on webhook_events.
--
-- webhook_events: service-role only. No legitimate user-facing path. Blanket
-- revoke from anon AND authenticated is correct.
--
-- email_events: RLS-enabled with an admin-only SELECT policy
-- (`email_events_select_admins`). Migration 0001 explicitly grants SELECT to
-- authenticated to enable that admin path; INSERT/UPDATE/DELETE were never
-- intended for users (only the Resend webhook processor writes). We REVOKE ALL
-- to wipe whatever default privileges leaked in, then re-GRANT SELECT only.
-- Final state is identical to the original design intent — explicit, with no
-- reliance on platform-default privileges. Defense in depth: anon has no path,
-- authenticated has SELECT only, RLS still gates row visibility to admins.
--
-- Same REVOKE pattern is applied to outbound_emails in migration 0005.

REVOKE ALL ON public.webhook_events FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON public.email_events FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.email_events TO authenticated;
