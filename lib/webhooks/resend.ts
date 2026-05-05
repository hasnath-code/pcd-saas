import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { emailEvents, outboundEmails } from '@/db/schema';

// Resend event types → email_events.event_type CHECK constraint values
// (see migration 0001 line ~25). Unknown event types are silently ignored:
// we record the webhook envelope but don't project a row.
const RESEND_TO_EMAIL_EVENT: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'failed',
};

// Returns the resolved org_id (or null if unresolvable) so the route handler
// can tag the Sentry context.
export async function processResendEvent(
  webhookEventId: string,
  payload: unknown,
): Promise<string | null> {
  const p = payload as { type?: string; data?: { email_id?: string; to?: unknown }; created_at?: string };
  const eventType = p?.type ? RESEND_TO_EMAIL_EVENT[p.type] : undefined;
  if (!eventType) {
    // Unknown event type — webhook_events row is recorded; no projection.
    return null;
  }

  const messageId = p?.data?.email_id;
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new Error(`Resend payload missing data.email_id: ${p?.type}`);
  }

  // Resolve org_id via outbound_emails lookup (set at send time by lib/email/send.ts).
  const lookup = await db
    .select({ orgId: outboundEmails.orgId })
    .from(outboundEmails)
    .where(eq(outboundEmails.messageId, messageId))
    .limit(1);
  const orgId = lookup[0]?.orgId ?? null;

  // payload.data.to is an array of recipients; use the first (we send to a
  // single recipient per email in Phase 1a).
  const to = p?.data?.to;
  const recipient = Array.isArray(to)
    ? typeof to[0] === 'string'
      ? (to[0] as string)
      : ''
    : typeof to === 'string'
      ? to
      : '';

  const occurredAt = p?.created_at ? new Date(p.created_at) : new Date();

  await db.insert(emailEvents).values({
    id: uuidv7(),
    webhookEventId,
    orgId: orgId ?? undefined,
    messageId,
    recipient,
    eventType,
    metadata: { resendPayload: payload },
    occurredAt,
  });

  return orgId;
}
