import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgAdminContext } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireOrgAdmin: vi.fn() };
});
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  addWorkflowStage,
  createWorkflow,
  deleteWorkflow,
  removeWorkflowStage,
  updateWorkflow,
} from '@/actions/workflows';
import * as auth from '@/lib/auth/requireAuth';

describe('actions/workflows', () => {
  let f: WorkflowProjectFixture;
  // Track ad-hoc workflows we create during tests for end-of-suite cleanup.
  const createdWorkflowIds: string[] = [];

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    if (createdWorkflowIds.length > 0) {
      // workflow_stages cascade with workflow.
      await f.service.from('workflows').delete().in('id', createdWorkflowIds);
    }
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(
      asOrgAdminContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  // ── createWorkflow ────────────────────────────────────────────────────────

  test('createWorkflow happy path → success + rows in DB', async () => {
    const result = await createWorkflow({
      name: 'Test Pipeline',
      description: 'unit test',
      stages: [
        { name: 'Intake', position: 1, isTerminal: false },
        { name: 'Working', position: 2, isTerminal: false },
        { name: 'Done', position: 3, isTerminal: true },
      ],
    });
    expect(result).toMatchObject({ success: true });
    const workflowId = ('data' in result && result.data?.workflowId) || '';
    expect(workflowId).toMatch(/^[0-9a-f-]{36}$/);
    createdWorkflowIds.push(workflowId);

    const { data: wf } = await f.service
      .from('workflows')
      .select('name, slug, is_system_template, org_id')
      .eq('id', workflowId)
      .single();
    expect(wf).toMatchObject({
      name: 'Test Pipeline',
      slug: 'test_pipeline',
      is_system_template: false,
      org_id: f.orgA.id,
    });

    const { data: stages } = await f.service
      .from('workflow_stages')
      .select('slug, name, position, is_terminal')
      .eq('workflow_id', workflowId)
      .order('position');
    expect(stages).toHaveLength(3);
    expect(stages?.map((s) => s.slug)).toEqual(['intake', 'working', 'done']);
    expect(stages?.[2].is_terminal).toBe(true);
  });

  test('createWorkflow with no terminal → validation_error', async () => {
    const result = await createWorkflow({
      name: 'No Terminal',
      stages: [
        { name: 'Stage 1', position: 1, isTerminal: false },
        { name: 'Stage 2', position: 2, isTerminal: false },
      ],
    });
    expect(result).toMatchObject({ error: 'validation_error', reason: 'no_terminal_stage' });
  });

  test('createWorkflow with duplicate stage names → validation_error', async () => {
    const result = await createWorkflow({
      name: 'Dups',
      stages: [
        { name: 'Same', position: 1, isTerminal: false },
        { name: 'Same', position: 2, isTerminal: true },
      ],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
    expect(('reason' in result && result.reason) || '').toContain('duplicate_stage_name');
  });

  test('createWorkflow with non-sequential positions → validation_error', async () => {
    const result = await createWorkflow({
      name: 'Gaps',
      stages: [
        { name: 'A', position: 1, isTerminal: false },
        { name: 'B', position: 3, isTerminal: true }, // skips position 2
      ],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
    expect(('reason' in result && result.reason) || '').toContain('non_sequential_positions');
  });

  test('createWorkflow as non-admin (member) → not_authorized propagates', async () => {
    vi.mocked(auth.requireOrgAdmin).mockRejectedValueOnce(
      new auth.AuthError('not_authorized', 'org_admin_required'),
    );
    const result = await createWorkflow({
      name: 'Should fail',
      stages: [{ name: 'X', position: 1, isTerminal: true }],
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  // ── updateWorkflow ────────────────────────────────────────────────────────

  test('updateWorkflow happy path → name + description set', async () => {
    const wfId = uuidv7();
    await f.service.from('workflows').insert({
      id: wfId,
      org_id: f.orgA.id,
      slug: 'tmp',
      name: 'Before',
      description: null,
      is_system_template: false,
      is_default: false,
    });
    createdWorkflowIds.push(wfId);

    const result = await updateWorkflow({
      workflowId: wfId,
      name: 'After',
      description: 'Updated by test',
    });
    expect(result).toMatchObject({ success: true });

    const { data: wf } = await f.service
      .from('workflows')
      .select('name, description')
      .eq('id', wfId)
      .single();
    expect(wf?.name).toBe('After');
    expect(wf?.description).toBe('Updated by test');
  });

  test('updateWorkflow on cross-org workflow → not_found', async () => {
    const result = await updateWorkflow({
      workflowId: f.extras.orgBWorkflow.id,
      name: 'PWNED',
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'workflow' });
  });

  test('updateWorkflow on system template → not_authorized', async () => {
    const result = await updateWorkflow({
      workflowId: f.extras.systemTemplate.id,
      name: 'PWNED',
    });
    expect(result).toMatchObject({ error: 'not_authorized', reason: 'system_template' });
  });

  // ── addWorkflowStage / removeWorkflowStage ────────────────────────────────

  test('addWorkflowStage happy path → row inserted at position', async () => {
    const wfId = uuidv7();
    await f.service.from('workflows').insert({
      id: wfId,
      org_id: f.orgA.id,
      slug: 'add-stage-test',
      name: 'Add Stage Test',
      is_system_template: false,
      is_default: false,
    });
    createdWorkflowIds.push(wfId);
    await f.service.from('workflow_stages').insert([
      { id: uuidv7(), workflow_id: wfId, slug: 'one', name: 'One', position: 1, is_terminal: false },
      { id: uuidv7(), workflow_id: wfId, slug: 'done', name: 'Done', position: 2, is_terminal: true },
    ]);

    const result = await addWorkflowStage({
      workflowId: wfId,
      name: 'Middle',
      position: 3,
      isTerminal: false,
    });
    expect(result).toMatchObject({ success: true });

    const { data: stages } = await f.service
      .from('workflow_stages')
      .select('slug, position')
      .eq('workflow_id', wfId)
      .order('position');
    expect(stages).toHaveLength(3);
    expect(stages?.find((s) => s.position === 3)?.slug).toBe('middle');
  });

  test('addWorkflowStage with colliding position → conflict', async () => {
    const wfId = uuidv7();
    await f.service.from('workflows').insert({
      id: wfId,
      org_id: f.orgA.id,
      slug: 'collide-pos',
      name: 'Collide',
      is_system_template: false,
      is_default: false,
    });
    createdWorkflowIds.push(wfId);
    await f.service.from('workflow_stages').insert([
      { id: uuidv7(), workflow_id: wfId, slug: 'a', name: 'A', position: 1, is_terminal: false },
      { id: uuidv7(), workflow_id: wfId, slug: 'b', name: 'B', position: 2, is_terminal: true },
    ]);

    const result = await addWorkflowStage({
      workflowId: wfId,
      name: 'Conflict',
      position: 1,
      isTerminal: false,
    });
    expect(result).toMatchObject({ error: 'conflict' });
    expect(('reason' in result && result.reason) || '').toContain('position_taken');
  });

  test('removeWorkflowStage happy path → row deleted', async () => {
    const wfId = uuidv7();
    const removableId = uuidv7();
    await f.service.from('workflows').insert({
      id: wfId,
      org_id: f.orgA.id,
      slug: 'remove-stage-test',
      name: 'Remove Stage',
      is_system_template: false,
      is_default: false,
    });
    createdWorkflowIds.push(wfId);
    await f.service.from('workflow_stages').insert([
      { id: uuidv7(), workflow_id: wfId, slug: 'keep', name: 'Keep', position: 1, is_terminal: false },
      { id: removableId, workflow_id: wfId, slug: 'remove-me', name: 'Remove Me', position: 2, is_terminal: false },
      { id: uuidv7(), workflow_id: wfId, slug: 'done', name: 'Done', position: 3, is_terminal: true },
    ]);

    const result = await removeWorkflowStage({ stageId: removableId });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('id', removableId);
    expect(data ?? []).toEqual([]);
  });

  test('removeWorkflowStage where projects sit on stage → conflict stage_in_use', async () => {
    // Use the orgA fixture project's first stage — it's in active use.
    // First, look up the stage id.
    const { data: rows } = await f.service
      .from('projects')
      .select('current_stage_id')
      .eq('id', f.extras.orgAProject.id)
      .single();
    const stageInUse = rows?.current_stage_id as string;

    const result = await removeWorkflowStage({ stageId: stageInUse });
    expect(result).toMatchObject({ error: 'conflict', reason: 'stage_in_use' });
  });

  test('removeWorkflowStage on the only terminal → conflict last_terminal', async () => {
    const wfId = uuidv7();
    const onlyTerminalId = uuidv7();
    await f.service.from('workflows').insert({
      id: wfId,
      org_id: f.orgA.id,
      slug: 'last-terminal-test',
      name: 'Last Terminal',
      is_system_template: false,
      is_default: false,
    });
    createdWorkflowIds.push(wfId);
    await f.service.from('workflow_stages').insert([
      { id: uuidv7(), workflow_id: wfId, slug: 'a', name: 'A', position: 1, is_terminal: false },
      { id: onlyTerminalId, workflow_id: wfId, slug: 'done', name: 'Done', position: 2, is_terminal: true },
    ]);

    const result = await removeWorkflowStage({ stageId: onlyTerminalId });
    expect(result).toMatchObject({ error: 'conflict', reason: 'last_terminal' });
  });

  // ── deleteWorkflow ────────────────────────────────────────────────────────

  test('deleteWorkflow happy path (no projects) → soft-deleted', async () => {
    const wfId = uuidv7();
    await f.service.from('workflows').insert({
      id: wfId,
      org_id: f.orgA.id,
      slug: 'delete-me',
      name: 'Delete Me',
      is_system_template: false,
      is_default: false,
    });
    createdWorkflowIds.push(wfId);
    await f.service.from('workflow_stages').insert([
      { id: uuidv7(), workflow_id: wfId, slug: 'a', name: 'A', position: 1, is_terminal: false },
      { id: uuidv7(), workflow_id: wfId, slug: 'b', name: 'B', position: 2, is_terminal: true },
    ]);

    const result = await deleteWorkflow({ workflowId: wfId });
    expect(result).toMatchObject({ success: true });

    const { data: wf } = await f.service
      .from('workflows')
      .select('deleted_at')
      .eq('id', wfId)
      .single();
    expect(wf?.deleted_at).not.toBeNull();
  });

  test('deleteWorkflow with active projects → conflict workflow_in_use', async () => {
    // f.extras.orgAWorkflow has the orgA project on it.
    const result = await deleteWorkflow({
      workflowId: f.extras.orgAWorkflow.id,
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'workflow_in_use' });
  });

  test('deleteWorkflow on system template → not_authorized', async () => {
    const result = await deleteWorkflow({
      workflowId: f.extras.systemTemplate.id,
    });
    expect(result).toMatchObject({ error: 'not_authorized', reason: 'system_template' });
  });
});
