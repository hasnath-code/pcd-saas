import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgAdminContext, asOrgUserContext } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgUser: vi.fn(),
    requireOrgAdmin: vi.fn(),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  createProject,
  restoreProject,
  softDeleteProject,
  updateProject,
} from '@/actions/projects';
import * as auth from '@/lib/auth/requireAuth';
import { AuthError } from '@/lib/auth/requireAuth';

describe('createProject', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('happy path → success + project exists in DB', async () => {
    const projectNumber = `P-${uuidv7().slice(0, 8)}`;
    const result = await createProject({
      projectNumber,
      siteAddress: '1 Test St',
      workflowId: f.extras.orgAWorkflow.id,
      clientId: f.extras.orgAClient.id,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.projectId).toBeDefined();

    const { data } = await f.service
      .from('projects')
      .select('id, project_number, current_stage_id')
      .eq('id', result.data.projectId)
      .single();
    expect(data?.project_number).toBe(projectNumber);
    expect(data?.current_stage_id).toBe(f.extras.orgAWorkflow.firstStageId);

    // Cleanup.
    await f.service.from('projects').delete().eq('id', result.data.projectId);
  });

  test('cross-org workflow → not_found', async () => {
    const result = await createProject({
      projectNumber: `P-${uuidv7().slice(0, 8)}`,
      siteAddress: '2 Test St',
      workflowId: f.extras.orgBWorkflow.id, // belongs to org B
    });
    expect(result).toEqual({ error: 'not_found', reason: 'workflow' });
  });

  test('system template → not_found (rejected)', async () => {
    const result = await createProject({
      projectNumber: `P-${uuidv7().slice(0, 8)}`,
      siteAddress: '3 Test St',
      workflowId: f.extras.systemTemplate.id,
    });
    expect(result).toEqual({ error: 'not_found', reason: 'workflow' });
  });

  test('cross-org client → not_found', async () => {
    const result = await createProject({
      projectNumber: `P-${uuidv7().slice(0, 8)}`,
      siteAddress: '4 Test St',
      workflowId: f.extras.orgAWorkflow.id,
      clientId: f.extras.orgBClient.id,
    });
    expect(result).toEqual({ error: 'not_found', reason: 'client' });
  });

  test('duplicate project_number → conflict / project_number_taken', async () => {
    const projectNumber = `P-DUP-${uuidv7().slice(0, 8)}`;
    const first = await createProject({
      projectNumber,
      siteAddress: '5 Test St',
      workflowId: f.extras.orgAWorkflow.id,
    });
    expect('error' in first).toBe(false);

    const second = await createProject({
      projectNumber,
      siteAddress: '6 Test St',
      workflowId: f.extras.orgAWorkflow.id,
    });
    expect(second).toEqual({ error: 'conflict', reason: 'project_number_taken' });

    // Cleanup the first one.
    if (!('error' in first)) {
      await f.service.from('projects').delete().eq('id', first.data.projectId);
    }
  });

  test('validation: missing project_number → validation_error', async () => {
    const result = await createProject({
      siteAddress: '7 Test St',
      workflowId: f.extras.orgAWorkflow.id,
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('not authenticated → not_authenticated', async () => {
    vi.mocked(auth.requireOrgUser).mockRejectedValueOnce(
      new AuthError('not_authenticated'),
    );
    const result = await createProject({
      projectNumber: `P-${uuidv7().slice(0, 8)}`,
      siteAddress: 'X',
      workflowId: f.extras.orgAWorkflow.id,
    });
    expect(result).toMatchObject({ error: 'not_authenticated' });
  });
});

describe('softDeleteProject + restoreProject', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(
      asOrgAdminContext(f.userA, f.orgA.id, 'owner'),
    );
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('happy path: soft-delete then restore', async () => {
    const del = await softDeleteProject({ projectId: f.extras.orgAProject.id });
    expect(del).toEqual({ success: true });

    const { data: deleted } = await f.service
      .from('projects')
      .select('deleted_at')
      .eq('id', f.extras.orgAProject.id)
      .single();
    expect(deleted?.deleted_at).not.toBeNull();

    const res = await restoreProject({ projectId: f.extras.orgAProject.id });
    expect(res).toEqual({ success: true });

    const { data: restored } = await f.service
      .from('projects')
      .select('deleted_at')
      .eq('id', f.extras.orgAProject.id)
      .single();
    expect(restored?.deleted_at).toBeNull();
  });

  test('cross-org project → not_found', async () => {
    const result = await softDeleteProject({ projectId: f.extras.orgBProject.id });
    expect(result).toEqual({ error: 'not_found', reason: 'project' });
  });

  test('member role → not_authorized', async () => {
    vi.mocked(auth.requireOrgAdmin).mockRejectedValueOnce(
      new AuthError('not_authorized', 'org_admin_required'),
    );
    const result = await softDeleteProject({ projectId: f.extras.orgAProject.id });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });
});

describe('updateProject', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('happy path: update siteAddress', async () => {
    const result = await updateProject({
      projectId: f.extras.orgAProject.id,
      siteAddress: 'New Site 1, Anytown',
    });
    expect(result).toEqual({ success: true });

    const { data } = await f.service
      .from('projects')
      .select('site_address')
      .eq('id', f.extras.orgAProject.id)
      .single();
    expect(data?.site_address).toBe('New Site 1, Anytown');
  });

  test('cross-org project → not_found', async () => {
    const result = await updateProject({
      projectId: f.extras.orgBProject.id,
      siteAddress: 'PWNED',
    });
    expect(result).toEqual({ error: 'not_found', reason: 'project' });
  });

  test('no fields → validation_error', async () => {
    const result = await updateProject({
      projectId: f.extras.orgAProject.id,
    });
    expect(result).toEqual({ error: 'validation_error', reason: 'no_fields_to_update' });
  });
});
