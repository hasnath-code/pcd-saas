import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

// Org member — RLS ENABLED. Soft-delete via deleted_at.
// auth_user_id has FK to auth.users(id) ON DELETE RESTRICT — declared in migration 0001
// (Drizzle doesn't reference cross-schema tables cleanly).
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    authUserId: uuid('auth_user_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('users_auth_user_org_uniq').on(table.authUserId, table.orgId),
    index('idx_users_auth_user').on(table.authUserId).where(sql`deleted_at IS NULL`),
    index('idx_users_org').on(table.orgId).where(sql`deleted_at IS NULL`),
    check('users_role_check', sql`role IN ('owner', 'admin', 'member')`),
  ],
);
