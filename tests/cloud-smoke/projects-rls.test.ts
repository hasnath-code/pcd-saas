// Cloud smoke: anon-keyed REST reads on RLS-protected Phase 1b tables MUST
// return empty arrays (RLS blocks) or HTTP 401/403 — never expose data.
// Mirror reference-data-readable.test.ts structure but inverted assertion.
//
// Run with: npm run test:cloud-smoke
import { createClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';

describe('cloud Phase 1b tables are anon-blocked', () => {
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

  test('GET /rest/v1/projects returns no rows for anon (RLS blocks)', async () => {
    const { data, error, status } = await client.from('projects').select('id').limit(1);
    // Acceptable shapes: 200 + empty array (RLS filters), or 401/403 + error.
    if (status === 200) {
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });

  test('GET /rest/v1/clients returns no rows for anon (RLS blocks)', async () => {
    const { data, status } = await client.from('clients').select('id').limit(1);
    if (status === 200) {
      expect(data ?? []).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });

  test('GET /rest/v1/workflows returns no rows for anon (RLS blocks)', async () => {
    // System templates ARE readable by authenticated users but NOT by anon.
    const { data, status } = await client.from('workflows').select('id').limit(1);
    if (status === 200) {
      expect(data ?? []).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });
});
