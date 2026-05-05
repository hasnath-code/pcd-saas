import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

describe('clients RLS', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A SELECT sees only Org A client (via membership)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('clients')
      .select('id')
      .in('id', [f.extras.orgAClient.id, f.extras.orgBClient.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([f.extras.orgAClient.id]);
  });

  test('User A cannot UPDATE another org client (no auth_user_id link)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('clients')
      .update({ name: 'PWNED' })
      .eq('id', f.extras.orgBClient.id)
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('Anonymous cannot SELECT any client', async () => {
    const a = asAnon();
    const { data } = await a
      .from('clients')
      .select('id')
      .in('id', [f.extras.orgAClient.id, f.extras.orgBClient.id]);
    expect(data ?? []).toEqual([]);
  });
});

describe('client_org_memberships RLS', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A sees only Org A memberships', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('client_org_memberships')
      .select('id, org_id')
      .in('org_id', [f.orgA.id, f.orgB.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.org_id)).toEqual([f.orgA.id]);
  });

  test('Anonymous cannot SELECT memberships', async () => {
    const a = asAnon();
    const { data } = await a.from('client_org_memberships').select('id');
    expect(data ?? []).toEqual([]);
  });
});
