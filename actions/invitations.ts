'use server';

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireOrgAdmin,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { invitations } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';

export type ServerActionResult =
  | { success: true }
  | { error: ServerActionErrorCode; reason?: string };

const CancelInput = z.object({
  invitationId: z.string().uuid(),
});

// Cancel a pending invitation. Soft-deletes the invitations row (deleted_at
// = now()) so the magic link returns the cancelled-state error rather than
// the generic not-found one. Owner/admin only. Cross-org targets surface as
// not_found per [actions/users.ts:264] precedent.
export async function cancelInvitation(input: unknown): Promise<ServerActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CancelInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { invitationId } = parsed.data;

  const rows = await db
    .select({
      id: invitations.id,
      orgId: invitations.orgId,
      email: invitations.email,
      acceptedAt: invitations.acceptedAt,
      deletedAt: invitations.deletedAt,
    })
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1);
  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'invitation' };
  }
  const invitation = rows[0];
  if (invitation.acceptedAt !== null) {
    return { error: 'conflict', reason: 'already_accepted' };
  }
  if (invitation.deletedAt !== null) {
    return { error: 'conflict', reason: 'already_cancelled' };
  }

  await db
    .update(invitations)
    .set({ deletedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.orgId, ctx.orgId)));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'soft_delete',
    resourceType: 'invitation',
    resourceId: invitationId,
    metadata: { reason: 'cancelled_by_admin', email: invitation.email },
  });

  revalidatePath('/settings/team');

  return { success: true };
}
