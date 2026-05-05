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
    const { error } = await a.from('webhook_events').select('id').limit(1);
    // After migration 0004, anon has no GRANT on webhook_events. Empty data is
    // not a valid pass mode — it could mask a real GRANT regression on a table
    // that just happens to be empty. Require an explicit permission error.
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toMatch(/permission|denied/);
  });

  test('Anonymous CANNOT SELECT email_events (no GRANT, RLS too)', async () => {
    const a = asAnon();
    const { error } = await a.from('email_events').select('id').limit(1);
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toMatch(/permission|denied/);
  });
});
