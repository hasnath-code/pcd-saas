import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

// Generic invitation primitive — RLS ENABLED. Soft-delete via deleted_at
// (deviation from spec §10.6 SQL — see plan §"Decisions overriding spec" #3).
// Used for team_member invites in 1a; stakeholder invites added in 1b.
// project_id is column-only (no FK constraint) until projects table exists in Phase 1b.
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    invitationType: text('invitation_type').notNull(),
    role: text('role'),
    // Stakeholder-invite fields (Phase 1b populates these):
    projectId: uuid('project_id'),
    stakeholderRole: text('stakeholder_role'),
    visibilityProfile: text('visibility_profile'),
    // Token & state:
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_invitations_token')
      .on(table.token)
      .where(sql`accepted_at IS NULL AND deleted_at IS NULL`),
    index('idx_invitations_email').on(table.email).where(sql`deleted_at IS NULL`),
    index('idx_invitations_org').on(table.orgId).where(sql`deleted_at IS NULL`),
    check('invitations_type_check', sql`invitation_type IN ('team_member', 'stakeholder')`),
  ],
);
