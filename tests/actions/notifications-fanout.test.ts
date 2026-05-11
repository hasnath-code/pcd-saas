import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

// Phase 5 fan-out tests: each wired action inserts notification rows for
// the expected recipient set inside its Drizzle transaction. Hard Rule 6.
// We mock sendEmail so Resend isn't hit; assertions read notifications
// rows back via the service role.

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({
    messageId: 'mocked-fanout-msg',
    emailEventId: null,
  }),
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

import { sendMessage } from '@/actions/messages';
import { moveProjectToStage } from '@/actions/projects';
import { confirmUpload } from '@/actions/files';
import { inviteStakeholder } from '@/actions/stakeholders';
import { createMilestone } from '@/actions/milestones';
import * as auth from '@/lib/auth/requireAuth';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
} from '@/lib/notifications/events';

// --- helpers -----------------------------------------------------------------

async function seedDefaultPrefs(
  service: WorkflowProjectFixture['service'],
  ownership: { userId: string } | { clientId: string },
) {
  const rows = NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      id: uuidv7(),
      user_id: 'userId' in ownership ? ownership.userId : null,
      client_id: 'clientId' in ownership ? ownership.clientId : null,
      channel,
      event_type: eventType,
      enabled: channel === 'in_app' || channel === 'email',
    })),
  );
  await service
    .from('notification_preferences')
    .insert(rows)
    .throwOnError();
}

async function countNotifs(
  service: WorkflowProjectFixture['service'],
  eventType: string,
  recipientIds: string[],
): Promise<number> {
  if (recipientIds.length === 0) return 0;
  const { data, error } = await service
    .from('notifications')
    .select('id, recipient_id, channel')
    .eq('event_type', eventType)
    .in('recipient_id', recipientIds);
  if (error) throw new Error(`countNotifs: ${error.message}`);
  return data?.length ?? 0;
}

async function cleanupNotifs(
  service: WorkflowProjectFixture['service'],
  eventType: string,
) {
  await service.from('notifications').delete().eq('event_type', eventType);
}

// --- sendMessage fan-out -----------------------------------------------------

