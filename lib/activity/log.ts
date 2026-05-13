import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx } from '@/db';
import { projectActivity } from '@/db/schema';
import type { NotificationEventType } from '@/lib/notifications/events';

// Phase 1c §12.7 + §17 + Hard Rule 6: append-only project timeline write.
// Server actions call this inside their own Drizzle transaction so the
// activity row is atomic with the domain mutation it describes — if the
// dispatcher or any other tx member throws, no orphan activity row.
//
// visible_to_stakeholders gating policy (Session 11 plan §F + §G defaults):
//   - project.stage_changed         → true (all stage moves are part of the
//                                     stakeholder-visible project narrative)
//   - file.uploaded                 → only when visibility='org_and_stakeholders';
//                                     org_only files never surface to stakeholders
//                                     via project_files RLS, so the activity row
//                                     mirrors the visibility flag for consistency.
//   - milestone.scheduled           → milestone.visibleToStakeholders (the
//                                     milestone itself carries the gate; the
//                                     activity row inherits it.)
//   - stakeholder.added_to_project  → false (org-internal; stakeholders don't
//                                     need to see other stakeholders being added.
//                                     If they later want to see "X joined", we
//                                     extend the policy.)
//   - message.new                   → NOT LOGGED (per ADR-027 spirit + Session 11
//                                     plan: project_activity is for non-message
//                                     events; conversations carry their own
//                                     audit via the messages table).
//
// The caller decides visible_to_stakeholders and passes it in — this helper
// does not infer. Keeps the policy visible at the action site.

export interface LogActivityOpts {
  projectId: string;
  actorType: 'user' | 'client' | 'system';
  /** Required for actorType='user'|'client'; null/undefined for 'system'. */
  actorId?: string | null;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  visibleToStakeholders: boolean;
}

export async function logActivityTx(
  tx: DbOrTx,
  opts: LogActivityOpts,
): Promise<{ activityId: string }> {
  const activityId = uuidv7();
  await tx.insert(projectActivity).values({
    id: activityId,
    projectId: opts.projectId,
    actorType: opts.actorType,
    actorId: opts.actorId ?? null,
    eventType: opts.eventType,
    payload: opts.payload,
    visibleToStakeholders: opts.visibleToStakeholders,
  });
  return { activityId };
}
