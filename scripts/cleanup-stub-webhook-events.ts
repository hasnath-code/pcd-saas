import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

// One-shot cleanup of Session-3-era stub webhook_events rows. The Phase 1a
// stub sendEmail() inserted webhook_events rows with payload.stub=true so the
// email_events.webhook_event_id NOT NULL FK could be honored before real
// Resend wiring shipped. Now that Session 4 wired real Resend (Task D), the
// stubs are obsolete.
//
// Hard delete (not soft) — webhook_events is append-only system data with
// no soft-delete column. email_events FK has ON DELETE CASCADE so projected
// rows go with the stub.
//
// One audit row written. Note: 'soft_delete' is the closest verb in the
// AuditAction union for what's actually a hard delete; metadata.hard_delete
// disambiguates. A 'system_cleanup' verb is flagged as carryover §35.4.
//
// Run against BOTH environments — local and cloud — to keep the bisect
// surface clean. Override env vars to switch targets:
//   npm run db:cleanup-stubs                     # local (.env.local has cloud — see note)
//   NEXT_PUBLIC_SUPABASE_URL=$CLOUD_URL \
//     SUPABASE_SERVICE_ROLE_KEY=$CLOUD_KEY \
//     npm run db:cleanup-stubs                   # cloud override

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`[cleanup-stubs] target: ${url}`);

  const { data: stubs, error: selErr } = await supabase
    .from('webhook_events')
    .select('id')
    .filter('payload->>stub', 'eq', 'true');
  if (selErr) throw selErr;

  const count = stubs?.length ?? 0;
  console.log(`[cleanup-stubs] found ${count} stub rows`);

  if (count === 0) {
    console.log('[cleanup-stubs] nothing to clean up.');
    return;
  }

  const { error: delErr } = await supabase
    .from('webhook_events')
    .delete()
    .filter('payload->>stub', 'eq', 'true');
  if (delErr) throw delErr;
  console.log(`[cleanup-stubs] hard-deleted ${count} stub rows.`);

  const { error: auditErr } = await supabase.from('audit_logs').insert({
    id: uuidv7(),
    org_id: null,
    user_id: null,
    action: 'soft_delete',
    resource_type: 'webhook_events',
    resource_id: null,
    metadata: {
      cleanup: 'session_4_stub_purge',
      hard_delete: true,
      count,
      reason: 'Real Resend wiring shipped; stub rows no longer needed',
      ran_at: new Date().toISOString(),
    },
  });
  if (auditErr) throw auditErr;
  console.log('[cleanup-stubs] audit row written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
