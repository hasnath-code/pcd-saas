import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Reference data — RLS DISABLED per ARCHITECTURE-saas.md §10.1.
// Two rows seeded: 'surveyor', 'architect'. CHECK constraint enforced in migration.
export const orgTypes = pgTable('org_types', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  defaultWorkflowSlug: text('default_workflow_slug').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
