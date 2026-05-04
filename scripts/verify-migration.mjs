// One-off post-migration smoke check. Lists tables, RLS state, policies,
// helper functions, FKs. Run with `node --env-file=../.env.local scripts/verify-migration.mjs`
// from the worktree root, OR set DATABASE_URL_LOCAL inline.
import postgres from 'postgres';

const sql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres');

const tables = await sql`
  SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname='public' ORDER BY tablename
`;
console.log(`Tables: ${tables.length}`);
for (const t of tables) console.log(`  ${t.tablename.padEnd(20)} RLS=${t.rowsecurity}`);

const policies = await sql`
  SELECT tablename, policyname, cmd, roles FROM pg_policies
  WHERE schemaname='public' ORDER BY tablename, policyname
`;
console.log(`\nPolicies: ${policies.length}`);
for (const p of policies)
  console.log(`  ${p.tablename.padEnd(20)} ${p.cmd.padEnd(7)} ${p.policyname}`);

const fns = await sql`
  SELECT proname, prosecdef, provolatile FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace=n.oid
  WHERE n.nspname='public'
    AND (proname LIKE 'auth_user_%' OR proname LIKE 'is_org_%')
  ORDER BY proname
`;
console.log(`\nHelper functions: ${fns.length}`);
for (const f of fns)
  console.log(`  ${f.proname.padEnd(40)} secdef=${f.prosecdef} volatile=${f.provolatile}`);

const fks = await sql`
  SELECT conname FROM pg_constraint
  WHERE conrelid='public.users'::regclass AND contype='f' ORDER BY conname
`;
console.log(`\nusers FKs: ${fks.length}`);
for (const f of fks) console.log(`  ${f.conname}`);

await sql.end();
