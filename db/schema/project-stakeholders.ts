import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { projects } from './projects';
import { users } from './users';

// Per-project stakeholder link with five visibility flags. RLS ENABLED
// (Phase 1b §11.6). Org members of the project's org see all stakeholder rows;
// the stakeholder themselves sees their own row. Modify is org-member-only —
// stakeholders cannot edit their own visibility settings.
//
// UNIQUE (project_id, client_id) prevents duplicate stakeholder rows. Re-invite
// after removal goes through an UNDELETE path in inviteStakeholder rather than
// a fresh INSERT.
//
// SECURITY DEFINER helpers added in this same migration (auth_user_org_project_ids,
// auth_user_stakeholder_project_visibility) prevent recursion when the projects
// table's RLS — post-0012 — calls auth_user_stakeholder_projects() back into here.
export const projectStakeholders = pgTable(
  'project_stakeholders',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    visibilityProfile: text('visibility_profile').notNull(),
    canMessage: boolean('can_message').notNull().default(true),
    canUploadFiles: boolean('can_upload_files').notNull().default(true),
    canViewFinancials: boolean('can_view_financials').notNull().default(false),
    canViewDrawings: boolean('can_view_drawings').notNull().default(true),
    canViewSchedule: boolean('can_view_schedule').notNull().default(true),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'project_stakeholders_role_check',
      sql`role IN ('primary_client', 'collaborator', 'observer', 'billing_contact')`,
    ),
    check(
      'project_stakeholders_visibility_profile_check',
      sql`visibility_profile IN ('full', 'progress_only', 'documents_only', 'schedule_only', 'custom')`,
    ),
    unique('project_stakeholders_project_client_uniq').on(table.projectId, table.clientId),
    index('idx_project_stakeholders_project')
      .on(table.projectId)
      .where(sql`deleted_at IS NULL`),
    index('idx_project_stakeholders_client')
      .on(table.clientId)
      .where(sql`deleted_at IS NULL`),
  ],
);
