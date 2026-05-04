import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { webhookEvents } from './webhook-events';

// Projection of Resend webhook events — RLS ENABLED for SELECT (admins-only).
// INSERT via service role from webhook ingestion path (Session 4).
// No deleted_at (append-only projection).
export const emailEvents = pgTable(
  'email_events',
  {
    id: uuid('id').primaryKey(),
    webhookEventId: uuid('webhook_event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    messageId: text('message_id').notNull(),
    recipient: text('recipient').notNull(),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_email_events_message').on(table.messageId),
    index('idx_email_events_org_recipient').on(table.orgId, table.recipient),
    check(
      'email_events_event_type_check',
      sql`event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed')`,
    ),
  ],
);
