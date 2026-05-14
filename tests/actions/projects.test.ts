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

// DEBT-038: createProject now calls inviteStakeholder post-commit when a
// clientId is supplied, which in turn rate-limits, calls Resend, and
// captures Sentry exceptions. Stub those out so the tests are deterministic.
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-msg', emailEventId: null }),
}));

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));

import {
  createProject,
  restoreProject,
  softDeleteProject,
  updateProject,
} from '@/actions/projects';
import * as auth from '@/lib/auth/requireAuth';
import * as email from '@/lib/email/send';
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
    vi.mocked(email.sendEmail).mockClear();
    vi.mocked(email.sendEmail).mockResolvedValue({
      messageId: 'mocked-msg',
      emailEventId: null,
    });
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

  // DEBT-038 regression: pre-fix createProject inserted project_stakeholders
  // inline and skipped the magic-link email entirely. The fix delegates to
  // inviteStakeholder post-commit, which is the canonical path that calls
  // sendEmail with template='stakeholder_invitation' (the row that lands in
  // outbound_emails downstream).
  test('with a clientId, triggers the stakeholder_invitation email send', async () => {
    const projectNumber = `P-debt038-${Date.now()}-${uuidv7().slice(0, 8)}`;
    const result = await createProject({
      projectNumber,
      siteAddress: '1 DEBT-038 Lane',
      workflowId: f.extras.orgAWorkflow.id,
      clientId: f.extras.orgAClient.id,
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.stakeholderWarning).toBeUndefined();

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const args = vi.mocked(email.sendEmail).mock.calls[0]?.[0];
    expect(args).toMatchObject({
      template: 'stakeholder_invitation',
      orgId: f.orgA.id,
    });

    await f.service.from('projects').delete().eq('id', result.data.projectId);
  });

  test('without a clientId, sends no email', async () => {
    const result = await createProject({
      projectNumber: `P-no-client-${Date.now()}-${uuidv7().slice(0, 8)}`,
      siteAddress: '2 No-Client Lane',
      workflowId: f.extras.orgAWorkflow.id,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.stakeholderWarning).toBeUndefined();
    expect(email.sendEmail).not.toHaveBeenCalled();

    await f.service.from('projects').delete().eq('id', result.data.projectId);
  });

  test('surfaces stakeholderWarning when inviteStakeholder email send fails', async () => {
    vi.mocked(email.sendEmail).mockRejectedValueOnce(new Error('resend down'));
    const result = await createProject({
      projectNumber: `P-warn-${Date.now()}-${uuidv7().slice(0, 8)}`,
      siteAddress: '3 Warning Lane',
      workflowId: f.extras.orgAWorkflow.id,
      clientId: f.extras.orgAClient.id,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.stakeholderWarning).toBe('invite_failed');

    await f.service.from('projects').delete().eq('id', result.data.projectId);
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
