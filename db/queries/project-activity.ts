import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { clients, projectActivity, users } from '@/db/schema';
import type { NotificationEventType } from '@/lib/notifications/events';

// Phase 1c §12.7 + Phase 9. Read-side query for the activity timeline.
//
// Server-side visibility filter
// =============================
// `db` is the Drizzle pooler client (postgres role) which BYPASSES RLS.
// That means the project_activity SELECT policy from migration 0022 doesn't
// apply to these queries — we must enforce the stakeholder-visibility gate
// explicitly when the caller is a stakeholder. The `visibleOnly` flag does
// exactly that: org-side callers pass false (org members see everything;
// they wouldn't pass the stakeholder filter anyway since they're not
// stakeholders), portal-side callers pass true. Defense-in-depth — even if
// a future refactor accidentally passes the wrong flag, the RLS policy
// from 0022 is still the canonical gate at the database boundary and
// would re-apply if the query were ever routed through the Supabase REST
// client (authenticated role).

export type ActivityRow = {
  id: string;
  projectId: string;
  actorType: 'user' | 'client' | 'system';
  actorId: string | null;
  actorDisplayName: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  visibleToStakeholders: boolean;
  createdAt: Date;
};

const DEFAULT_LIMIT = 50;

export async function listProjectActivity(opts: {
  projectId: string;
  /** When true, filter rows to visible_to_stakeholders=true. */
  visibleOnly: boolean;
  limit?: number;
}): Promise<ActivityRow[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const baseWhere = opts.visibleOnly
    ? and(
        eq(projectActivity.projectId, opts.projectId),
        eq(projectActivity.visibleToStakeholders, true),
      )
    : eq(projectActivity.projectId, opts.projectId);

  const rows = await db
    .select({
      id: projectActivity.id,
      projectId: projectActivity.projectId,
      actorType: projectActivity.actorType,
      actorId: projectActivity.actorId,
      eventType: projectActivity.eventType,
      payload: projectActivity.payload,
      visibleToStakeholders: projectActivity.visibleToStakeholders,
      createdAt: projectActivity.createdAt,
      userName: users.name,
      clientName: clients.name,
    })
    .from(projectActivity)
    .leftJoin(
      users,
      and(
        eq(users.id, projectActivity.actorId),
        eq(projectActivity.actorType, 'user'),
      ),
    )
    .leftJoin(
      clients,
      and(
        eq(clients.id, projectActivity.actorId),
        eq(projectActivity.actorType, 'client'),
      ),
    )
    .where(baseWhere)
    .orderBy(desc(projectActivity.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    actorType: r.actorType as ActivityRow['actorType'],
    actorId: r.actorId,
    actorDisplayName:
      r.actorType === 'user'
        ? r.userName ?? 'Team member'
        : r.actorType === 'client'
          ? r.clientName ?? 'Stakeholder'
          : 'System',
    eventType: r.eventType as NotificationEventType,
    payload: r.payload as Record<string, unknown>,
    visibleToStakeholders: r.visibleToStakeholders,
    createdAt: r.createdAt,
  }));
}
