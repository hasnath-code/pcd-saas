// One-shot cleanup of orphaned auth.users rows created by inviteStakeholder
// invocations that hit Vercel 504 (DEBT-049). Magic-link Resend fired before
// the surrounding work could complete; the Drizzle transaction rolled back
// the public-schema rows (clients / project_stakeholders / invitations) but
// the auth.users row from the user's earlier signup attempt survives,
// blocking the email from being re-used in retest.
//
// Pass --apply to actually delete. Default is dry-run.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/cleanup-debt049-orphans.ts -- --email hasalique+s11stake@gmail.com
//   npx tsx --env-file=.env.local scripts/cleanup-debt049-orphans.ts -- --email <addr> --apply

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
function arg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const email = arg('--email');
const apply = args.includes('--apply');

if (!email) {
  console.error('--email <addr> is required');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. List auth users matching the email.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    console.error('listUsers failed:', listErr.message);
    process.exit(1);
  }
  const match = list.users.find((u) => u.email?.toLowerCase() === email!.toLowerCase());
  if (!match) {
    console.log(`No auth user found with email=${email}. Nothing to clean.`);
    return;
  }
  console.log(
    `Found auth.users row id=${match.id} email=${match.email} created=${match.created_at}`,
  );

  // 2. Make sure there's no public.clients or public.users referencing this
  //    auth_user_id — if there is, the row is NOT an orphan and this script
  //    must NOT delete it.
  const { data: linkedClient } = await admin
    .from('clients')
    .select('id')
    .eq('auth_user_id', match.id)
    .limit(1);
  const { data: linkedUser } = await admin
    .from('users')
    .select('id')
    .eq('auth_user_id', match.id)
    .limit(1);
  if ((linkedClient?.length ?? 0) > 0 || (linkedUser?.length ?? 0) > 0) {
    console.error(
      `Refusing to delete: auth user is linked to public.${
        linkedClient?.length ? 'clients' : 'users'
      } row. This is NOT an orphan.`,
    );
    process.exit(1);
  }

  if (!apply) {
    console.log('Dry-run mode. Re-run with --apply to delete.');
    return;
  }

  // 3. Delete.
  const { error: delErr } = await admin.auth.admin.deleteUser(match.id);
  if (delErr) {
    console.error('deleteUser failed:', delErr.message);
    process.exit(1);
  }
  console.log(`Deleted auth user ${match.id} (email=${match.email}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
