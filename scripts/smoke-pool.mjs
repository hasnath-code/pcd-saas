// One-off smoke test: confirms the runtime pooler URL works end-to-end.
// - reads .env.local via Node's --env-file flag (Node 20.6+)
// - opens a postgres-js client matching db/index.ts (max:1, prepare:false)
// - reads from auth.users (always exists in any Supabase project)
//
// Usage:
//   node --env-file=.env.local scripts/smoke-pool.mjs
//
// Expected output:
//   Pooler OK. auth.users count: <n>

import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Run with: node --env-file=.env.local scripts/smoke-pool.mjs');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const rows = await sql`SELECT count(*)::int AS count FROM auth.users`;
  console.log(`Pooler OK. auth.users count: ${rows[0].count}`);
} catch (err) {
  console.error('Pooler FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
