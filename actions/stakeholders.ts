'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import {
  AuthError,
  requireAuth,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clients,
  invitations,
  organizations,
  projectStakeholders,
  projects,
  users,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { sendEmail } from '@/lib/email/send';
import { stakeholderInvitationEmail } from '@/lib/email/templates/stakeholder-invitation';
import { rateLimit } from '@/lib/ratelimit';
import { findOrCreateClientTx } from '@/actions/clients';
import {
  autoCreateGeneralConversationTx,
  autoCreateOneToOneConversationTx,
} from '@/actions/conversations';
import {
  applyVisibilityProfile,
  type VisibilityFlags,
  type VisibilityProfile,
} from '@/lib/visibility-profiles';
import { getAppUrl } from '@/lib/get-app-url';
import { seedNotificationDefaultsTx } from '@/lib/notifications/seed-defaults';

export type StakeholderActionResult<T = void> =
  | (T extends void
      ? { success: true; deliveryWarning?: 'email_send_failed' }
      : { success: true; data: T; deliveryWarning?: 'email_send_failed' })
  | { error: ServerActionErrorCode; reason?: string };

const STAKEHOLDER_ROLES = [
  'primary_client',
  'collaborator',
  'observer',
  'billing_contact',
] as const;

const COMPANY_TYPES = [
  'architect_firm',
  'contractor',
  'homeowner',
  'engineer',
  'developer',
  'other',
] as const;

const VISIBILITY_PROFILES = [
  'full',
  'progress_only',
  'documents_only',
  'schedule_only',
  'custom',
] as const;

const CustomFlagsSchema = z.object({
  canViewFinancials: z.boolean(),
  canViewDrawings: z.boolean(),
  canViewSchedule: z.boolean(),
  canMessage: z.boolean(),
  canUploadFiles: z.boolean(),
});

const InviteStakeholderInput = z.object({
  projectId: z.string().uuid(),
  email: z.string().email().toLowerCase().trim(),
  name: z.string().trim().min(1, 'Stakeholder name is required').max(120),
  phone: z.string().trim().max(40).optional(),
  companyName: z.string().trim().max(120).optional(),
  companyType: z.enum(COMPANY_TYPES).optional(),
  role: z.enum(STAKEHOLDER_ROLES),
  visibilityProfile: z.enum(VISIBILITY_PROFILES),
  customFlags: CustomFlagsSchema.optional(),
});

