// Cloud smoke: anon-keyed REST reads should succeed against the CLOUD
// Supabase project. These tests verify reference data tables (org_types,
// plans) are visible to anonymous callers — the failure mode that would
// occur if RLS were left enabled on those tables (see SESSION-2-HANDOVER
// "Surprises / gotchas").
//
// Pre-seed: assertions are length-agnostic — empty array proves RLS isn't
// blocking; the check is "no error + status 200 + array".
// Post-seed: re-running prints non-zero counts via console.log.
//
// Run with:   npm run test:cloud-smoke
// (Sets CLOUD_SMOKE=1 so tests/setup.ts keeps cloud creds from .env.local.)
import { createClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';

describe('cloud reference data is anon-readable', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  test('target is cloud, not local', () => {
    expect(url.includes('127.0.0.1')).toBe(false);
    expect(url.includes('localhost')).toBe(false);
    expect(url.startsWith('https://')).toBe(true);
  });

  test('GET /rest/v1/org_types returns 200 (anon allowed)', async () => {
    const { data, error, status } = await client.from('org_types').select('slug, name');
    expect(error).toBeNull();
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    console.log(`[cloud-smoke] org_types: ${data!.length} rows`);
  });

  test('GET /rest/v1/plans returns 200 (anon allowed)', async () => {
    const { data, error, status } = await client
      .from('plans')
      .select('slug, price_monthly_pence');
    expect(error).toBeNull();
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    console.log(`[cloud-smoke] plans: ${data!.length} rows`);
  });
});
