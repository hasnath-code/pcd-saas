import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

// Lookup table for Resend webhook → org resolution. Written by lib/email/send.ts
// at send time; read by lib/webhooks/resend.ts to populate email_events.org_id
// when the webhook arrives. RLS DISABLED — system table, service role only.
export const outboundEmails = pgTable(
  'outbound_emails',
  {
    id: uuid('id').primaryKey(),
    messageId: text('message_id').notNull().unique(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    recipient: text('recipient').notNull(),
    template: text('template').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_outbound_emails_message').on(table.messageId)],
);