describe('sendMessage → message.new fan-out', () => {
  let f: WorkflowProjectFixture;
  let conversationId: string;
  let userBId: string; // extra org A member added so message.new has a recipient
  let userBAuthId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // Add a second user to orgA so userA's message has a recipient.
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `fanout-member-${rnd}@test.local`;
    const { data: authData } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${rnd}-x9X`,
      email_confirm: true,
    });
    if (!authData.user) throw new Error('no auth user for fanout member');
    userBAuthId = authData.user.id;
    userBId = uuidv7();
    await f.service.from('users').insert({
      id: userBId,
      auth_user_id: authData.user.id,
      org_id: f.orgA.id,
      email,
      name: 'Fanout B',
      role: 'member',
    });

    // Seed prefs for the two recipients we'll assert against.
    await seedDefaultPrefs(f.service, { userId: f.userA.userId });
    await seedDefaultPrefs(f.service, { userId: userBId });

    // Create a conversation with both userA + userB as participants. Skip
    // any auto-create flows — just insert via service role.
    conversationId = uuidv7();
    await f.service.from('conversations').insert({
      id: conversationId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'group',
      name: 'Fanout test thread',
      created_by: f.userA.userId,
    });
    await f.service.from('conversation_participants').insert([
      {
        id: uuidv7(),
        conversation_id: conversationId,
        participant_type: 'user',
        participant_id: f.userA.userId,
      },
      {
        id: uuidv7(),
        conversation_id: conversationId,
        participant_type: 'user',
        participant_id: userBId,
      },
    ]);
  });

  afterAll(async () => {
    await cleanupNotifs(f.service, 'message.new');
    await f.service
      .from('notification_preferences')
      .delete()
      .in('user_id', [f.userA.userId, userBId]);
    await f.service.from('messages').delete().eq('conversation_id', conversationId);
    await f.service
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', conversationId);
    await f.service.from('conversations').delete().eq('id', conversationId);
    await f.service.from('users').delete().eq('id', userBId);
    await f.service.auth.admin.deleteUser(userBAuthId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
  });

  test('sendMessage inserts notification rows for other participants (excludes sender)', async () => {
    const result = await sendMessage({
      conversationId,
      body: 'hello team',
    });
    expect('error' in result).toBe(false);

    // Sender (userA) should have zero notifications for message.new in this conv.
    expect(await countNotifs(f.service, 'message.new', [f.userA.userId])).toBe(0);
    // Recipient (userB) should have 2 rows: in_app + email.
    expect(await countNotifs(f.service, 'message.new', [userBId])).toBe(2);
  });
});

// --- moveProjectToStage fan-out ---------------------------------------------

describe('moveProjectToStage → project.stage_changed fan-out', () => {
  let f: WorkflowProjectFixture;
  let stakeholderClientId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // Seed userA prefs (org member recipient).
    await seedDefaultPrefs(f.service, { userId: f.userA.userId });

    // Add an accepted stakeholder to orgA project to validate the client branch.
    const rnd = Math.random().toString(36).slice(2, 10);
    stakeholderClientId = uuidv7();
    await f.service.from('clients').insert({
      id: stakeholderClientId,
      email: `fanout-stake-${rnd}@test.local`,
      name: 'Fanout Stakeholder',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: stakeholderClientId,
      org_id: f.orgA.id,
    });
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: stakeholderClientId,
      role: 'primary_client',
      visibility_profile: 'full',
      can_message: true,
      can_upload_files: true,
      can_view_financials: true,
      can_view_drawings: true,
      can_view_schedule: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
    await seedDefaultPrefs(f.service, { clientId: stakeholderClientId });
  });

  afterAll(async () => {
    await cleanupNotifs(f.service, 'project.stage_changed');
    await f.service
      .from('notification_preferences')
      .delete()
      .in('user_id', [f.userA.userId]);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('moveProjectToStage notifies org members + accepted stakeholders', async () => {
    // Resolve a different stage to move into.
    const { data: stages } = await f.service
      .from('workflow_stages')
      .select('id, position')
      .eq('workflow_id', f.extras.orgAWorkflow.id)
      .order('position');
    const toStage = stages?.find((s) => s.id !== f.extras.orgAWorkflow.firstStageId);
    expect(toStage).toBeTruthy();

    const result = await moveProjectToStage({
      projectId: f.extras.orgAProject.id,
      toStageId: toStage!.id,
    });
    expect('error' in result).toBe(false);

    // Both recipients should have 2 rows each (in_app + email).
    expect(await countNotifs(f.service, 'project.stage_changed', [f.userA.userId])).toBe(2);
    expect(
      await countNotifs(f.service, 'project.stage_changed', [stakeholderClientId]),
    ).toBe(2);
  });
});

// --- confirmUpload fan-out ---------------------------------------------------

describe('confirmUpload → file.uploaded fan-out', () => {
  let f: WorkflowProjectFixture;
  let stakeholderClientId: string;
  let stakeholderAuthId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    await seedDefaultPrefs(f.service, { userId: f.userA.userId });

    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `fanout-file-${rnd}@test.local`;
    const { data: authData } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${rnd}-x9X`,
      email_confirm: true,
    });
    if (!authData.user) throw new Error('no stakeholder auth');
    stakeholderAuthId = authData.user.id;
    stakeholderClientId = uuidv7();
    await f.service.from('clients').insert({
      id: stakeholderClientId,
      auth_user_id: authData.user.id,
      email,
      name: 'File Stakeholder',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: stakeholderClientId,
      org_id: f.orgA.id,
    });
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: stakeholderClientId,
      role: 'primary_client',
      visibility_profile: 'full',
      can_message: true,
      can_upload_files: true,
      can_view_financials: true,
      can_view_drawings: true,
      can_view_schedule: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
    await seedDefaultPrefs(f.service, { clientId: stakeholderClientId });
  });

  afterAll(async () => {
    await cleanupNotifs(f.service, 'file.uploaded');
    await f.service.from('project_files').delete().eq('project_id', f.extras.orgAProject.id);
    await f.service
      .from('notification_preferences')
      .delete()
      .in('user_id', [f.userA.userId]);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuthId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
  });

  test('confirmUpload notifies org members + can_view_drawings stakeholders', async () => {
    const fileId = uuidv7();
    const storagePath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${fileId}.pdf`;
    const result = await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath,
      originalFilename: 'survey.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
      visibility: 'org_and_stakeholders',
    });
    expect('error' in result).toBe(false);

    expect(await countNotifs(f.service, 'file.uploaded', [f.userA.userId])).toBe(2);
    expect(
      await countNotifs(f.service, 'file.uploaded', [stakeholderClientId]),
    ).toBe(2);
  });

  test('confirmUpload with visibility=org_only does NOT notify stakeholders', async () => {
    const fileId = uuidv7();
    const storagePath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${fileId}.pdf`;
    const result = await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath,
      originalFilename: 'internal.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
      visibility: 'org_only',
    });
    expect('error' in result).toBe(false);

    // We only fetch event rows since the previous test left some — filter by
    // the row's payload visibility via service-role read.
    const { data: notifs } = await f.service
      .from('notifications')
      .select('recipient_id, payload')
      .eq('event_type', 'file.uploaded')
      .eq('recipient_id', stakeholderClientId);
    const orgOnlyNotifs = (notifs ?? []).filter(
      (n) => (n.payload as { visibility?: string }).visibility === 'org_only',
    );
    expect(orgOnlyNotifs.length).toBe(0);
  });
});

