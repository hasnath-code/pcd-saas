import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { orgTypes } from './org-types';
import { organizations } from './organizations';

// System-template + per-org workflow definitions. RLS ENABLED (Phase 1b §11.1).
// System templates have org_id = NULL and is_system_template = true; org workflows
// have org_id NOT NULL and is_system_template = false (enforced via CHECK).
// Soft-delete via deleted_at on org workflows; system templates are never deleted.
export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    orgTypeId: uuid('org_type_id').references(() => orgTypes.id, {
      onDelete: 'restrict',
    }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystemTemplate: boolean('is_system_template').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'workflows_template_org_check',
      sql`(is_system_template = true AND org_id IS NULL) OR (is_system_template = false AND org_id IS NOT NULL)`,
    ),
    index('idx_workflows_org')
      .on(table.orgId)
      .where(sql`deleted_at IS NULL`),
    index('idx_workflows_templates')
      .on(table.orgTypeId)
      .where(sql`is_system_template = true`),
    uniqueIndex('uq_workflows_system_slug')
      .on(table.slug)
      .where(sql`is_system_template = true`),
  ],
);

// Stages within a workflow. RLS ENABLED (Phase 1b §11.2).
// Position is 1-indexed and unique per workflow; gaps are allowed (no auto-reindex
// on stage delete). Slug is unique per workflow for stable references.
export const workflowStages = pgTable(
  'workflow_stages',
  {
    id: uuid('id').primaryKey(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    isTerminal: boolean('is_terminal').notNull().default(false),
    requiresAction: boolean('requires_action').notNull().default(false),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workflow_stages_workflow_slug_uniq').on(table.workflowId, table.slug),
    unique('workflow_stages_workflow_position_uniq').on(
      table.workflowId,
      table.position,
    ),
    index('idx_workflow_stages_workflow').on(table.workflowId),
  ],
);
