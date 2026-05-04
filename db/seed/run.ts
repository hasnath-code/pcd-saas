// Seed runner. Always uses the service-role client (createServiceClient()) so
// RLS is bypassed during seed inserts. Never the pooler db client.
//
// USAGE:
//   Cloud target  (uses .env.local):
//     npm run db:seed
//
//   Local Supabase target (overrides Supabase URL + key for the run):
//     npx supabase status -o env > .env.seed-local && \
//       export $(grep -E '^(API_URL|SERVICE_ROLE_KEY)=' .env.seed-local | xargs) && \
//       NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
//       SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
//       npm run db:seed
//
// Idempotent: each seed function reads existing rows and only inserts what's
// missing. Safe to re-run.
import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { seedOrgTypes } from './org-types';
import { seedPlans } from './plans';

async function main() {
  const supabase = createServiceClient();
  console.log(`[seed] target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  await seedOrgTypes(supabase);
  await seedPlans(supabase);

  console.log('[seed] done.');
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
