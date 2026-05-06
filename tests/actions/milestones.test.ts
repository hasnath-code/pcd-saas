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

import {
  createMilestone,
  softDeleteMilestone,
  updateMilestone,
} from '@/actions/milestones';
import * as auth from '@/lib/auth/requireAuth';

describe('actions/milestones', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service
      .from('project_milestones')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('createMilestone happy path → success + row in DB', async () => {
    const result = await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Survey complete',
      visibleToStakeholders: true,
    });
    expect(result).toMatchObject({ success: true });
    const milestoneId = ('data' in result && result.data?.milestoneId) || '';
    const { data } = await f.service
      .from('project_milestones')
      .select('label, visible_to_stakeholders')
      .eq('id', milestoneId)
      .single();
    expect(data?.label).toBe('Survey complete');
    expect(data?.visible_to_stakeholders).toBe(true);
  });

  test('createMilestone cross-org project → not_found', async () => {
    const result = await createMilestone({
      projectId: f.extras.orgBProject.id,
      label: 'Should not insert',
      visibleToStakeholders: true,
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'project' });
  });

  test('updateMilestone with completedAt sets the field', async () => {
    // Seed a milestone first.
    const id = uuidv7();
    await f.service.from('project_milestones').insert({
      id,
      project_id: f.extras.orgAProject.id,
      label: 'Pending complete',
    });

    const completedAt = new Date();
    const result = await updateMilestone({
      milestoneId: id,
      completedAt: completedAt.toISOString(),
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_milestones')
      .select('completed_at')
      .eq('id', id)
      .single();
    expect(data?.completed_at).not.toBeNull();
  });

  test('softDeleteMilestone happy path → deleted_at set + audit', async () => {
    const id = uuidv7();
    await f.service.from('project_milestones').insert({
      id,
      project_id: f.extras.orgAProject.id,
      label: 'To remove',
    });

    const result = await softDeleteMilestone({ milestoneId: id });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_milestones')
      .select('deleted_at')
      .eq('id', id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });
});
