// One-shot Realtime smoke for the notifications publication. Mirrors what
// the in-app inbox does at runtime (postgres_changes INSERT filtered by
// recipient_id), but driven from Node — no browser required. Asserts the
// publication broadcasts within 5 seconds of a service-role insert.
//
// Run from the repo root against local Supabase:
//   node scripts/realtime-smoke-notifications.mjs
//
// Exits 0 on success, 1 on no-event timeout. Always cleans up its test row.

import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';
import { execSync } from 'node:child_process';

// Pin to LOCAL Supabase via `supabase status -o env`. .env.local points at
// cloud Supabase (where our Session 11 migrations haven't shipped yet);
// the smoke validates the publication + Realtime pipeline against the local
// stack where our migrations have been applied.
const out = execSync('npx supabase status -o env', { encoding: 'utf-8' });
const local = Object.fromEntries(
  out
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const eq = l.indexOf('=');
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^"|"$/g, '')];
    }),
);
const url = local.API_URL;
const anon = local.ANON_KEY;
const service = local.SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error('Missing local Supabase creds from `supabase status -o env`');
  process.exit(1);
}
console.log('[smoke] target:', url);

const adminClient = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tag = `realtime-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `${tag}@test.local`;

// 1. Create an auth user + a users row so we have a valid recipient.
//    organizations / org_types / plans seed is assumed present.
const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
  email,
  password: `pw-${tag}-x9X`,
  email_confirm: true,
});
if (authErr || !authData.user) {
  console.error('createUser failed:', authErr?.message);
  process.exit(1);
}

const { data: types } = await adminClient.from('org_types').select('id').eq('slug', 'surveyor').limit(1);
const { data: plans } = await adminClient
  .from('plans')
  .select('id')
  .eq('org_type_id', types?.[0]?.id ?? '')
  .limit(1);
const orgId = uuidv7();
await adminClient.from('organizations').insert({
  id: orgId,
  name: `Realtime Smoke ${tag}`,
  type_id: types?.[0]?.id,
  plan_id: plans?.[0]?.id,
});
const userId = uuidv7();
await adminClient.from('users').insert({
  id: userId,
  auth_user_id: authData.user.id,
  org_id: orgId,
  email,
  name: 'Smoke User',
  role: 'owner',
});

// 2. Sign in as the user (real anon-key client with a session token), so RLS
//    on notifications applies as it would for a real subscriber.
const userClient = createClient(url, anon, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error: signInErr } = await userClient.auth.signInWithPassword({
  email,
  password: `pw-${tag}-x9X`,
});
if (signInErr) {
  console.error('signIn failed:', signInErr.message);
  await cleanup();
  process.exit(1);
}

// 3. Subscribe to the same channel + filter the hook uses.
let received = null;
const channel = userClient
  .channel(`notifications:user:${userId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `recipient_id=eq.${userId}`,
    },
    (payload) => {
      received = payload.new;
    },
  )
  .subscribe((status) => {
    console.log('[smoke] subscription status:', status);
  });

// Wait for SUBSCRIBED.
await new Promise((r) => setTimeout(r, 1500));

// 4. Insert a notification row via service role.
const notifId = uuidv7();
const { error: insErr } = await adminClient.from('notifications').insert({
  id: notifId,
  recipient_type: 'user',
  recipient_id: userId,
  channel: 'in_app',
  event_type: 'message.new',
  payload: { snippet: 'realtime smoke' },
});
if (insErr) {
  console.error('insert failed:', insErr.message);
  await cleanup();
  process.exit(1);
}

// 5. Wait up to 5s for the event.
const start = Date.now();
while (!received && Date.now() - start < 5000) {
  await new Promise((r) => setTimeout(r, 200));
}

await userClient.removeChannel(channel);

if (received) {
  console.log(`[smoke] ✅ Realtime fired in ${Date.now() - start}ms — id=${received.id}`);
  await cleanup();
  process.exit(0);
} else {
  console.error('[smoke] ❌ Realtime did NOT fire within 5s');
  await cleanup();
  process.exit(1);
}

async function cleanup() {
  await adminClient.from('notifications').delete().eq('recipient_id', userId);
  await adminClient.from('users').delete().eq('id', userId);
  await adminClient.from('organizations').delete().eq('id', orgId);
  await adminClient.auth.admin.deleteUser(authData.user.id);
}
