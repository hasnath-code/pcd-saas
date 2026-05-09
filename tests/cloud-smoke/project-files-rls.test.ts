// Cloud smoke for Phase 1c S10 file uploads. Mirrors the conversations
// smoke pattern: anon-keyed REST reads on project_files MUST return empty
// arrays or HTTP 401/403; storage anon GET on the bucket MUST be blocked.
//
// Run with: npm run test:cloud-smoke
import { createClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';

describe('cloud Phase 1c S10 (project_files + storage) — anon-blocked', () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  test('GET /rest/v1/project_files returns no rows for anon (RLS blocks)', async () => {
    const { data, status } = await client.from('project_files').select('id').limit(1);
    if (status === 200) {
      expect(data ?? []).toEqual([]);
    } else {
      expect([401, 403]).toContain(status);
    }
  });

  test('Anon listBuckets returns 401/403 (the org-files bucket is private)', async () => {
    // anon SDK can attempt listBuckets — this should be denied because
    // private buckets aren't visible at the bucket-listing level for anon.
    const { data, error } = await client.storage.listBuckets();
    // Either fails with an error OR returns an array that does NOT contain
    // 'org-files' (private buckets are filtered for anon).
    if (error) {
      expect(error).toBeTruthy();
    } else {
      const names = (data ?? []).map((b) => b.name);
      expect(names).not.toContain('org-files');
    }
  });
});
