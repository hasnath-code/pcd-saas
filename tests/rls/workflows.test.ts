import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
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

  // ── Session 8: workflow CRUD additions ────────────────────────────────────

  test('User A cannot INSERT a workflow scoped to Org B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('workflows')
      .insert({
        id: newId,
        org_id: f.orgB.id,
        slug: 'cross-org-attempt',
        name: 'Cross Org Attempt',
        is_system_template: false,
        is_default: false,
      })
      .select();
    expect(data ?? []).toEqual([]);
    // Confirm via service role that no row landed.
    const { data: check } = await f.service
      .from('workflows')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('User A cannot INSERT a system-template workflow', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('workflows')
      .insert({
        id: newId,
        org_id: null, // system templates have NULL org_id per the CHECK constraint
        slug: 'pwn-template',
        name: 'PWN Template',
        is_system_template: true,
        is_default: false,
      })
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot DELETE Org B workflow', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflows')
      .delete()
      .eq('id', f.extras.orgBWorkflow.id)
      .select();
    expect(data ?? []).toEqual([]);
    // Service-role confirms it's still there.
    const { data: check } = await f.service
      .from('workflows')
      .select('id')
      .eq('id', f.extras.orgBWorkflow.id);
    expect(check).toHaveLength(1);
  });

  test('User A cannot DELETE the system template', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflows')
      .delete()
      .eq('id', f.extras.systemTemplate.id)
      .select();
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

  // ── Session 8: workflow_stages CRUD additions ─────────────────────────────

  test('User A cannot INSERT a stage into Org B workflow', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('workflow_stages')
      .insert({
        id: newId,
        workflow_id: f.extras.orgBWorkflow.id,
        slug: 'pwn',
        name: 'PWN',
        position: 99,
        is_terminal: false,
      })
      .select();
    expect(data ?? []).toEqual([]);
    // Service-role confirms no row landed.
    const { data: check } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('User A cannot INSERT a stage into the system template', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflow_stages')
      .insert({
        id: uuidv7(),
        workflow_id: f.extras.systemTemplate.id,
        slug: 'pwn',
        name: 'PWN',
        position: 99,
        is_terminal: false,
      })
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot DELETE Org B stages', async () => {
    // Pick any stage in Org B's workflow.
    const { data: orgBStages } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', f.extras.orgBWorkflow.id)
      .limit(1);
    const targetId = orgBStages?.[0]?.id;
    expect(targetId).toBeDefined();

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflow_stages')
      .delete()
      .eq('id', targetId!)
      .select();
    expect(data ?? []).toEqual([]);
    // Service-role confirms it's still there.
    const { data: check } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('id', targetId!);
    expect(check).toHaveLength(1);
  });

  test('User A cannot UPDATE Org B stages', async () => {
    const { data: orgBStages } = await f.service
      .from('workflow_stages')
      .select('id, name')
      .eq('workflow_id', f.extras.orgBWorkflow.id)
      .limit(1);
    const target = orgBStages?.[0];
    expect(target).toBeDefined();

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('workflow_stages')
      .update({ name: 'PWNED' })
      .eq('id', target!.id)
      .select();
    expect(data ?? []).toEqual([]);
    // Service-role: name unchanged.
    const { data: check } = await f.service
      .from('workflow_stages')
      .select('name')
      .eq('id', target!.id)
      .single();
    expect(check?.name).toBe(target!.name);
  });
});
