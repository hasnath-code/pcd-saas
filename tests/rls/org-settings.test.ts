import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

describe('org_settings RLS', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    // Best-effort: delete any settings created during tests
    await f.service
      .from('org_settings')
      .delete()
      .in('org_id', [f.orgA.id, f.orgB.id]);
    await f.cleanup();
  });

  test('User A (owner = admin) can INSERT setting in Org A', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const id = uuidv7();
    const { data, error } = await c
      .from('org_settings')
      .insert({ id, org_id: f.orgA.id, key: 'company.name', value: { v: 'Test Co A' } })
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test('User A cannot INSERT setting in Org B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const id = uuidv7();
    const { error } = await c
      .from('org_settings')
      .insert({ id, org_id: f.orgB.id, key: 'company.name', value: { v: 'Pwned' } });
    expect(error).not.toBeNull();
  });

  test('User A SELECT sees only Org A settings', async () => {
    // Service-role inserts a setting in Org B
    await f.service.from('org_settings').insert({
      id: uuidv7(),
      org_id: f.orgB.id,
      key: 'company.name',
      value: { v: 'Org B' },
    });

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c.from('org_settings').select('org_id, key');
    expect(data).toBeDefined();
    expect(data!.every((r) => r.org_id === f.orgA.id)).toBe(true);
  });

  test('User A cannot UPDATE Org B setting', async () => {
    const { data: bRows } = await f.service
      .from('org_settings')
      .select('id')
      .eq('org_id', f.orgB.id)
      .limit(1);
    const targetId = bRows?.[0]?.id;
    expect(targetId).toBeDefined();

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('org_settings')
      .update({ value: { v: 'PWNED' } })
      .eq('id', targetId!)
      .select();
    expect(data ?? []).toEqual([]);
  });
});
