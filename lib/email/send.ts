import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import { Resend } from 'resend';
import { db } from '@/db';
import { outboundEmails } from '@/db/schema';
import { env } from '@/env';
import { getFromAddress } from './from';

export type SendEmailOpts = {
  to: string;
  subject: string;
  html: string;
  orgId?: string;
  // Free-form label persisted to outbound_emails.template. Used for
  // categorization in the bounce-surfacing UI and future per-template
  // analytics. Defaults to 'unknown' for callers that don't pass one.
  template?: string;
};

// `emailEventId` is intentionally null. With the stub, this function wrote a
// fake email_events row at send time so callers got back a populated id. With
// real Resend, the 'sent' email_events row arrives via the webhook callback —
// nothing to return synchronously. Callers that care about delivery state
// must query email_events by message_id (the stable join key).
export type SendEmailResult = { messageId: string; emailEventId: null };

const resend = new Resend(env.RESEND_API_KEY);

export async function sendEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  const result = await resend.emails.send({
    from: getFromAddress(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    // Tags are best-effort echoed back by Resend webhook payloads. We don't
    // rely on them — outbound_emails is the deterministic lookup — but they
    // help in the Resend dashboard's filtering.
    tags: opts.orgId ? [{ name: 'org_id', value: opts.orgId }] : [],
  });

  if (result.error || !result.data?.id) {
    throw new Error(
      `resend.emails.send failed: ${result.error?.message ?? 'no message id returned'}`,
    );
  }
  const messageId = result.data.id;

  await db.insert(outboundEmails).values({
    id: uuidv7(),
    messageId,
    orgId: opts.orgId,
    recipient: opts.to,
    template: opts.template ?? 'unknown',
  });

  return { messageId, emailEventId: null };
}
