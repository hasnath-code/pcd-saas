import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { projects } from './projects';
import { users } from './users';

// Phase 1c §12.1. A messaging thread scoped to one org. Three flavors:
//   - 'one_to_one': stakeholder ↔ all active org members for one project
//   - 'group':      arbitrary participants within one project (org-driven)
//   - 'general':    org ↔ client without a specific project (project_id NULL)
//
// Soft-delete via deleted_at. Per-command RLS — see migration 0014. The
// stakeholder branch of the SELECT policy goes through
// auth_user_conversation_ids() (SECURITY DEFINER helper, stub in 0014,
// unstubbed in 0017) to break the conversations ↔ conversation_participants
// recursion.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'conversations_type_check',
      sql`type IN ('one_to_one', 'group', 'general')`,
    ),
    index('idx_conversations_project')
      .on(table.projectId)
      .where(sql`deleted_at IS NULL`),
    index('idx_conversations_org')
      .on(table.orgId)
      .where(sql`deleted_at IS NULL`),
  ],
);
