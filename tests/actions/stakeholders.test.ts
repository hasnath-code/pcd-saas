import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext, asAuthUser } from '../helpers/sign-in-fixture';

// Auth + email + ratelimit + sentry mocked exactly like invite.test.ts so the
// action body runs against local Supabase via @/db.
vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgUser: vi.fn(),
  };
});

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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  acceptStakeholderInvitation,
  inviteStakeholder,
  removeStakeholder,
  updateStakeholder,
} from '@/actions/stakeholders';
import * as auth from '@/lib/auth/requireAuth';
import * as email from '@/lib/email/send';
import * as Sentry from '@sentry/nextjs';

describe('inviteStakeholder', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    // Cleanup any project_stakeholders / invitations seeded across tests.
    await f.service.from('project_stakeholders').delete().in('project_id', [
      f.extras.orgAProject.id,
      f.extras.orgBProject.id,
    ]);
    await f.service
      .from('invitations')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('happy path → success + rows in project_stakeholders + invitations', async () => {
    const inviteEmail = `inv-happy-${uuidv7()}@test.local`;
    const result = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Happy Path',
      role: 'collaborator',
      visibilityProfile: 'progress_only',
    });
    expect(result).toMatchObject({ success: true });
    expect('data' in result && result.data?.invitationId).toBeTruthy();

    // Confirm rows landed.
    const { data: invs } = await f.service
      .from('invitations')
      .select('id, invitation_type, project_id, visibility_profile')
      .eq('email', inviteEmail);
    expect(invs?.length).toBe(1);
    expect(invs?.[0].invitation_type).toBe('stakeholder');
    expect(invs?.[0].project_id).toBe(f.extras.orgAProject.id);
    expect(invs?.[0].visibility_profile).toBe('progress_only');

    const { data: stakeholders } = await f.service
      .from('project_stakeholders')
      .select('id, role, can_view_financials, can_view_schedule')
      .eq('project_id', f.extras.orgAProject.id);
    expect(stakeholders?.length).toBeGreaterThan(0);
    const created = stakeholders?.find((s) => s.role === 'collaborator');
    expect(created).toBeDefined();
    // progress_only: can_view_financials=false, can_view_schedule=true.
    expect(created?.can_view_financials).toBe(false);
    expect(created?.can_view_schedule).toBe(true);
  });

  test('cross-org project → not_found', async () => {
    const result = await inviteStakeholder({
      projectId: f.extras.orgBProject.id, // different org
      email: `inv-crossorg-${uuidv7()}@test.local`,
      name: 'Cross Org',
      role: 'observer',
      visibilityProfile: 'full',
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'project' });
  });

  test('duplicate non-cancelled invitation → conflict/invitation_already_pending', async () => {
    const inviteEmail = `inv-dupe-${uuidv7()}@test.local`;
    const first = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Dupe Test',
      role: 'observer',
      visibilityProfile: 'documents_only',
    });
    expect(first).toMatchObject({ success: true });

    const second = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Dupe Test',
      role: 'observer',
      visibilityProfile: 'documents_only',
    });
    expect(second).toMatchObject({ error: 'conflict', reason: 'invitation_already_pending' });
  });

  test('sendEmail throws → success + deliveryWarning', async () => {
    vi.mocked(email.sendEmail).mockRejectedValueOnce(new Error('Resend test-mode reject'));
    const inviteEmail = `inv-warn-${uuidv7()}@test.local`;
    const result = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Warn Test',
      role: 'observer',
      visibilityProfile: 'full',
    });
    expect(result).toMatchObject({
      success: true,
      deliveryWarning: 'email_send_failed',
    });
    expect(Sentry.captureException).toHaveBeenCalled();
    // Confirm the invitation row IS persisted despite the email failure.
    const { data: invs } = await f.service
      .from('invitations')
      .select('id')
      .eq('email', inviteEmail);
    expect(invs?.length).toBe(1);
  });

  test('re-invite after removal → undelete path resets fields', async () => {
    const inviteEmail = `inv-reinvite-${uuidv7()}@test.local`;
    const first = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Reinvite Test',
      role: 'collaborator',
      visibilityProfile: 'full',
    });
    expect(first).toMatchObject({ success: true });
    const firstClientId = ('data' in first && first.data?.clientId) || '';

    // Use removeStakeholder rather than manual table updates — the action
    // soft-deletes the project_stakeholders row AND cascade-cancels the
    // pending invitation atomically (Session 7 hotfix). Both behaviors are
    // now exercised here.
    const { data: stkBefore } = await f.service
      .from('project_stakeholders')
      .select('id')
      .eq('project_id', f.extras.orgAProject.id)
      .eq('client_id', firstClientId)
      .single();
    const removeResult = await removeStakeholder({ stakeholderId: stkBefore!.id });
    expect(removeResult).toMatchObject({ success: true });

    // Re-invite with a different role + profile to verify the undelete resets.
    const second = await inviteStakeholder({
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Reinvite Test',
      role: 'observer',
      visibilityProfile: 'schedule_only',
    });
    expect(second).toMatchObject({ success: true });

    const { data: rows } = await f.service
      .from('project_stakeholders')
      .select('role, visibility_profile, can_view_drawings, deleted_at')
      .eq('project_id', f.extras.orgAProject.id)
      .eq('client_id', firstClientId);
    expect(rows?.length).toBe(1);
    expect(rows?.[0].role).toBe('observer');
    expect(rows?.[0].visibility_profile).toBe('schedule_only');
    // schedule_only has can_view_drawings=false.
    expect(rows?.[0].can_view_drawings).toBe(false);
    expect(rows?.[0].deleted_at).toBeNull();
  });
});

