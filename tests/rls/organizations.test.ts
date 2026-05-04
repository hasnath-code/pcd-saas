import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

describe('organizations RLS', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A can SELECT own org', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c.from('organizations').select('id, name').eq('id', f.orgA.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(f.orgA.id);
  });

  test('User A cannot SELECT Org B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c.from('organizations').select('*').eq('id', f.orgB.id);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  test('User A SELECT * sees only Org A', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('organizations')
      .select('id')
      .in('id', [f.orgA.id, f.orgB.id]);
    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual([f.orgA.id]);
  });

  test('User A can UPDATE own org (as owner)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newName = `${f.orgA.name} updated`;
    const { data, error } = await c
      .from('organizations')
      .update({ name: newName })
      .eq('id', f.orgA.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe(newName);
  });

  test('User A cannot UPDATE Org B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('organizations')
      .update({ name: 'PWNED' })
      .eq('id', f.orgB.id)
      .select();
    expect(data ?? []).toEqual([]);

    // Confirm via service role that Org B was untouched
    const { data: orgB } = await f.service
      .from('organizations')
      .select('name')
      .eq('id', f.orgB.id)
      .single();
    expect(orgB?.name).not.toBe('PWNED');
    expect(orgB?.name).toBe(f.orgB.name);
  });

  test('Anonymous cannot SELECT any organization', async () => {
    const a = asAnon();
    const { data } = await a
      .from('organizations')
      .select('id')
      .in('id', [f.orgA.id, f.orgB.id]);
    expect(data ?? []).toEqual([]);
  });
});