// Invite a stakeholder (homeowner / contractor / engineer / etc.) to a
// specific project. Atomic write of clients + client_org_memberships +
// project_stakeholders + invitations rows in one db.transaction. Email
// send wraps in try/catch (Session 5 hotfix pattern) so Resend's
// testing-mode rejection doesn't roll the user back to a 500 — the
// invitation row is in the DB; UI surfaces a deliveryWarning.
export async function inviteStakeholder(
  input: unknown,
): Promise<StakeholderActionResult<{ invitationId: string; clientId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const { limited, retryAfterSec } = await rateLimit('invite', `org:${ctx.orgId}`);
  if (limited) return { error: 'rate_limited', reason: `retry_after_${retryAfterSec}s` };

  const parsed = InviteStakeholderInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, email, name, phone, companyName, companyType, role, visibilityProfile, customFlags } =
    parsed.data;

  // Verify project belongs to caller's org. Cross-org → not_found (don't
  // leak project existence across orgs).
  const projectRows = await db
    .select({ id: projects.id, orgId: projects.orgId, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRows.length === 0 || projectRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }
  const project = projectRows[0];

  // Block if a non-cancelled, non-expired stakeholder invitation for the same
  // (project, email) already exists.
  const existingInvite = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, ctx.orgId),
        eq(invitations.email, email),
        eq(invitations.projectId, projectId),
        eq(invitations.invitationType, 'stakeholder'),
        isNull(invitations.acceptedAt),
        isNull(invitations.deletedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (existingInvite.length > 0) {
    return { error: 'conflict', reason: 'invitation_already_pending' };
  }

  // Resolve visibility flag values from preset (or custom).
  let flags: VisibilityFlags;
  try {
    flags = applyVisibilityProfile(visibilityProfile as VisibilityProfile, customFlags);
  } catch (e) {
    return {
      error: 'validation_error',
      reason: e instanceof Error ? e.message : 'visibility_profile_resolve_failed',
    };
  }

  // Org name + inviter name for the email.
  const orgRows = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ctx.orgId))
    .limit(1);
  if (orgRows.length === 0) return { error: 'not_found', reason: 'organization' };
  const orgName = orgRows[0].name;

  const inviterRows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  const inviterName = inviterRows[0]?.name ?? 'A teammate';

  const token = uuidv7();
  const invitationId = uuidv7();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  let clientId: string;
  let alreadyExistedDeleted = false;
  try {
    const result = await db.transaction(async (tx) => {
      // 1. Find or create the client row + membership in caller's org.
      const co = await findOrCreateClientTx(
        tx,
        { email, name, phone, companyName, companyType },
        ctx.orgId,
      );

      // 2. project_stakeholders: undelete-or-conflict-or-insert.
      const existingStakeholder = await tx
        .select({ id: projectStakeholders.id, deletedAt: projectStakeholders.deletedAt })
        .from(projectStakeholders)
        .where(
          and(
            eq(projectStakeholders.projectId, projectId),
            eq(projectStakeholders.clientId, co.clientId),
          ),
        )
        .limit(1);
      if (existingStakeholder.length > 0) {
        if (existingStakeholder[0].deletedAt === null) {
          throw new Error('STAKEHOLDER_ALREADY_INVITED');
        }
        // Re-invite path: undelete + reset role/flags + new invited_by/invited_at.
        await tx
          .update(projectStakeholders)
          .set({
            role,
            visibilityProfile,
            canMessage: flags.canMessage,
            canUploadFiles: flags.canUploadFiles,
            canViewFinancials: flags.canViewFinancials,
            canViewDrawings: flags.canViewDrawings,
            canViewSchedule: flags.canViewSchedule,
            invitedBy: ctx.userId,
            invitedAt: new Date(),
            acceptedAt: null,
            deletedAt: null,
          })
          .where(eq(projectStakeholders.id, existingStakeholder[0].id));
        alreadyExistedDeleted = true;
      } else {
        await tx.insert(projectStakeholders).values({
          id: uuidv7(),
          projectId,
          clientId: co.clientId,
          role,
          visibilityProfile,
          canMessage: flags.canMessage,
          canUploadFiles: flags.canUploadFiles,
          canViewFinancials: flags.canViewFinancials,
          canViewDrawings: flags.canViewDrawings,
          canViewSchedule: flags.canViewSchedule,
          invitedBy: ctx.userId,
        });
      }

      // 3. Insert invitation row (kind='stakeholder' with project context).
      await tx.insert(invitations).values({
        id: invitationId,
        orgId: ctx.orgId,
        email,
        invitationType: 'stakeholder',
        projectId,
        stakeholderRole: role,
        visibilityProfile,
        token,
        expiresAt,
        invitedBy: ctx.userId,
      });

      // Decision 9.1B: auto-create org↔client general conversation when a new
      // client membership lands. Idempotent — no-op if a general conversation
      // for this (org, client) already exists.
      await autoCreateGeneralConversationTx(tx, {
        orgId: ctx.orgId,
        clientId: co.clientId,
        createdByUserId: ctx.userId,
      });

      // Session 11 §17: notify org members (informational — they don't need
      // an email walking them through accepting; the stakeholder gets their
      // own invitation email via sendEmail below). Recipients: org members
      // of caller's org. The stakeholder themselves is NOT a notification
      // recipient — the invitation email IS the notification for them.
      const orgMembers = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.orgId, ctx.orgId), isNull(users.deletedAt)));
      const dispatchPayload = {
        projectId,
        projectNumber: project.projectNumber,
        stakeholderName: name,
        stakeholderEmail: email,
        role,
        visibilityProfile,
        inviterName,
        invitationId,
        reinvited: alreadyExistedDeleted,
      };
      for (const u of orgMembers) {
        await dispatchNotification({
          tx,
          recipientType: 'user',
          recipientId: u.id,
          eventType: 'stakeholder.added_to_project',
          payload: dispatchPayload,
        });
      }

      return { clientId: co.clientId };
    });
    clientId = result.clientId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('STAKEHOLDER_ALREADY_INVITED')) {
      return { error: 'conflict', reason: 'already_invited' };
    }
    return { error: 'internal_error', reason: `invite_stakeholder_tx:${msg}` };
  }

  // Send email. Wrap in try/catch (Session 5 hotfix pattern).
  const acceptUrl = `${getAppUrl()}/invitations/${token}`;
  const { subject, html } = stakeholderInvitationEmail({
    inviterName,
    orgName,
    projectNumber: project.projectNumber,
    role,
    acceptUrl,
  });
  let deliveryFailed = false;
  try {
    await sendEmail({
      to: email,
      subject,
      html,
      orgId: ctx.orgId,
      template: 'stakeholder_invitation',
    });
  } catch (err) {
    deliveryFailed = true;
    Sentry.captureException(err, {
      tags: { action: 'inviteStakeholder', org_id: ctx.orgId, project_id: projectId },
      extra: { invitationId, recipient: email },
    });
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    clientId,
    action: 'invite_sent',
    resourceType: 'project_stakeholder',
    resourceId: invitationId,
    metadata: {
      email,
      role,
      visibility_profile: visibilityProfile,
      project_id: projectId,
      reinvited: alreadyExistedDeleted,
      delivery_failed: deliveryFailed,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');

  if (deliveryFailed) {
    return {
      success: true,
      data: { invitationId, clientId },
      deliveryWarning: 'email_send_failed',
    };
  }
  return { success: true, data: { invitationId, clientId } };
}

// ─── acceptStakeholderInvitation ─────────────────────────────────────────
const AcceptStakeholderInput = z.object({ token: z.string().min(1) });

// Magic-link acceptance. The auth user just signed in / signed up via the
// landing page → /accept route → this action. Atomic write inside a
// transaction:
//   1. Backfill clients.auth_user_id (or reject as hijack if already set
//      to a different user).
//   2. Mark project_stakeholders.accepted_at = now() for the (project, client)
//      pair pointed at by the invitation.
//   3. Mark invitations.accepted_at = now().
// Error vocabulary mirrors acceptInvitation (cancelled / already_accepted /
// expired / wrong-type / email_mismatch).
export async function acceptStakeholderInvitation(
  input: unknown,
): Promise<StakeholderActionResult<{ projectId: string }>> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = AcceptStakeholderInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'validation_error', reason: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { token } = parsed.data;

  const invRows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  const invitation = invRows[0];
  if (!invitation) return { error: 'not_found', reason: 'invalid' };
  if (invitation.deletedAt !== null) return { error: 'conflict', reason: 'cancelled' };
  if (invitation.acceptedAt !== null) return { error: 'conflict', reason: 'already_accepted' };
  if (invitation.expiresAt.getTime() < Date.now()) return { error: 'conflict', reason: 'expired' };
  if (invitation.invitationType !== 'stakeholder') {
    return { error: 'validation_error', reason: 'unsupported_invitation_type' };
  }
  if (!invitation.projectId) {
    return { error: 'internal_error', reason: 'invitation_missing_project_id' };
  }
  if (
    invitation.email.toLowerCase().trim() !==
    (authUser.email ?? '').toLowerCase().trim()
  ) {
    return { error: 'not_authorized', reason: 'email_mismatch' };
  }

  // Look up the client row by email (must exist — was created on invite).
  const clientRows = await db
    .select({ id: clients.id, authUserId: clients.authUserId })
    .from(clients)
    .where(and(eq(clients.email, invitation.email), isNull(clients.deletedAt)))
    .limit(1);
  const client = clientRows[0];
  if (!client) return { error: 'not_found', reason: 'client' };

  // Anti-hijack: if the client row is already linked to a different auth user,
  // refuse. The legitimate stakeholder for this email shouldn't be intercepted
  // by another signed-in user (e.g. someone with the link who happens to have
  // an auth account under a different email).
  if (client.authUserId !== null && client.authUserId !== authUser.id) {
    return { error: 'conflict', reason: 'client_already_linked' };
  }

  try {
    await db.transaction(async (tx) => {
      if (client.authUserId === null) {
        await tx
          .update(clients)
          .set({ authUserId: authUser.id })
          .where(eq(clients.id, client.id));
      }

      const updRes = await tx
        .update(projectStakeholders)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(projectStakeholders.projectId, invitation.projectId!),
            eq(projectStakeholders.clientId, client.id),
            isNull(projectStakeholders.deletedAt),
          ),
        )
        .returning({ id: projectStakeholders.id });
      if (updRes.length === 0) {
        throw new Error('STAKEHOLDER_ROW_MISSING');
      }

      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));

      // Decision 9.1A: auto-create the per-project one_to_one conversation now
      // that the stakeholder has accepted. Idempotent. createdBy is the org
      // user who originally invited (preserves the "X invited Sarah, X
      // initiated this thread" semantics; falls back to NULL if invitedBy is
      // somehow soft-deleted, since conversations.created_by is ON DELETE SET
      // NULL).
      await autoCreateOneToOneConversationTx(tx, {
        stakeholderClientId: client.id,
        projectId: invitation.projectId!,
        orgId: invitation.orgId,
        createdByUserId: invitation.invitedBy,
      });

      // Session 11 §17: defensive seed of notification preferences. The
      // stakeholder's clients row was created at invite-time via
      // findOrCreateClientTx which already seeds. This call is idempotent —
      // it covers the edge case where a clients row predates Session 11
      // (no prefs seeded yet) and the stakeholder accepts a fresh invitation.
      await seedNotificationDefaultsTx(tx, { clientId: client.id });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('STAKEHOLDER_ROW_MISSING')) {
      return { error: 'conflict', reason: 'stakeholder_row_missing' };
    }
    return { error: 'internal_error', reason: `accept_stakeholder_tx:${msg}` };
  }

  await logAudit({
    orgId: invitation.orgId,
    clientId: client.id,
    action: 'invite_accepted',
    resourceType: 'invitation',
    resourceId: invitation.id,
    metadata: {
      project_id: invitation.projectId,
      stakeholder_role: invitation.stakeholderRole,
    },
  });
  await logAudit({
    orgId: invitation.orgId,
    clientId: client.id,
    action: 'create',
    resourceType: 'project_stakeholder',
    metadata: { via_invitation: invitation.id, project_id: invitation.projectId },
  });

  return { success: true, data: { projectId: invitation.projectId } };
}

