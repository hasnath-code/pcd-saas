import { v7 as uuidv7 } from 'uuid';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from './with-workflow-and-projects';
import { asUser } from '../helpers/as-user';
import {
  applyVisibilityProfile,
  type VisibilityFlags,
  type VisibilityProfile,
} from '@/lib/visibility-profiles';

// Stakeholder fixture set for Phase B/C matrix and edge-case tests. Each
// builder layers on top of createWorkflowProjectFixture() and returns a
// StakeholderFixture with the org-owner client and (where applicable) the
// stakeholder's signed-in client. cleanup is sequential, matching the
// existing fixture convention in two-orgs.ts and with-workflow-and-projects.ts.

export interface StakeholderFixture {
  base: WorkflowProjectFixture;
  service: SupabaseClient;
  orgUserAuth: SupabaseClient;
  /** Omitted when the stakeholder has no auth identity (pending, expired, soft-deleted client). */
  stakeholderAuth?: SupabaseClient;
  orgId: string;
  projectId: string;
  stakeholderId: string;
  clientId: string;
  invitationId: string;
  email: string;
  cleanup: () => Promise<void>;
}

export interface MultiOrgStakeholderFixture extends StakeholderFixture {
  /** The second project the same stakeholder identity is attached to (different org). */
  extras: {
    secondOrgId: string;
    secondProjectId: string;
    secondStakeholderId: string;
    secondInvitationId: string;
  };
}

export interface OwnerAndStakeholderFixture extends StakeholderFixture {
  /** The org the user owns (distinct from `orgId`, which is the org of the project they are a stakeholder of). */
  extras: {
    ownedOrgId: string;
    ownedProjectId: string;
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

async function mintAuthIdentity(service: SupabaseClient, label: string): Promise<{
  authUserId: string;
  email: string;
  password: string;
}> {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  const email = `${label}-${ts}-${rnd}@test.local`;
  const password = `pw-${rnd}-x9X`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`mintAuthIdentity ${label}: ${error?.message ?? 'no user'}`);
  }
  return { authUserId: data.user.id, email, password };
}

async function insertClientRow(
  service: SupabaseClient,
  opts: { id?: string; email: string; authUserId?: string; deleted?: boolean },
): Promise<string> {
  const id = opts.id ?? uuidv7();
  const row: Record<string, unknown> = {
    id,
    email: opts.email,
    name: 'Stakeholder Test',
  };
  if (opts.authUserId) row.auth_user_id = opts.authUserId;
  if (opts.deleted) row.deleted_at = new Date().toISOString();
  const { error } = await service.from('clients').insert(row);
  if (error) throw new Error(`insertClientRow: ${error.message}`);
  return id;
}

async function insertProjectStakeholderRow(
  service: SupabaseClient,
  opts: {
    projectId: string;
    clientId: string;
    invitedByUserId: string;
    profile: VisibilityProfile;
    customFlags?: VisibilityFlags;
    accepted: boolean;
    deleted?: boolean;
    role?: 'primary_client' | 'collaborator' | 'observer' | 'billing_contact';
  },
): Promise<string> {
  const id = uuidv7();
  const flags = applyVisibilityProfile(
    opts.profile,
    opts.profile === 'custom' && !opts.customFlags
      ? // Default custom flags for builders that don't pass one — caller can
        // override afterward via service-role UPDATE.
        {
          canViewFinancials: false,
          canViewDrawings: false,
          canViewSchedule: false,
          canMessage: false,
          canUploadFiles: false,
        }
      : opts.customFlags,
  );
  const row: Record<string, unknown> = {
    id,
    project_id: opts.projectId,
    client_id: opts.clientId,
    role: opts.role ?? 'collaborator',
    visibility_profile: opts.profile,
    can_view_financials: flags.canViewFinancials,
    can_view_drawings: flags.canViewDrawings,
    can_view_schedule: flags.canViewSchedule,
    can_message: flags.canMessage,
    can_upload_files: flags.canUploadFiles,
    invited_by: opts.invitedByUserId,
    accepted_at: opts.accepted ? new Date().toISOString() : null,
    deleted_at: opts.deleted ? new Date().toISOString() : null,
  };
  const { error } = await service.from('project_stakeholders').insert(row);
  if (error) throw new Error(`insertProjectStakeholderRow: ${error.message}`);
  return id;
}

