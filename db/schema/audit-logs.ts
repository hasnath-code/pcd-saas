import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

// Append-only audit trail — RLS ENABLED for SELECT (admins-only); INSERT via service role.
// No deleted_at (spec §22 — append-only).
// client_id is column-only until clients table ships in Phase 1b.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    clientId: uuid('client_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_org_created').on(table.orgId, table.createdAt.desc()),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
  ],
);
