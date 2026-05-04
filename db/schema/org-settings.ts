import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

// Per-org config (key/value) — RLS ENABLED. Soft-delete via deleted_at
// (deviation from spec §10.5 SQL — see plan §"Decisions overriding spec" #3).
export const orgSettings = pgTable(
  'org_settings',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Partial unique allows re-creating a key after soft-delete
    uniqueIndex('org_settings_org_key_active_uniq')
      .on(table.orgId, table.key)
      .where(sql`deleted_at IS NULL`),
    index('idx_org_settings_org').on(table.orgId).where(sql`deleted_at IS NULL`),
  ],
);
