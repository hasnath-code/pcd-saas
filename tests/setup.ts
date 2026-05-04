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

// Step 2 — fetch local Supabase creds from `supabase status -o env` and
// override the relevant vars. This pins tests to the local stack regardless
// of what's in .env.local.
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

// Step 3 — refuse to run unless URL is local.
if (!apiUrl.includes('127.0.0.1') && !apiUrl.includes('localhost')) {
  throw new Error(`tests/setup: refusing non-local Supabase URL: ${apiUrl}`);
}
