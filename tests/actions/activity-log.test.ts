import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

// Phase 6: each wired action writes a project_activity row inside its
// transaction. The visible_to_stakeholders default per event_type follows
// the kickoff plan §G defaults.

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-act-msg', emailEventId: null }),
}));

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgUser: vi.fn(),
    requireOrgAdmin: vi.fn(),
  };
});

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

import { moveProjectToStage } from '@/actions/projects';
import { confirmUpload } from '@/actions/files';
import { inviteStakeholder } from '@/actions/stakeholders';
import { createMilestone } from '@/actions/milestones';
import * as auth from '@/lib/auth/requireAuth';

async function fetchActivity(
  service: WorkflowProjectFixture['service'],
  projectId: string,
  eventType: string,
) {
  const { data } = await service
    .from('project_activity')
    .select('id, event_type, actor_type, actor_id, visible_to_stakeholders, payload')
    .eq('project_id', projectId)
    .eq('event_type', eventType);
  return data ?? [];
}

describe('project_activity writes — Phase 6 wired actions', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service.from('project_activity').delete().eq('project_id', f.extras.orgAProject.id);
    await f.service.from('project_files').delete().eq('project_id', f.extras.orgAProject.id);
    await f.service.from('project_milestones').delete().eq('project_id', f.extras.orgAProject.id);
    await f.service.from('project_stakeholders').delete().eq('project_id', f.extras.orgAProject.id);
    await f.service.from('invitations').delete().eq('project_id', f.extras.orgAProject.id);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('moveProjectToStage writes activity row with visible_to_stakeholders=true', async () => {
    const { data: stages } = await f.service
      .from('workflow_stages')
      .select('id, position')
      .eq('workflow_id', f.extras.orgAWorkflow.id)
      .order('position');
    const toStage = stages?.find((s) => s.id !== f.extras.orgAWorkflow.firstStageId);
    expect(toStage).toBeTruthy();

    await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: toStage!.id,
    });

    const rows = await fetchActivity(
      f.service,
      f.extras.orgAProject.id,
      'project.stage_changed',
    );
    expect(rows.length).toBe(1);
    expect(rows[0].visible_to_stakeholders).toBe(true);
    expect(rows[0].actor_type).toBe('user');
    expect(rows[0].actor_id).toBe(f.userA.userId);
  });

  test('confirmUpload visibility=org_and_stakeholders → activity row visible=true', async () => {
    const fileId = uuidv7();
    const storagePath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${fileId}.pdf`;
    await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath,
      originalFilename: 'shared.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
      visibility: 'org_and_stakeholders',
    });

    const rows = await fetchActivity(
      f.service,
      f.extras.orgAProject.id,
      'file.uploaded',
    );
    const sharedRow = rows.find(
      (r) => (r.payload as { visibility?: string }).visibility === 'org_and_stakeholders',
    );
    expect(sharedRow).toBeTruthy();
    expect(sharedRow!.visible_to_stakeholders).toBe(true);
  });

  test('confirmUpload visibility=org_only → activity row visible=false', async () => {
    const fileId = uuidv7();
    const storagePath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${fileId}.pdf`;
    await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath,
      originalFilename: 'internal.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
      visibility: 'org_only',
    });

    const rows = await fetchActivity(
      f.service,
      f.extras.orgAProject.id,
      'file.uploaded',
    );
    const internalRow = rows.find(
      (r) => (r.payload as { visibility?: string }).visibility === 'org_only',
    );
    expect(internalRow).toBeTruthy();
    expect(internalRow!.visible_to_stakeholders).toBe(false);
  });

  test('inviteStakeholder writes activity row with visible_to_stakeholders=false', async () => {
    const rnd = Math.random().toString(36).slice(2, 10);
    await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: `act-invite-${rnd}@test.local`,
      name: 'Activity Invitee',
      role: 'collaborator',
      visibilityProfile: 'progress_only',
    });

    const rows = await fetchActivity(
      f.service,
      f.extras.orgAProject.id,
      'stakeholder.added_to_project',
    );
    expect(rows.length).toBeGreaterThan(0);
    const latest = rows[rows.length - 1];
    expect(latest.visible_to_stakeholders).toBe(false);
  });

  test('createMilestone with scheduledAt writes activity row inheriting visibleToStakeholders', async () => {
    // visibleToStakeholders=true case.
    await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Visible milestone',
      scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      visibleToStakeholders: true,
    });

    // visibleToStakeholders=false case.
    await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Internal milestone',
      scheduledAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      visibleToStakeholders: false,
    });

    const rows = await fetchActivity(
      f.service,
      f.extras.orgAProject.id,
      'milestone.scheduled',
    );
    const visible = rows.find(
      (r) => (r.payload as { label?: string }).label === 'Visible milestone',
    );
    const hidden = rows.find(
      (r) => (r.payload as { label?: string }).label === 'Internal milestone',
    );
    expect(visible?.visible_to_stakeholders).toBe(true);
    expect(hidden?.visible_to_stakeholders).toBe(false);
  });

  test('createMilestone WITHOUT scheduledAt does NOT write activity (placeholder)', async () => {
    const beforeCount = (
      await fetchActivity(f.service, f.extras.orgAProject.id, 'milestone.scheduled')
    ).length;

    await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Placeholder',
      visibleToStakeholders: true,
    });

    const afterCount = (
      await fetchActivity(f.service, f.extras.orgAProject.id, 'milestone.scheduled')
    ).length;
    expect(afterCount).toBe(beforeCount);
  });
});