// ─── updateStakeholder ───────────────────────────────────────────────────
const UpdateStakeholderInput = z.object({
  stakeholderId: z.string().uuid(),
  role: z.enum(STAKEHOLDER_ROLES).optional(),
  visibilityProfile: z.enum(VISIBILITY_PROFILES).optional(),
  customFlags: CustomFlagsSchema.partial().optional(),
});

// Update a stakeholder's role + visibility settings. Per §14, individual flag
// changes without an explicit visibilityProfile arg auto-flip the profile to
// 'custom' (the preset is documentation, not a constraint).
export async function updateStakeholder(input: unknown): Promise<StakeholderActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdateStakeholderInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'validation_error', reason: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { stakeholderId, role, visibilityProfile, customFlags } = parsed.data;

  // Fetch + verify project's org matches caller (cross-org → not_found).
  const rows = await db
    .select({
      id: projectStakeholders.id,
      projectId: projectStakeholders.projectId,
      orgId: projects.orgId,
    })
    .from(projectStakeholders)
    .innerJoin(projects, eq(projects.id, projectStakeholders.projectId))
    .where(eq(projectStakeholders.id, stakeholderId))
    .limit(1);
  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'stakeholder' };
  }
  const target = rows[0];

  const updates: Record<string, unknown> = {};
  let profileFlippedToCustom = false;

  if (role !== undefined) updates.role = role;

  if (visibilityProfile !== undefined) {
    // Explicit preset → write all 5 flags + record the profile.
    let flagsToWrite: VisibilityFlags;
    if (visibilityProfile === 'custom') {
      if (!customFlags) {
        return { error: 'validation_error', reason: 'custom_requires_flags' };
      }
      // Enforce all 5 flags present for explicit custom mode.
      const filled = CustomFlagsSchema.safeParse(customFlags);
      if (!filled.success) {
        return { error: 'validation_error', reason: 'custom_flags_incomplete' };
      }
      flagsToWrite = filled.data;
    } else {
      flagsToWrite = applyVisibilityProfile(visibilityProfile as VisibilityProfile);
    }
    updates.visibilityProfile = visibilityProfile;
    updates.canMessage = flagsToWrite.canMessage;
    updates.canUploadFiles = flagsToWrite.canUploadFiles;
    updates.canViewFinancials = flagsToWrite.canViewFinancials;
    updates.canViewDrawings = flagsToWrite.canViewDrawings;
    updates.canViewSchedule = flagsToWrite.canViewSchedule;
  } else if (customFlags && Object.keys(customFlags).length > 0) {
    // Individual flag change without an explicit profile arg → flip to custom.
    if (customFlags.canMessage !== undefined) updates.canMessage = customFlags.canMessage;
    if (customFlags.canUploadFiles !== undefined) updates.canUploadFiles = customFlags.canUploadFiles;
    if (customFlags.canViewFinancials !== undefined)
      updates.canViewFinancials = customFlags.canViewFinancials;
    if (customFlags.canViewDrawings !== undefined) updates.canViewDrawings = customFlags.canViewDrawings;
    if (customFlags.canViewSchedule !== undefined) updates.canViewSchedule = customFlags.canViewSchedule;
    updates.visibilityProfile = 'custom';
    profileFlippedToCustom = true;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'validation_error', reason: 'no_fields_to_update' };
  }

  await db
    .update(projectStakeholders)
    .set(updates)
    .where(eq(projectStakeholders.id, stakeholderId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'project_stakeholder',
    resourceId: stakeholderId,
    metadata: {
      project_id: target.projectId,
      fields: Object.keys(updates),
      profile_flipped_to_custom: profileFlippedToCustom,
    },
  });

  // Cross-context cache invalidation: the stakeholder's portal view depends
  // on the same flags. Without invalidating /portal/projects/{id} the
  // stakeholder's reload would render stale conditional sections (caught by
  // browser QA step 9).
  revalidatePath(`/dashboard/projects/${target.projectId}`, 'layout');
  revalidatePath(`/portal/projects/${target.projectId}`, 'layout');

  return { success: true };
}

