import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

describe('projects RLS', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A SELECT sees only Org A project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('projects')
      .select('id, org_id')
      .in('id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([f.extras.orgAProject.id]);
  });

  test('User A cannot UPDATE Org B project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('projects')
      .update({ site_address: 'PWNED' })
      .eq('id', f.extras.orgBProject.id)
      .select();
    expect(data ?? []).toEqual([]);

    const { data: project } = await f.service
      .from('projects')
      .select('site_address')
      .eq('id', f.extras.orgBProject.id)
      .single();
    expect(project?.site_address).not.toBe('PWNED');
  });

  test('Soft-deleted project hidden from default SELECT', async () => {
    // Soft-delete Org A's project via service role.
    const { error: delErr } = await f.service
      .from('projects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.extras.orgAProject.id);
    expect(delErr).toBeNull();

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('projects')
      .select('id')
      .eq('id', f.extras.orgAProject.id);
    expect(data ?? []).toEqual([]);

    // Restore for other tests.
    await f.service
      .from('projects')
      .update({ deleted_at: null })
      .eq('id', f.extras.orgAProject.id);
  });

  test('Anonymous cannot SELECT any project', async () => {
    const a = asAnon();
    const { data } = await a
      .from('projects')
      .select('id')
      .in('id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    expect(data ?? []).toEqual([]);
  });
});
