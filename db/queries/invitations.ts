import 'server-only';
import { and, asc, desc, eq, gt, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { emailEvents, invitations, organizations, users } from '@/db/schema';

// email_events.event_type CHECK values (see migration 0001).
export type EmailDeliveryEventType =
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'failed';

export type PendingInvitation = {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date;
  invitedByName: string | null;
  // Latest delivery event for this invitation's recipient over the last 7d,
  // scoped to this org. null when no event has been recorded (e.g. send is
  // pending or older than 7d). 'bounced' / 'complained' / 'failed' surface
  // as "Delivery failed" badge in the UI.
  latestDeliveryEventType: EmailDeliveryEventType | null;
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

  if (rows.length === 0) return [];

  // Look up the latest email event per recipient over the last 7d for this
  // org. Two-query approach (vs. window function) keeps the SQL trivial and
  // the rendering deterministic; the recipient list is bounded by the number
  // of pending invitations (small). Phase 1c may collapse with a lateral.
  const recipients = rows.map((r) => r.email);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await db
    .select({
      recipient: emailEvents.recipient,
      eventType: emailEvents.eventType,
      occurredAt: emailEvents.occurredAt,
    })
    .from(emailEvents)
    .where(
      and(
        eq(emailEvents.orgId, orgId),
        inArray(emailEvents.recipient, recipients),
        gte(emailEvents.occurredAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(emailEvents.occurredAt));

  // First seen wins because of DESC order on occurred_at.
  const latestByRecipient = new Map<string, EmailDeliveryEventType>();
  for (const ev of events) {
    if (!latestByRecipient.has(ev.recipient)) {
      latestByRecipient.set(ev.recipient, ev.eventType as EmailDeliveryEventType);
    }
  }

  return rows.map((r) => ({
    ...r,
    latestDeliveryEventType: latestByRecipient.get(r.email) ?? null,
  }));
}

export type InvitationWithOrg = {
  invitation: typeof invitations.$inferSelect;
  orgName: string;
  inviterName: string | null;
};

// Token-by-token lookup used on the public landing page. Includes the org
// name so the page can render "join <orgName> as <role>" without a second
// query. Returns null for non-existent tokens (404 mode at the page level).
//
// Session 5: no longer filters on `isNull(deletedAt)` so the landing page
// can distinguish "invitation cancelled" (deletedAt set) from "invitation
// not found" (no row). Callers must check `invitation.deletedAt !== null`
// themselves to surface the cancelled state.
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
    .where(eq(invitations.token, token))
    .limit(1);
  return rows[0] ?? null;
}
