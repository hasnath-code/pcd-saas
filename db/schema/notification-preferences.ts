import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { users } from './users';

// Phase 1c §12.5. Per-identity × per-channel × per-event toggle for
// notification dispatch. Exactly one of user_id / client_id is set (XOR
// CHECK); the other is NULL. Postgres treats NULL as distinct in UNIQUE
// constraints, so the two UNIQUEs do not constrain each other.
//
// Defaults seeded by lib/notifications/seed-defaults.ts on identity creation
// (org owner via createOrganization, team member via acceptInvitation, client
// via findOrCreateClientTx / acceptStakeholderInvitation). Per §17: all in_app
// + email enabled, all push + sms disabled. No `deleted_at` — preferences
// CASCADE with the parent user/client.
//
// Per-command RLS in 0020: self-only on SELECT / INSERT / UPDATE / DELETE.
// Writes happen via the Drizzle pooler (postgres role, RLS bypassed) inside
// server actions; the policies guard against unauthorized REST writes.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, {
      onDelete: 'cascade',
    }),
    channel: text('channel').notNull(),
    eventType: text('event_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [
    unique('notification_preferences_user_channel_event_uniq').on(
      table.userId,
      table.channel,
      table.eventType,
    ),
    unique('notification_preferences_client_channel_event_uniq').on(
      table.clientId,
      table.channel,
      table.eventType,
    ),
    check(
      'notification_preferences_channel_check',
      sql`channel IN ('email', 'in_app', 'push', 'sms')`,
    ),
    check(
      'notification_preferences_owner_xor',
      sql`(user_id IS NOT NULL) <> (client_id IS NOT NULL)`,
    ),
  ],
);