describe('acceptStakeholderInvitation', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service.from('project_stakeholders').delete().in('project_id', [
      f.extras.orgAProject.id,
      f.extras.orgBProject.id,
    ]);
    await f.service
      .from('invitations')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });

  // Helper: prepare a stakeholder invite end-to-end (auth user + clients row +
  // project_stakeholders row + invitations row) and return the bits the test
  // needs. Mirrors how inviteStakeholder would set things up, but bypasses
  // the action so we control state.
  async function seedStakeholderInvite(opts: {
    cancelled?: boolean;
  }): Promise<{ token: string; authUserId: string; email: string; clientId: string }> {
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `acc-${ts}-${rnd}@test.local`;
    const password = `pwAcc-${rnd}-x9X`;

    const { data: au } = await f.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const authUserId = au.user!.id;

    // Pre-create clients row WITHOUT auth_user_id link (mirror invite-time
    // state); accept will backfill it.
    const clientId = uuidv7();
    await f.service.from('clients').insert({ id: clientId, email, name: 'Acceptor' });
    await f.service
      .from('client_org_memberships')
      .insert({ id: uuidv7(), client_id: clientId, org_id: f.orgA.id });

    // project_stakeholders row, NOT yet accepted.
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: clientId,
      role: 'collaborator',
      visibility_profile: 'full',
      invited_by: f.userA.userId,
    });

    // invitations row with stakeholder kind + project context.
    const token = uuidv7();
    await f.service.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgA.id,
      email,
      invitation_type: 'stakeholder',
      project_id: f.extras.orgAProject.id,
      stakeholder_role: 'collaborator',
      visibility_profile: 'full',
      token,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      invited_by: f.userA.userId,
      deleted_at: opts.cancelled ? new Date().toISOString() : null,
    });

    return { token, authUserId, email, clientId };
  }

  test('happy path → backfills auth_user_id + sets accepted_at on both rows', async () => {
    const seeded = await seedStakeholderInvite({});
    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: seeded.authUserId,
        userId: '',
        email: seeded.email,
        password: '',
      }),
    );

    const result = await acceptStakeholderInvitation({ token: seeded.token });
    expect(result).toMatchObject({
      success: true,
      data: { projectId: f.extras.orgAProject.id },
    });

    // clients.auth_user_id backfilled.
    const { data: clientRow } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', seeded.clientId)
      .single();
    expect(clientRow?.auth_user_id).toBe(seeded.authUserId);

    // project_stakeholders.accepted_at set.
    const { data: ps } = await f.service
      .from('project_stakeholders')
      .select('accepted_at')
      .eq('project_id', f.extras.orgAProject.id)
      .eq('client_id', seeded.clientId)
      .single();
    expect(ps?.accepted_at).not.toBeNull();

    // invitations.accepted_at set.
    const { data: inv } = await f.service
      .from('invitations')
      .select('accepted_at')
      .eq('token', seeded.token)
      .single();
    expect(inv?.accepted_at).not.toBeNull();

    // Cleanup auth user.
    await f.service.auth.admin.deleteUser(seeded.authUserId);
  });

  test('cancelled invitation → conflict/cancelled (security: no auth_user_id backfill)', async () => {
    const seeded = await seedStakeholderInvite({ cancelled: true });
    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: seeded.authUserId,
        userId: '',
        email: seeded.email,
        password: '',
      }),
    );

    const result = await acceptStakeholderInvitation({ token: seeded.token });
    expect(result).toMatchObject({ error: 'conflict', reason: 'cancelled' });

    // Confirm clients.auth_user_id was NOT backfilled — proves cancelled
    // invitation can't be used to claim the client identity.
    const { data: clientRow } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', seeded.clientId)
      .single();
    expect(clientRow?.auth_user_id).toBeNull();

    // project_stakeholders.accepted_at still NULL.
    const { data: ps } = await f.service
      .from('project_stakeholders')
      .select('accepted_at')
      .eq('project_id', f.extras.orgAProject.id)
      .eq('client_id', seeded.clientId)
      .single();
    expect(ps?.accepted_at).toBeNull();

    await f.service.auth.admin.deleteUser(seeded.authUserId);
  });
});

