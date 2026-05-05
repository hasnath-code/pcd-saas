import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

describe('workflows RLS', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A can SELECT the system template', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('workflows')
      .select('id, slug, is_system_template')
      .eq('id', f.extras.systemTemplate.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.is_system_template).toBe(true);
  });

  test('User A SELECT * sees system template + own org workflow only', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('workflows')
      .select('id, org_id, is_system_template')
      .in('id', [
        f.extras.systemTemplate.id,
        f.extras.orgAWorkflow.id,
        f.extras.orgBWorkflow.id,
      ]);
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id).sort();
    expect(ids).toEqual(
      [f.extras.systemTemplate.id, f.extras.orgAWorkflow.id].sort(),
    );
  });

  test('User A cannot UPDATE the system template', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflows')
      .update({ name: 'PWNED' })
      .eq('id', f.extras.systemTemplate.id)
      .select();
    expect(data ?? []).toEqual([]);

    const { data: tmpl } = await f.service
      .from('workflows')
      .select('name')
      .eq('id', f.extras.systemTemplate.id)
      .single();
    expect(tmpl?.name).toBe('Simple');
  });

  test('User A cannot UPDATE Org B workflow', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflows')
      .update({ name: 'PWNED' })
      .eq('id', f.extras.orgBWorkflow.id)
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('Anonymous cannot SELECT any workflow', async () => {
    const a = asAnon();
    const { data } = await a
      .from('workflows')
      .select('id')
      .in('id', [
        f.extras.systemTemplate.id,
        f.extras.orgAWorkflow.id,
        f.extras.orgBWorkflow.id,
      ]);
    expect(data ?? []).toEqual([]);
  });
});

describe('workflow_stages RLS', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A can SELECT system template stages (transitive via parent)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('workflow_stages')
      .select('id, slug, position')
      .eq('workflow_id', f.extras.systemTemplate.id)
      .order('position');
    expect(error).toBeNull();
    expect(data).toHaveLength(5);
    expect(data?.map((s) => s.slug)).toEqual([
      'new',
      'in_progress',
      'on_hold',
      'completed',
      'cancelled',
    ]);
  });

  test('User A cannot SELECT Org B workflow stages', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', f.extras.orgBWorkflow.id);
    expect(data ?? []).toEqual([]);
  });

  test('Anonymous cannot SELECT stages', async () => {
    const a = asAnon();
    const { data } = await a
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', f.extras.systemTemplate.id);
    expect(data ?? []).toEqual([]);
  });
});
