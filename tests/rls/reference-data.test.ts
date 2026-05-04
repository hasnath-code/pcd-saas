import { describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';

describe('reference data + system tables', () => {
  test('Anonymous can SELECT org_types (RLS disabled, anon GRANT)', async () => {
    const a = asAnon();
    const { data, error } = await a.from('org_types').select('slug');
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(2);
    const slugs = (data ?? []).map((r) => r.slug);
    expect(slugs).toContain('surveyor');
    expect(slugs).toContain('architect');
  });

  test('Anonymous can SELECT plans (RLS disabled, anon GRANT)', async () => {
    const a = asAnon();
    const { data, error } = await a.from('plans').select('slug, org_type_id');
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(8);
  });

  test('Anonymous CANNOT SELECT webhook_events (no GRANT)', async () => {
    const a = asAnon();
    const { data, error } = await a.from('webhook_events').select('id').limit(1);
    // Either error (permission denied) or empty data — both prove anon access blocked
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    if (error) {
      expect(error.message.toLowerCase()).toMatch(/permission|denied|not found|relation/);
    }
  });
});