describe('updateStakeholder + removeStakeholder', () => {
  let f: WorkflowProjectFixture;
  let stakeholderId: string;
  let clientId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Seed a clients row + project_stakeholders row to mutate.
    clientId = uuidv7();
    await f.service.from('clients').insert({
      id: clientId,
      email: `upd-${uuidv7()}@test.local`,
      name: 'Mutate Me',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: clientId,
      org_id: f.orgA.id,
    });
    stakeholderId = uuidv7();
    await f.service.from('project_stakeholders').insert({
      id: stakeholderId,
      project_id: f.extras.orgAProject.id,
      client_id: clientId,
      role: 'collaborator',
      visibility_profile: 'full',
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
  });
  afterAll(async () => {
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await f.service.from('client_org_memberships').delete().eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('updateStakeholder individual flag change without profile → flips to custom', async () => {
    const result = await updateStakeholder({
      stakeholderId,
      customFlags: { canViewFinancials: false },
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_stakeholders')
      .select('visibility_profile, can_view_financials')
      .eq('id', stakeholderId)
      .single();
    expect(data?.visibility_profile).toBe('custom');
    expect(data?.can_view_financials).toBe(false);
  });

  test('removeStakeholder happy path → soft-deletes + audit', async () => {
    const result = await removeStakeholder({ stakeholderId });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_stakeholders')
      .select('deleted_at')
      .eq('id', stakeholderId)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });
});

describe('removeStakeholder cascade-cancel', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service
      .from('project_stakeholders')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.service
      .from('invitations')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  // Helper: seed an accepted stakeholder + paired invitation. Returns the bits
  // each cascade-cancel test needs. acceptedInvitation=false means a pending
  // invitation (the cascade target); =true means an already-accepted one
  // (which the cascade must leave alone).
  async function seedStakeholderWithInvitation(opts: {
    acceptedInvitation: boolean;
    needsAuthUser?: boolean;
  }): Promise<{
    stakeholderId: string;
    clientId: string;
    invitationId: string;
    token: string;
    email: string;
    authUserId?: string;
  }> {
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `cascade-${ts}-${rnd}@test.local`;

    let authUserId: string | undefined;
    if (opts.needsAuthUser) {
      const password = `pwCas-${rnd}-x9X`;
      const { data: au } = await f.service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      authUserId = au.user!.id;
    }

    const clientId = uuidv7();
    await f.service.from('clients').insert({ id: clientId, email, name: 'Cascade Test' });
    await f.service
      .from('client_org_memberships')
      .insert({ id: uuidv7(), client_id: clientId, org_id: f.orgA.id });

    const stakeholderId = uuidv7();
    await f.service.from('project_stakeholders').insert({
      id: stakeholderId,
      project_id: f.extras.orgAProject.id,
      client_id: clientId,
      role: 'collaborator',
      visibility_profile: 'full',
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });

    const invitationId = uuidv7();
    const token = uuidv7();
    await f.service.from('invitations').insert({
      id: invitationId,
      org_id: f.orgA.id,
      email,
      invitation_type: 'stakeholder',
      project_id: f.extras.orgAProject.id,
      stakeholder_role: 'collaborator',
      visibility_profile: 'full',
      token,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      invited_by: f.userA.userId,
      accepted_at: opts.acceptedInvitation ? new Date().toISOString() : null,
    });

    return { stakeholderId, clientId, invitationId, token, email, authUserId };
  }

  test('cascades pending invitation → invitations.deleted_at set + audit log entry', async () => {
    const seeded = await seedStakeholderWithInvitation({ acceptedInvitation: false });

    const result = await removeStakeholder({ stakeholderId: seeded.stakeholderId });
    expect(result).toMatchObject({ success: true });

    const { data: inv } = await f.service
      .from('invitations')
      .select('deleted_at, accepted_at')
      .eq('id', seeded.invitationId)
      .single();
    expect(inv?.deleted_at).not.toBeNull();
    expect(inv?.accepted_at).toBeNull();

    // Audit log entry with the cascade reason.
    const { data: audit } = await f.service
      .from('audit_logs')
      .select('action, resource_type, resource_id, metadata')
      .eq('resource_id', seeded.invitationId)
      .eq('resource_type', 'invitation');
    expect(audit?.length).toBe(1);
    expect(audit?.[0].action).toBe('soft_delete');
    expect(
      (audit?.[0].metadata as Record<string, unknown> | null)?.reason,
    ).toBe('cascade_from_remove_stakeholder');
  });

  test('leaves accepted invitation untouched', async () => {
    const seeded = await seedStakeholderWithInvitation({ acceptedInvitation: true });

    const result = await removeStakeholder({ stakeholderId: seeded.stakeholderId });
    expect(result).toMatchObject({ success: true });

    const { data: inv } = await f.service
      .from('invitations')
      .select('deleted_at, accepted_at')
      .eq('id', seeded.invitationId)
      .single();
    // accepted_at remains set; deleted_at remains NULL — Design C preserves
    // history for already-accepted invitations.
    expect(inv?.accepted_at).not.toBeNull();
    expect(inv?.deleted_at).toBeNull();

    // No invitation audit log for the cascade — the cascade only fires when
    // acceptedAt IS NULL.
    const { data: audit } = await f.service
      .from('audit_logs')
      .select('id')
      .eq('resource_id', seeded.invitationId)
      .eq('resource_type', 'invitation');
    expect(audit?.length).toBe(0);
  });

  test('removed-then-replay → cancelled token returns conflict/cancelled', async () => {
    // Seed a fresh stakeholder + pending invitation + auth user (the auth
    // user is needed to call acceptStakeholderInvitation after the cascade).
    const seeded = await seedStakeholderWithInvitation({
      acceptedInvitation: false,
      needsAuthUser: true,
    });

    // First, remove — cascades the invitation cancel.
    const removeResult = await removeStakeholder({ stakeholderId: seeded.stakeholderId });
    expect(removeResult).toMatchObject({ success: true });

    // Now attempt to use the cancelled token. Should reject with the same
    // shape as a manually-cancelled invitation (existing security path).
    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: seeded.authUserId!,
        userId: '',
        email: seeded.email,
        password: '',
      }),
    );
    const acceptResult = await acceptStakeholderInvitation({ token: seeded.token });
    expect(acceptResult).toMatchObject({ error: 'conflict', reason: 'cancelled' });

    // Cleanup the auth user we created.
    await f.service.auth.admin.deleteUser(seeded.authUserId!);
  });
});