// ─── removeStakeholder ───────────────────────────────────────────────────
const RemoveStakeholderInput = z.object({ stakeholderId: z.string().uuid() });

export async function removeStakeholder(input: unknown): Promise<StakeholderActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = RemoveStakeholderInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'validation_error', reason: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { stakeholderId } = parsed.data;

  const rows = await db
    .select({
      id: projectStakeholders.id,
      projectId: projectStakeholders.projectId,
      deletedAt: projectStakeholders.deletedAt,
      orgId: projects.orgId,
      clientEmail: clients.email,
    })
    .from(projectStakeholders)
    .innerJoin(projects, eq(projects.id, projectStakeholders.projectId))
    .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .where(eq(projectStakeholders.id, stakeholderId))
    .limit(1);
  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'stakeholder' };
  }
  const target = rows[0];
  if (target.deletedAt !== null) {
    return { error: 'conflict', reason: 'already_removed' };
  }

  // Atomic soft-delete + cascade-cancel pending invitation. Cascade only fires
  // when the paired invitation's acceptedAt IS NULL (Design C — preserves
  // history for already-accepted invitations).
  const cancelledInvitationId = await db.transaction(async (tx) => {
    await tx
      .update(projectStakeholders)
      .set({ deletedAt: new Date() })
      .where(eq(projectStakeholders.id, stakeholderId));

    const pending = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.projectId, target.projectId),
          eq(invitations.email, target.clientEmail),
          eq(invitations.invitationType, 'stakeholder'),
          isNull(invitations.acceptedAt),
          isNull(invitations.deletedAt),
        ),
      )
      .limit(1);

    if (pending.length === 0) return null;

    await tx
      .update(invitations)
      .set({ deletedAt: new Date() })
      .where(eq(invitations.id, pending[0].id));

    return pending[0].id;
  });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'soft_delete',
    resourceType: 'project_stakeholder',
    resourceId: stakeholderId,
    metadata: { project_id: target.projectId },
  });

  if (cancelledInvitationId) {
    await logAudit({
      orgId: ctx.orgId,
      userId: ctx.userId,
      action: 'soft_delete',
      resourceType: 'invitation',
      resourceId: cancelledInvitationId,
      metadata: {
        reason: 'cascade_from_remove_stakeholder',
        stakeholder_id: stakeholderId,
      },
    });
  }

  revalidatePath(`/dashboard/projects/${target.projectId}`, 'layout');
  revalidatePath(`/portal/projects/${target.projectId}`, 'layout');

  return { success: true };
}
