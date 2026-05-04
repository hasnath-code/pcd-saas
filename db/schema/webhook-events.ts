import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// Generic inbound webhook log + idempotency — RLS DISABLED (system table, service-role only).
// No deleted_at (append-only system table).
// (source, external_event_id) UNIQUE = idempotency key.
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey(),
    source: text('source').notNull(),
    eventType: text('event_type').notNull(),
    externalEventId: text('external_event_id').notNull(),
    payload: jsonb('payload').notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('webhook_events_source_external_uniq').on(table.source, table.externalEventId),
    index('idx_webhook_events_source_created').on(table.source, table.createdAt.desc()),
    index('idx_webhook_events_unprocessed').on(table.source).where(sql`processed_at IS NULL`),
    check('webhook_events_source_check', sql`source IN ('resend', 'stripe', 'twilio')`),
  ],
);