// --- inviteStakeholder fan-out ----------------------------------------------

describe('inviteStakeholder → stakeholder.added_to_project fan-out', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    await seedDefaultPrefs(f.service, { userId: f.userA.userId });
  });

  afterAll(async () => {
    await cleanupNotifs(f.service, 'stakeholder.added_to_project');
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('user_id', f.userA.userId);
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.service
      .from('invitations')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('inviteStakeholder notifies org members only (informational)', async () => {
    const rnd = Math.random().toString(36).slice(2, 10);
    const result = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: `invite-fanout-${rnd}@test.local`,
      name: 'Fanout Invitee',
      role: 'collaborator',
      visibilityProfile: 'progress_only',
    });
    expect('error' in result).toBe(false);

    // userA is the only org member — 2 rows expected (in_app + email).
    expect(
      await countNotifs(f.service, 'stakeholder.added_to_project', [f.userA.userId]),
    ).toBe(2);
  });
});

// --- createMilestone fan-out -------------------------------------------------

describe('createMilestone → milestone.scheduled fan-out', () => {
  let f: WorkflowProjectFixture;
  let stakeholderClientId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    await seedDefaultPrefs(f.service, { userId: f.userA.userId });

    const rnd = Math.random().toString(36).slice(2, 10);
    stakeholderClientId = uuidv7();
    await f.service.from('clients').insert({
      id: stakeholderClientId,
      email: `fanout-ms-${rnd}@test.local`,
      name: 'Milestone Stakeholder',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: stakeholderClientId,
      org_id: f.orgA.id,
    });
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: stakeholderClientId,
      role: 'collaborator',
      visibility_profile: 'progress_only',
      can_message: true,
      can_upload_files: true,
      can_view_financials: false,
      can_view_drawings: true,
      can_view_schedule: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
    await seedDefaultPrefs(f.service, { clientId: stakeholderClientId });
  });

  afterAll(async () => {
    await cleanupNotifs(f.service, 'milestone.scheduled');
    await f.service
      .from('project_milestones')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.service
      .from('notification_preferences')
      .delete()
      .in('user_id', [f.userA.userId]);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('createMilestone with scheduledAt notifies org members + can_view_schedule stakeholders', async () => {
    const result = await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Site visit',
      scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      visibleToStakeholders: true,
    });
    expect('error' in result).toBe(false);

    expect(
      await countNotifs(f.service, 'milestone.scheduled', [f.userA.userId]),
    ).toBe(2);
    expect(
      await countNotifs(f.service, 'milestone.scheduled', [stakeholderClientId]),
    ).toBe(2);
  });

  test('createMilestone WITHOUT scheduledAt does NOT dispatch', async () => {
    // Clean up the previous run's rows so we measure this call in isolation.
    await cleanupNotifs(f.service, 'milestone.scheduled');

    const result = await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Unscheduled placeholder',
      visibleToStakeholders: true,
    });
    expect('error' in result).toBe(false);

    expect(
      await countNotifs(f.service, 'milestone.scheduled', [
        f.userA.userId,
        stakeholderClientId,
      ]),
    ).toBe(0);
  });

  test('createMilestone with visibleToStakeholders=false skips stakeholder dispatch', async () => {
    await cleanupNotifs(f.service, 'milestone.scheduled');

    const result = await createMilestone({
      projectId: f.extras.orgAProject.id,
      label: 'Internal review',
      scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      visibleToStakeholders: false,
    });
    expect('error' in result).toBe(false);

    // Org member: notified.
    expect(
      await countNotifs(f.service, 'milestone.scheduled', [f.userA.userId]),
    ).toBe(2);
    // Stakeholder: NOT notified.
    expect(
      await countNotifs(f.service, 'milestone.scheduled', [stakeholderClientId]),
    ).toBe(0);
  });
});
