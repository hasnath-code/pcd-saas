import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Step 1 — load .env.local manually (no dotenv dep). Shell-set vars win over
// .env.local. Loaded so env.ts (when imported transitively) can validate the
// non-Supabase vars (Resend, Upstash, etc.).
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

// Step 2 — branch on mode.
//
// CLOUD_SMOKE=1: keep .env.local creds (cloud values). Sanity check the URL
//   is NOT local. Used by tests/cloud-smoke/*.test.ts to verify post-deploy
//   reachability of cloud Supabase.
// Default: fetch local Supabase creds from `supabase status -o env` and
//   override Supabase URL/keys. Pins tests to the local stack regardless of
//   what's in .env.local. Used by tests/rls/*.test.ts.

if (process.env.CLOUD_SMOKE === '1') {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!url || url.includes('127.0.0.1') || url.includes('localhost')) {
    throw new Error(
      `tests/setup: CLOUD_SMOKE=1 but URL is local or empty: '${url}'. Set .env.local cloud values.`,
    );
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('tests/setup: CLOUD_SMOKE=1 but NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  }
  // Service role key not strictly needed for anon-only smoke, but the lib
  // imports may pull env.ts which validates it — leave it as-is from .env.local.
} else {
  let local: Record<string, string>;
  try {
    const out = execSync('npx supabase status -o env', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    local = Object.fromEntries(
      out
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => {
          const eq = l.indexOf('=');
          return [
            l.slice(0, eq).trim(),
            l
              .slice(eq + 1)
              .trim()
              .replace(/^"|"$/g, ''),
          ];
        }),
    );
  } catch (e) {
    throw new Error(
      `tests/setup: failed to read 'supabase status -o env' — is local Supabase running? (${(e as Error).message})`,
    );
  }

  const apiUrl = local['API_URL'];
  const anonKey = local['ANON_KEY'];
  const serviceRoleKey = local['SERVICE_ROLE_KEY'];

  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('tests/setup: supabase status missing API_URL/ANON_KEY/SERVICE_ROLE_KEY');
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  if (!apiUrl.includes('127.0.0.1') && !apiUrl.includes('localhost')) {
    throw new Error(`tests/setup: refusing non-local Supabase URL: ${apiUrl}`);
  }
}
