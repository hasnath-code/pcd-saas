import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Phase 1c §12.6. One row per (recipient × channel × event) dispatch. The
// dispatcher (lib/notifications/dispatch.ts) inserts one row per enabled
// channel returned by the preferences lookup; deliverPending() drives email
// sends and stamps sent_at / delivered_at / failed_at on the row. Realtime
// publication wired in 0021 so in_app inserts auto-broadcast to subscribers
// of channel `notifications:<recipientId>` per ARCHITECTURE-saas.md §17 + §19.
//
// Duck-typed recipient: recipient_type + recipient_id together identify the
// owner. NO foreign key on recipient_id — the same column points at either
// public.users.id or public.clients.id depending on recipient_type. RLS
// resolves the correct identity table per the recipient_type discriminator.
//
// Per-command RLS in 0021: SELECT and UPDATE self-only (mark-read). INSERT
// and DELETE have no authenticated policy and are not GRANTed to the
// authenticated role — the dispatcher writes via the Drizzle pooler
// (postgres role, RLS bypassed).
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    recipientType: text('recipient_type').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    channel: text('channel').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'notifications_recipient_type_check',
      sql`recipient_type IN ('user', 'client')`,
    ),
    check(
      'notifications_channel_check',
      sql`channel IN ('email', 'in_app', 'push', 'sms')`,
    ),
    // Inbox query: list unread per recipient. Partial keeps the index lean.
    index('idx_notifications_recipient_unread')
      .on(table.recipientType, table.recipientId)
      .where(sql`read_at IS NULL`),
    // deliverPending() worker scan: find unsent rows per channel.
    index('idx_notifications_unsent')
      .on(table.channel)
      .where(sql`sent_at IS NULL`),
  ],
);
