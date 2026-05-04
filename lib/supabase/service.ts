import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/env';

// Service-role client. BYPASSES RLS. Permitted uses (per ARCHITECTURE-saas.md §9):
//   - Migrations / seeding
//   - Webhook ingestion route (writes to webhook_events cross-org)
//   - Internal cron jobs (retention, scheduled notifications)
//   - Tests
//
// Never use in user-facing server actions — those use the session-bound client
// from ./server.ts so RLS enforces the caller's org boundary.
//
// `import 'server-only'` makes the build fail loudly if anything in the client
// bundle imports this module.
export function createServiceClient() {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
