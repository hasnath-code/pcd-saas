import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';

// Phase 1c §12.7. Append-only project timeline. One row per significant
// event on a project (stage transition, file upload, milestone scheduled,
// stakeholder added, etc.). Activity rows are written by server actions
// inside the same transaction as the action they describe (Hard Rule 6)
// via lib/activity/log.ts.
//
// actor_type discriminates user / client / system. actor_id is nullable
// because system actors (cron, automated transitions) have no identity row.
// NO foreign key on actor_id — the same column points at either public.users.id
// or public.clients.id depending on actor_type. The action layer is the
// source of truth for the actor; the schema does not constrain consistency
// between actor_type and actor_id NULL-ness (matches spec §12.7 literal).
//
// visible_to_stakeholders gates whether the row appears in a stakeholder's
// timeline (the activity-side analogue of project_files.visibility). Defaults
// to true; the action layer sets it false for org-internal events
// (e.g. stakeholder.added_to_project).
//
// Per-command RLS in 0022: SELECT only — org members of the project's org
// always see; accepted stakeholders see only visible_to_stakeholders=true
// rows. INSERT/UPDATE/DELETE have no authenticated policy and are not
// GRANTed — server actions write via the Drizzle pooler.
//
// Activity rows are append-only in normal operation. No deleted_at — if
// a row is wrong, an admin-recovery hard DELETE via service role is the
// only path. The single index on (project_id, created_at DESC) supports
// the timeline scroll query.
export const projectActivity = pgTable(
  'project_activity',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    visibleToStakeholders: boolean('visible_to_stakeholders')
      .notNull()
      .default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'project_activity_actor_type_check',
      sql`actor_type IN ('user', 'client', 'system')`,
    ),
    index('idx_project_activity_project_created').on(
      table.projectId,
      sql`created_at DESC`,
    ),
  ],
);
