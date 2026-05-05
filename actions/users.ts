'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, gt, isNull } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import {
  AuthError,
  requireAuth,
  requireOrgAdmin,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { invitations, organizations, users } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { sendEmail } from '@/lib/email/send';
import { teamInvitationEmail } from '@/lib/email/templates/team-invitation';
import { rateLimit } from '@/lib/ratelimit';
import { env } from '@/env';

export type ServerActionResult =
  | { success: true; deliveryWarning?: 'email_send_failed' }
  | { error: ServerActionErrorCode; reason?: string };

const InviteInput = z.object({
  email: z.string().email().toLowerCase().trim(),
  role: z.enum(['admin', 'member']),
});

export async function inviteTeamMember(input: unknown): Promise<ServerActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const { limited, retryAfterSec } = await rateLimit('invite', `org:${ctx.orgId}`);
  if (limited) return { error: 'rate_limited', reason: `retry_after_${retryAfterSec}s` };

  const parsed = InviteInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { email, role } = parsed.data;

  // Block if email already a member of this org
  const existingMember = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.orgId, ctx.orgId), eq(users.email, email), isNull(users.deletedAt)),
    )
    .limit(1);
  if (existingMember.length > 0) {
    return { error: 'conflict', reason: 'already_a_member' };
  }

  // Block if a non-expired non-accepted invitation already exists
  const existingInvite = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, ctx.orgId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.deletedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (existingInvite.length > 0) {
    return { error: 'conflict', reason: 'invitation_already_pending' };
  }

  const orgRows = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ctx.orgId))
    .limit(1);
  if (orgRows.length === 0) {
    return { error: 'not_found', reason: 'organization' };
  }
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

  await db.insert(invitations).values({
    id: invitationId,
    orgId: ctx.orgId,
    email,
    invitationType: 'team_member',
    role,
    token,
    expiresAt,
    invitedBy: ctx.userId,
  });

  const acceptUrl = `${env.NEXT_PUBLIC_APP_URL}/invitations/${token}`;
  const { subject, html } = teamInvitationEmail({
    inviterName,
    orgName,
    role,
    acceptUrl,
  });

  // sendEmail throws when Resend rejects the send (e.g. testing-mode domain
  // restriction in production before pcdportal.com is verified, or transient
  // 5xx from Resend). The invitation row is already in the DB — we don't
  // want a delivery failure to roll the user back to a 500 error boundary.
  // Capture to Sentry and continue; surface a delivery warning to the UI.
  let deliveryFailed = false;
  try {
    await sendEmail({
      to: email,
      subject,
      html,
      orgId: ctx.orgId,
      template: 'team_invitation',
    });
  } catch (err) {
    deliveryFailed = true;
    Sentry.captureException(err, {
      tags: { action: 'inviteTeamMember', org_id: ctx.orgId },
      extra: { invitationId, recipient: email },
    });
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'invite_sent',
    resourceType: 'invitation',
    resourceId: invitationId,
    metadata: { email, role, delivery_failed: deliveryFailed },
  });

  if (deliveryFailed) {
    return { success: true, deliveryWarning: 'email_send_failed' };
  }
  return { success: true };
}

const AcceptInput = z.object({
  token: z.string().min(1),
});

export async function acceptInvitation(input: unknown): Promise<ServerActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = AcceptInput.safeParse(input);
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
  if (!invitation) {
    return { error: 'not_found', reason: 'invalid' };
  }
  // Session 5: cancelled invitations (deletedAt set by cancelInvitation) get
  // a distinct error instead of conflating with not-found.
  if (invitation.deletedAt !== null) {
    return { error: 'conflict', reason: 'cancelled' };
  }
  if (invitation.acceptedAt !== null) {
    return { error: 'conflict', reason: 'already_accepted' };
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return { error: 'conflict', reason: 'expired' };
  }
  if (invitation.invitationType !== 'team_member') {
    return { error: 'validation_error', reason: 'unsupported_invitation_type' };
  }
  if (
    invitation.email.toLowerCase().trim() !==
    (authUser.email ?? '').toLowerCase().trim()
  ) {
    return { error: 'not_authorized', reason: 'email_mismatch' };
  }

  // Adjustment 2: multi-org membership is queued for Session 5. If this auth
  // user already belongs to another org, surface a clean error rather than
  // letting requireOrgUser crash later.
  const existingMemberships = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(and(eq(users.authUserId, authUser.id), isNull(users.deletedAt)));
  if (existingMemberships.length > 0) {
    return {
      error: 'multi_org_not_yet_supported',
      reason: 'You are already a member of another organization. Multi-org membership is coming in a future update.',
    };
  }

  if (
    invitation.role !== 'admin' &&
    invitation.role !== 'member' &&
    invitation.role !== 'owner'
  ) {
    return { error: 'validation_error', reason: 'invalid_role_on_invitation' };
  }

  const newUserId = uuidv7();
  const inviteeName = (authUser.email ?? '').split('@')[0] || 'New member';
  await db.insert(users).values({
    id: newUserId,
    authUserId: authUser.id,
    orgId: invitation.orgId,
    email: invitation.email,
    name: inviteeName,
    role: invitation.role,
  });

  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(invitations.id, invitation.id));

  await logAudit({
    orgId: invitation.orgId,
    userId: newUserId,
    action: 'invite_accepted',
    resourceType: 'invitation',
    resourceId: invitation.id,
    metadata: { role: invitation.role },
  });
  await logAudit({
    orgId: invitation.orgId,
    userId: newUserId,
    action: 'create',
    resourceType: 'user',
    resourceId: newUserId,
    metadata: { role: invitation.role, via_invitation: invitation.id },
  });

  return { success: true };
}

const RemoveUserInput = z.object({
  userId: z.string().uuid(),
});

export async function removeUserFromOrg(input: unknown): Promise<ServerActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = RemoveUserInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'validation_error', reason: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { userId } = parsed.data;

  const targetRows = await db
    .select({ id: users.id, orgId: users.orgId, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  const target = targetRows[0];
  if (!target) {
    return { error: 'not_found', reason: 'user' };
  }
  if (target.orgId !== ctx.orgId) {
    // Treat cross-org targets as not_found rather than not_authorized to
    // avoid leaking that the user exists in a different org.
    return { error: 'not_found', reason: 'user' };
  }

  // Hotfix: BLOCKER 2. Block self-removal regardless of role. Owners must
  // transfer ownership first (Phase 6 will ship the transfer flow); admins
  // and members should leave via a different flow (also Phase 6). The UI
  // hides the Remove kebab on the caller's own row; this is the server-side
  // backstop in case the UI is bypassed.
  if (target.id === ctx.userId) {
    return { error: 'not_authorized', reason: 'cannot_remove_self' };
  }

  if (target.role === 'owner') {
    const otherOwners = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.orgId, ctx.orgId),
          eq(users.role, 'owner'),
          isNull(users.deletedAt),
        ),
      );
    const remainingOwners = otherOwners.filter((u) => u.id !== target.id);
    if (remainingOwners.length === 0) {
      return {
        error: 'conflict',
        reason: 'last_owner_cannot_be_removed',
      };
    }
  }

  await db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(eq(users.id, target.id));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'soft_delete',
    resourceType: 'user',
    resourceId: target.id,
    metadata: { removed_role: target.role },
  });

  return { success: true };
}