async function insertInvitationRow(
  service: SupabaseClient,
  opts: {
    orgId: string;
    projectId: string;
    email: string;
    invitedByUserId: string;
    profile: VisibilityProfile;
    accepted?: boolean;
    expired?: boolean;
    deleted?: boolean;
  },
): Promise<{ id: string; token: string }> {
  const id = uuidv7();
  const token = uuidv7();
  const expiresAt = opts.expired
    ? new Date(Date.now() - 86400_000).toISOString()
    : new Date(Date.now() + 86400_000).toISOString();
  const row: Record<string, unknown> = {
    id,
    org_id: opts.orgId,
    email: opts.email,
    invitation_type: 'stakeholder',
    project_id: opts.projectId,
    stakeholder_role: 'collaborator',
    visibility_profile: opts.profile,
    token,
    expires_at: expiresAt,
    invited_by: opts.invitedByUserId,
    accepted_at: opts.accepted ? new Date().toISOString() : null,
    deleted_at: opts.deleted ? new Date().toISOString() : null,
  };
  const { error } = await service.from('invitations').insert(row);
  if (error) throw new Error(`insertInvitationRow: ${error.message}`);
  return { id, token };
}

async function insertOrgMembership(
  service: SupabaseClient,
  clientId: string,
  orgId: string,
): Promise<string> {
  const id = uuidv7();
  const { error } = await service
    .from('client_org_memberships')
    .insert({ id, client_id: clientId, org_id: orgId });
  if (error) throw new Error(`insertOrgMembership: ${error.message}`);
  return id;
}

// ─── Builders ──────────────────────────────────────────────────────────────

/**
 * Happy-path baseline: an accepted stakeholder on Org A's project, with auth
 * identity linked to clients.auth_user_id, with the given visibility profile.
 */
export async function buildAcceptedStakeholderFixture(
  profile: VisibilityProfile,
  customFlags?: VisibilityFlags,
): Promise<StakeholderFixture> {
  const base = await createWorkflowProjectFixture();
  const auth = await mintAuthIdentity(base.service, 'accepted');

  const clientId = await insertClientRow(base.service, {
    email: auth.email,
    authUserId: auth.authUserId,
  });
  const membershipId = await insertOrgMembership(base.service, clientId, base.orgA.id);
  const stakeholderId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgAProject.id,
    clientId,
    invitedByUserId: base.userA.userId,
    profile,
    customFlags,
    accepted: true,
  });
  const invitation = await insertInvitationRow(base.service, {
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    email: auth.email,
    invitedByUserId: base.userA.userId,
    profile,
    accepted: true,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);
  const stakeholderAuth = await asUser(auth.email, auth.password);

  const cleanup = async () => {
    await base.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await base.service.from('invitations').delete().eq('id', invitation.id);
    await base.service.from('client_org_memberships').delete().eq('id', membershipId);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.service.auth.admin.deleteUser(auth.authUserId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    stakeholderAuth,
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    stakeholderId,
    clientId,
    invitationId: invitation.id,
    email: auth.email,
    cleanup,
  };
}

/**
 * Pending: invitation sent but not accepted (accepted_at IS NULL on both
 * project_stakeholders and invitations). No auth identity is created — the
 * stakeholder hasn't gone through the magic-link flow yet.
 */
export async function buildPendingStakeholderFixture(): Promise<StakeholderFixture> {
  const base = await createWorkflowProjectFixture();
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  const email = `pending-${ts}-${rnd}@test.local`;

  const clientId = await insertClientRow(base.service, { email });
  const membershipId = await insertOrgMembership(base.service, clientId, base.orgA.id);
  const stakeholderId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgAProject.id,
    clientId,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: false,
  });
  const invitation = await insertInvitationRow(base.service, {
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    email,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: false,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);

  const cleanup = async () => {
    await base.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await base.service.from('invitations').delete().eq('id', invitation.id);
    await base.service.from('client_org_memberships').delete().eq('id', membershipId);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    stakeholderId,
    clientId,
    invitationId: invitation.id,
    email,
    cleanup,
  };
}

/**
 * Removed: stakeholder accepted, then soft-deleted (project_stakeholders.deleted_at IS NOT NULL).
 * The clients row remains intact (could still be a stakeholder on other projects).
 */
