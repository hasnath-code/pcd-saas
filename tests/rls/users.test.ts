import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

describe('users RLS', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A SELECT * sees only same-org users (just A)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('users')
      .select('id, email')
      .in('id', [f.userA.userId, f.userB.userId]);
    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual([f.userA.userId]);
  });

  test('User A cannot SELECT Org B users', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c.from('users').select('*').eq('id', f.userB.userId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  test('User A can UPDATE own users row', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newName = 'A renamed';
    const { data, error } = await c
      .from('users')
      .update({ name: newName })
      .eq('id', f.userA.userId)
      .select();
    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe(newName);
  });

  test('User A cannot UPDATE Org B user row', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('users')
      .update({ name: 'PWNED' })
      .eq('id', f.userB.userId)
      .select();
    expect(data ?? []).toEqual([]);

    // Service-role confirms B was not modified
    const { data: userB } = await f.service
      .from('users')
      .select('name')
      .eq('id', f.userB.userId)
      .single();
    expect(userB?.name).not.toBe('PWNED');
  });

  test('Anonymous cannot SELECT any user row', async () => {
    const a = asAnon();
    const { data } = await a
      .from('users')
      .select('id')
      .in('id', [f.userA.userId, f.userB.userId]);
    expect(data ?? []).toEqual([]);
  });

  test('Soft-deleted user loses access immediately', async () => {
    // Service-role soft-deletes User A's users row
    await f.service
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.userA.userId);

    // Re-sign-in to get a fresh JWT (otherwise Supabase Auth caches)
    const c = await asUser(f.userA.email, f.userA.password);

    // A should no longer see Org A (no live membership)
    const { data: orgs } = await c.from('organizations').select('id').eq('id', f.orgA.id);
    expect(orgs ?? []).toEqual([]);

    // A should not see own users row (deleted_at IS NULL filter on policy)
    const { data: users } = await c.from('users').select('id').eq('id', f.userA.userId);
    expect(users ?? []).toEqual([]);

    // Restore for any later tests in the file (none here, but defensive)
    await f.service
      .from('users')
      .update({ deleted_at: null })
      .eq('id', f.userA.userId);
  });
});
