import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/db';
import { emailEvents, webhookEvents } from '@/db/schema';

// Phase 1a stub. Logs the email body to the console and writes a `sent`
// projection row to email_events so the audit trail is honest. email_events
// has a NOT NULL FK to webhook_events; in Phase 1a we don't have a Resend
// webhook to hang it off, so we insert a stub webhook_events row first
// (source='resend', signature_verified=false, payload={ stub: true }).
//
// TODO(Session 4): replace this stub webhook_events insert with real Resend
// webhook ingestion. Stub rows can be identified by payload->>'stub' = 'true'.
export type SendEmailOpts = {
  to: string;
  subject: string;
  html: string;
  orgId?: string;
  messageId?: string;
};

export type SendEmailResult = { messageId: string; emailEventId: string };

export async function sendEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  const messageId = opts.messageId ?? uuidv7();
  const webhookEventId = uuidv7();
  const emailEventId = uuidv7();

  console.log(
    `[email stub] to=${opts.to} subject="${opts.subject}" messageId=${messageId}`,
  );
  if (process.env.EMAIL_STUB_VERBOSE === '1') {
    console.log('[email stub] body:\n' + opts.html);
  }

  await db.insert(webhookEvents).values({
    id: webhookEventId,
    source: 'resend',
    eventType: 'email.sent',
    externalEventId: messageId,
    payload: { stub: true, to: opts.to, subject: opts.subject },
    signatureVerified: false,
    processedAt: new Date(),
  });

  await db.insert(emailEvents).values({
    id: emailEventId,
    webhookEventId,
    orgId: opts.orgId,
    messageId,
    recipient: opts.to,
    eventType: 'sent',
    metadata: { subject: opts.subject, stub: true },
    occurredAt: new Date(),
  });

  return { messageId, emailEventId };
}
