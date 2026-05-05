import 'server-only';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { invitations, organizations, users } from '@/db/schema';

export type PendingInvitation = {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date;
  invitedByName: string | null;
};

// Active = not accepted, not expired, not soft-deleted.
export async function listPendingInvitations(orgId: string): Promise<PendingInvitation[]> {
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      invitedByName: users.name,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(
      and(
        eq(invitations.orgId, orgId),
        isNull(invitations.acceptedAt),
        isNull(invitations.deletedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(invitations.createdAt));
  return rows;
}

export type InvitationWithOrg = {
  invitation: typeof invitations.$inferSelect;
  orgName: string;
  inviterName: string | null;
};

// Token-by-token lookup used on the public landing page. Includes the org
// name so the page can render "join <orgName> as <role>" without a second
// query. Returns null for non-existent tokens (404 mode at the page level).
export async function getInvitationByToken(token: string): Promise<InvitationWithOrg | null> {
  const rows = await db
    .select({
      invitation: invitations,
      orgName: organizations.name,
      inviterName: users.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(and(eq(invitations.token, token), isNull(invitations.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}
