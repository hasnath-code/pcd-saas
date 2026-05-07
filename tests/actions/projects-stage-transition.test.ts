import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireOrgUser: vi.fn() };
});
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { moveProjectToStage } from '@/actions/projects';
import * as auth from '@/lib/auth/requireAuth';

describe('actions/projects → moveProjectToStage', () => {
  let f: WorkflowProjectFixture;
  let stageIds: { id: string; slug: string; position: number; isTerminal: boolean }[];

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Resolve all stages of orgA's workflow ordered by position so individual
    // tests can reference them by index.
    const { data } = await f.service
      .from('workflow_stages')
      .select('id, slug, position, is_terminal')
      .eq('workflow_id', f.extras.orgAWorkflow.id)
      .order('position');
    stageIds = (data ?? []).map((s) => ({
      id: s.id as string,
      slug: s.slug as string,
      position: s.position as number,
      isTerminal: s.is_terminal as boolean,
    }));
  });
  afterAll(async () => {
    // Clean up any audit rows we generated during tests.
    await f.service
      .from('audit_logs')
      .delete()
      .eq('resource_type', 'project')
      .eq('resource_id', f.extras.orgAProject.id);
    await f.cleanup();
  });
  beforeEach(async () => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
    // Reset the project to position-1 so each test starts clean.
    await f.service
      .from('projects')
      .update({ current_stage_id: stageIds[0].id })
      .eq('id', f.extras.orgAProject.id);
  });

  test('forward transition → success + isBackwardTransition=false + audit metadata complete', async () => {
    const target = stageIds[1]; // position 2
    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: target.id,
    });
    expect(result).toMatchObject({ success: true });
    if ('data' in result) {
      expect(result.data?.isBackwardTransition).toBe(false);
      expect(result.data?.isTerminalDestination).toBe(target.isTerminal);
    }

    // DB row updated.
    const { data: project } = await f.service
      .from('projects')
      .select('current_stage_id')
      .eq('id', f.extras.orgAProject.id)
      .single();
    expect(project?.current_stage_id).toBe(target.id);

    // Audit row exists with the locked metadata schema.
    const { data: audit } = await f.service
      .from('audit_logs')
      .select('action, resource_type, resource_id, metadata')
      .eq('resource_type', 'project')
      .eq('resource_id', f.extras.orgAProject.id)
      .eq('action', 'stage_changed')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(audit?.[0]?.action).toBe('stage_changed');
    const meta = audit?.[0]?.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      from_stage_id: stageIds[0].id,
      to_stage_id: target.id,
      from_stage_position: 1,
      to_stage_position: 2,
      workflow_id: f.extras.orgAWorkflow.id,
      is_backward_transition: false,
      is_terminal_destination: target.isTerminal,
    });
    // All locked fields present.
    expect(meta).toHaveProperty('from_stage_name');
    expect(meta).toHaveProperty('to_stage_name');
  });

  test('backward transition → isBackwardTransition=true', async () => {
    // Start by moving to position 3.
    await f.service
      .from('projects')
      .update({ current_stage_id: stageIds[2].id })
      .eq('id', f.extras.orgAProject.id);

    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: stageIds[0].id, // position 1, backward
    });
    expect(result).toMatchObject({ success: true });
    if ('data' in result) {
      expect(result.data?.isBackwardTransition).toBe(true);
    }

    const { data: audit } = await f.service
      .from('audit_logs')
      .select('metadata')
      .eq('resource_type', 'project')
      .eq('resource_id', f.extras.orgAProject.id)
      .eq('action', 'stage_changed')
      .order('created_at', { ascending: false })
      .limit(1);
    const meta = audit?.[0]?.metadata as Record<string, unknown>;
    expect(meta?.is_backward_transition).toBe(true);
    expect(meta?.from_stage_position).toBe(3);
    expect(meta?.to_stage_position).toBe(1);
  });

  test('transition to terminal stage → isTerminalDestination=true', async () => {
    const terminal = stageIds.find((s) => s.isTerminal);
    if (!terminal) throw new Error('fixture: simple workflow has no terminal');

    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: terminal.id,
    });
    expect(result).toMatchObject({ success: true });
    if ('data' in result) {
      expect(result.data?.isTerminalDestination).toBe(true);
    }
  });

  test('cross-org project → not_found', async () => {
    const result = await moveProjectToStage({
      projectId: f.extras.orgBProject.id,
      toStageId: stageIds[1].id,
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'project' });
  });

  test('stage from a different workflow → validation_error stage_not_in_project_workflow', async () => {
    // Pick any stage from Org B's workflow — different workflow_id.
    const { data: orgBStages } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', f.extras.orgBWorkflow.id)
      .limit(1);
    const otherWorkflowStage = orgBStages?.[0]?.id;
    expect(otherWorkflowStage).toBeDefined();

    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: otherWorkflowStage!,
    });
    expect(result).toMatchObject({
      error: 'validation_error',
      reason: 'stage_not_in_project_workflow',
    });
  });

  test('moving to current stage → validation_error already_on_stage', async () => {
    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: stageIds[0].id, // already on position 1
    });
    expect(result).toMatchObject({
      error: 'validation_error',
      reason: 'already_on_stage',
    });
  });

  test('non-existent stage id → validation_error', async () => {
    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: uuidv7(), // bogus id
    });
    expect(result).toMatchObject({
      error: 'validation_error',
      reason: 'stage_not_in_project_workflow',
    });
  });
});
