import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { workflows, workflowStages } from './workflows';

// Project — the central domain entity. RLS ENABLED (Phase 1b §11.5).
// Visible to org members and accepted stakeholders. Soft-delete via deleted_at.
// project_number is unique per org (org A and org B can both have a "P-001").
// FK ON DELETE RESTRICT on org/workflow/stage/created_by — no orphans, no
// silent loss of project history. Stage transitions ship in Session 8.
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectNumber: text('project_number').notNull(),
    siteAddress: text('site_address').notNull(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    currentStageId: uuid('current_stage_id')
      .notNull()
      .references(() => workflowStages.id, { onDelete: 'restrict' }),
    scopeSummary: text('scope_summary'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('projects_org_project_number_uniq').on(table.orgId, table.projectNumber),
    index('idx_projects_org')
      .on(table.orgId)
      .where(sql`deleted_at IS NULL`),
    index('idx_projects_stage')
      .on(table.currentStageId)
      .where(sql`deleted_at IS NULL`),
  ],
);
