'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  AuthError,
  requireOrgAdmin,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { invitations, organizations, users } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { sendEmail } from '@/lib/email/send';
import { teamInvitationEmail } from '@/lib/email/templates/team-invitation';
import { env } from '@/env';

export type ServerActionResult =
  | { success: true }
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
  await sendEmail({ to: email, subject, html, orgId: ctx.orgId });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'invite_sent',
    resourceType: 'invitation',
    resourceId: invitationId,
    metadata: { email, role },
  });

  return { success: true };
}

// acceptInvitation lands in Task D.2 (with multi-org guard per Adjustment 2).
// removeUserFromOrg lands in Task E.
