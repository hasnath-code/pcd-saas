import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

describe('audit_logs RLS', () => {
  let f: TwoOrgFixture;
  let logAId: string;
  let logBId: string;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
    // Service role inserts audit rows for both orgs
    logAId = uuidv7();
    logBId = uuidv7();
    await f.service.from('audit_logs').insert([
      {
        id: logAId,
        org_id: f.orgA.id,
        user_id: f.userA.userId,
        action: 'create',
        resource_type: 'test',
      },
      {
        id: logBId,
        org_id: f.orgB.id,
        user_id: f.userB.userId,
        action: 'create',
        resource_type: 'test',
      },
    ]);
  });
  afterAll(async () => {
    await f.service.from('audit_logs').delete().in('id', [logAId, logBId]);
    await f.cleanup();
  });

  test('User A (admin) can SELECT Org A audit logs', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c.from('audit_logs').select('id').eq('id', logAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test('User A cannot SELECT Org B audit logs', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c.from('audit_logs').select('id').eq('id', logBId);
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot INSERT audit_logs (no INSERT policy for users)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { error } = await c.from('audit_logs').insert({
      id: uuidv7(),
      org_id: f.orgA.id,
      action: 'create',
      resource_type: 'test',
    });
    expect(error).not.toBeNull();
  });
});
