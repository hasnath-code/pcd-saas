// Wrapper around db/seed/run.ts that points at the LOCAL Supabase stack.
//
// Reads creds from `npx supabase status -o env`, overrides the Supabase env
// vars (URL / anon key / service-role key) with local values, then defers to
// the regular seed flow via dynamic import so the override happens before any
// transitive import of env.ts evaluates.
//
// USAGE: npm run db:seed:local
//
// .env.local must still be present (`--env-file=.env.local` in the npm script
// loads non-Supabase env vars that env.ts validates, e.g. Resend, Upstash,
// Sentry, NEXT_PUBLIC_APP_URL, INTERNAL_CRON_SECRET).
import { execSync } from 'node:child_process';

function parseSupabaseStatusEnv(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function main() {
  const out = execSync('npx supabase status -o env', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const localEnv = parseSupabaseStatusEnv(out);

  const apiUrl = localEnv.API_URL;
  const anonKey = localEnv.ANON_KEY;
  const serviceRoleKey = localEnv.SERVICE_ROLE_KEY;

  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      'db:seed:local: could not extract API_URL / ANON_KEY / SERVICE_ROLE_KEY from `supabase status -o env`. Is the local stack running? Try `npx supabase start`.',
    );
  }
  if (!apiUrl.includes('127.0.0.1') && !apiUrl.includes('localhost')) {
    throw new Error(
      `db:seed:local: refusing to run — API_URL is not local: ${apiUrl}`,
    );
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  await import('./run');
}

main().catch((err) => {
  console.error('[seed:local] failed:', err);
  process.exit(1);
});
