import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects';

// Per-project milestones. RLS ENABLED (Phase 1b §11.7). Org members of the
// project's org see all milestones; stakeholders see only milestones flagged
// visible_to_stakeholders=true on projects where their per-stakeholder
// can_view_schedule=true (gated via auth_user_stakeholder_project_visibility
// helper added in 0010). Soft-delete via deleted_at.
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    visibleToStakeholders: boolean('visible_to_stakeholders').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_project_milestones_project')
      .on(table.projectId)
      .where(sql`deleted_at IS NULL`),
  ],
);
