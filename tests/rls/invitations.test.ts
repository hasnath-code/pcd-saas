import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

describe('invitations RLS', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.service.from('invitations').delete().in('org_id', [f.orgA.id, f.orgB.id]);
    await f.cleanup();
  });

  test('User A (owner) can INSERT team_member invitation in Org A', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const expiresAt = new Date(Date.now() + 86400_000).toISOString();
    const { data, error } = await c
      .from('invitations')
      .insert({
        id: uuidv7(),
        org_id: f.orgA.id,
        email: 'invitee-a@test.local',
        invitation_type: 'team_member',
        role: 'member',
        token: `tok-${uuidv7()}`,
        expires_at: expiresAt,
      })
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test('User A cannot INSERT invitation in Org B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const expiresAt = new Date(Date.now() + 86400_000).toISOString();
    const { error } = await c.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgB.id,
      email: 'pwn@test.local',
      invitation_type: 'team_member',
      role: 'member',
      token: `tok-${uuidv7()}`,
      expires_at: expiresAt,
    });
    expect(error).not.toBeNull();
  });

  test('User A SELECT sees only Org A invitations', async () => {
    // Service-role inserts an invitation in Org B
    await f.service.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgB.id,
      email: 'b-invitee@test.local',
      invitation_type: 'team_member',
      role: 'member',
      token: `tok-${uuidv7()}`,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c.from('invitations').select('org_id, email');
    expect(data).toBeDefined();
    expect(data!.every((r) => r.org_id === f.orgA.id)).toBe(true);
  });
});
