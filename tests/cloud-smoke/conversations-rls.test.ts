// Cloud smoke: anon-keyed REST reads on RLS-protected Phase 1c tables MUST
// return empty arrays (RLS blocks) or HTTP 401/403 — never expose data.
// Mirrors tests/cloud-smoke/projects-rls.test.ts structure.
//
// Run with: npm run test:cloud-smoke
import { createClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';

describe('cloud Phase 1c tables are anon-blocked', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  test('GET /rest/v1/conversations returns no rows for anon (RLS blocks)', async () => {
    const { data, status } = await client.from('conversations').select('id').limit(1);
    if (status === 200) {
      expect(data ?? []).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });

  test('GET /rest/v1/conversation_participants returns no rows for anon (RLS blocks)', async () => {
    const { data, status } = await client
      .from('conversation_participants')
      .select('id')
      .limit(1);
    if (status === 200) {
      expect(data ?? []).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });

  test('GET /rest/v1/messages returns no rows for anon (RLS blocks)', async () => {
    const { data, status } = await client.from('messages').select('id').limit(1);
    if (status === 200) {
      expect(data ?? []).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });
});