export async function buildRemovedStakeholderFixture(): Promise<StakeholderFixture> {
  const base = await createWorkflowProjectFixture();
  const auth = await mintAuthIdentity(base.service, 'removed');

  const clientId = await insertClientRow(base.service, {
    email: auth.email,
    authUserId: auth.authUserId,
  });
  const membershipId = await insertOrgMembership(base.service, clientId, base.orgA.id);
  const stakeholderId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgAProject.id,
    clientId,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: true,
    deleted: true,
  });
  const invitation = await insertInvitationRow(base.service, {
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    email: auth.email,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: true,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);
  const stakeholderAuth = await asUser(auth.email, auth.password);

  const cleanup = async () => {
    await base.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await base.service.from('invitations').delete().eq('id', invitation.id);
    await base.service.from('client_org_memberships').delete().eq('id', membershipId);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.service.auth.admin.deleteUser(auth.authUserId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    stakeholderAuth,
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    stakeholderId,
    clientId,
    invitationId: invitation.id,
    email: auth.email,
    cleanup,
  };
}

/**
 * Soft-deleted client: clients.deleted_at IS NOT NULL. The project_stakeholders
 * row still exists but cascade-hidden via the helper's clients.deleted_at IS
 * NULL check. Stakeholder cannot log in to the portal because asUser() against
 * a soft-deleted client identity returns rows but no project access.
 */
export async function buildSoftDeletedClientFixture(): Promise<StakeholderFixture> {
  const base = await createWorkflowProjectFixture();
  const auth = await mintAuthIdentity(base.service, 'softclient');

  const clientId = await insertClientRow(base.service, {
    email: auth.email,
    authUserId: auth.authUserId,
    deleted: true,
  });
  const membershipId = await insertOrgMembership(base.service, clientId, base.orgA.id);
  const stakeholderId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgAProject.id,
    clientId,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: true,
  });
  const invitation = await insertInvitationRow(base.service, {
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    email: auth.email,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: true,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);
  // Stakeholder auth still exists in auth.users — login works, but RLS hides
  // their project. Provide the client so tests can verify the post-login
  // visibility gate.
  const stakeholderAuth = await asUser(auth.email, auth.password);

  const cleanup = async () => {
    await base.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await base.service.from('invitations').delete().eq('id', invitation.id);
    await base.service.from('client_org_memberships').delete().eq('id', membershipId);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.service.auth.admin.deleteUser(auth.authUserId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    stakeholderAuth,
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    stakeholderId,
    clientId,
    invitationId: invitation.id,
    email: auth.email,
    cleanup,
  };
}

/**
 * Expired invitation: expires_at in the past, never accepted. Token is still
 * in the DB but acceptStakeholderInvitation should reject as expired.
 */
export async function buildExpiredInvitationFixture(): Promise<
  StakeholderFixture & { token: string; authUserId: string; password: string }
> {
  const base = await createWorkflowProjectFixture();
  // Auth user is created so tests can call acceptStakeholderInvitation with a
  // real identity and verify the rejection happens before any backfill.
  const auth = await mintAuthIdentity(base.service, 'expired');

  const clientId = await insertClientRow(base.service, { email: auth.email });
  const membershipId = await insertOrgMembership(base.service, clientId, base.orgA.id);
  const stakeholderId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgAProject.id,
    clientId,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: false,
  });
  const invitation = await insertInvitationRow(base.service, {
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    email: auth.email,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: false,
    expired: true,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);

  const cleanup = async () => {
    await base.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await base.service.from('invitations').delete().eq('id', invitation.id);
    await base.service.from('client_org_memberships').delete().eq('id', membershipId);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.service.auth.admin.deleteUser(auth.authUserId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    stakeholderId,
    clientId,
    invitationId: invitation.id,
    email: auth.email,
    token: invitation.token,
    authUserId: auth.authUserId,
    password: auth.password,
    cleanup,
  };
}

/**
 * Multi-org stakeholder: same auth identity (Sarah) accepted as stakeholder
 * on both Org A's project and Org B's project. Uses ONE clients row (UNIQUE
 * email) with two project_stakeholders rows — mirrors how a real client
 * would appear when both orgs invite them via the same email.
 */
export async function buildMultiOrgStakeholderFixture(): Promise<MultiOrgStakeholderFixture> {
  const base = await createWorkflowProjectFixture();
  const auth = await mintAuthIdentity(base.service, 'multiorg');

  // Single clients row (clients.email is UNIQUE).
  const clientId = await insertClientRow(base.service, {
    email: auth.email,
    authUserId: auth.authUserId,
  });
  const membershipAId = await insertOrgMembership(base.service, clientId, base.orgA.id);
  const membershipBId = await insertOrgMembership(base.service, clientId, base.orgB.id);

  const stakeholderAId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgAProject.id,
    clientId,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: true,
  });
  const stakeholderBId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgBProject.id,
    clientId,
    invitedByUserId: base.userB.userId,
    profile: 'full',
    accepted: true,
  });

  const invitationA = await insertInvitationRow(base.service, {
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    email: auth.email,
    invitedByUserId: base.userA.userId,
    profile: 'full',
    accepted: true,
  });
  const invitationB = await insertInvitationRow(base.service, {
    orgId: base.orgB.id,
    projectId: base.extras.orgBProject.id,
    email: auth.email,
    invitedByUserId: base.userB.userId,
    profile: 'full',
    accepted: true,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);
  const stakeholderAuth = await asUser(auth.email, auth.password);

  const cleanup = async () => {
    await base.service
      .from('project_stakeholders')
      .delete()
      .in('id', [stakeholderAId, stakeholderBId]);
    await base.service.from('invitations').delete().in('id', [invitationA.id, invitationB.id]);
    await base.service
      .from('client_org_memberships')
      .delete()
      .in('id', [membershipAId, membershipBId]);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.service.auth.admin.deleteUser(auth.authUserId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    stakeholderAuth,
    orgId: base.orgA.id,
    projectId: base.extras.orgAProject.id,
    stakeholderId: stakeholderAId,
    clientId,
    invitationId: invitationA.id,
    email: auth.email,
    extras: {
      secondOrgId: base.orgB.id,
      secondProjectId: base.extras.orgBProject.id,
      secondStakeholderId: stakeholderBId,
      secondInvitationId: invitationB.id,
    },
    cleanup,
  };
}

/**
 * Owner + stakeholder dual context: the SAME auth identity is the owner of
 * Org A AND a stakeholder of a project in Org B. auth_user_orgs() returns
 * Org A only; auth_user_stakeholder_projects() returns Org B's project only.
 * Tests verify no leakage in either direction (e.g., the user shouldn't see
 * Org A's projects via the stakeholder gate, and vice versa).
 *
 * Implementation: the two-org base fixture creates User A as owner of Org A.
 * We add a clients row + project_stakeholders row in Org B linked to User A's
 * auth_user_id. Now User A has both contexts via the same auth identity.
 */
export async function buildOwnerAndStakeholderFixture(): Promise<OwnerAndStakeholderFixture> {
  const base = await createWorkflowProjectFixture();

  // userA is already owner of orgA; reuse their auth identity as the
  // stakeholder of orgB's project.
  const clientId = await insertClientRow(base.service, {
    email: base.userA.email,
    authUserId: base.userA.authUserId,
  });
  const membershipBId = await insertOrgMembership(base.service, clientId, base.orgB.id);
  const stakeholderBId = await insertProjectStakeholderRow(base.service, {
    projectId: base.extras.orgBProject.id,
    clientId,
    invitedByUserId: base.userB.userId,
    profile: 'full',
    accepted: true,
  });
  const invitationB = await insertInvitationRow(base.service, {
    orgId: base.orgB.id,
    projectId: base.extras.orgBProject.id,
    email: base.userA.email,
    invitedByUserId: base.userB.userId,
    profile: 'full',
    accepted: true,
  });

  const orgUserAuth = await asUser(base.userA.email, base.userA.password);
  // Same identity, same client — for this fixture, stakeholderAuth is the
  // same session as orgUserAuth. Tests query against this single client
  // to verify dual-context resolution.
  const stakeholderAuth = orgUserAuth;

  const cleanup = async () => {
    await base.service.from('project_stakeholders').delete().eq('id', stakeholderBId);
    await base.service.from('invitations').delete().eq('id', invitationB.id);
    await base.service.from('client_org_memberships').delete().eq('id', membershipBId);
    await base.service.from('clients').delete().eq('id', clientId);
    await base.cleanup();
  };

  return {
    base,
    service: base.service,
    orgUserAuth,
    stakeholderAuth,
    orgId: base.orgB.id, // the project's org (where they are a stakeholder)
    projectId: base.extras.orgBProject.id,
    stakeholderId: stakeholderBId,
    clientId,
    invitationId: invitationB.id,
    email: base.userA.email,
    extras: {
      ownedOrgId: base.orgA.id,
      ownedProjectId: base.extras.orgAProject.id,
    },
    cleanup,
  };
}
