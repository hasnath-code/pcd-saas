'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireOrgAdmin,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clientOrgMemberships,
  projectStakeholders,
  projects,
  users,
  workflows,
  workflowStages,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { VISIBILITY_PROFILES } from '@/lib/visibility-profiles';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import { logActivityTx } from '@/lib/activity/log';

export type ProjectActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

const CreateProjectInput = z.object({
  projectNumber: z
    .string()
    .trim()
    .min(1, 'Project number is required')
    .max(40, 'Project number is too long'),
  siteAddress: z.string().trim().min(1, 'Site address is required').max(500),
  workflowId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  scopeSummary: z.string().trim().max(2000).optional(),
});

// Create a project in the caller's org. Verifies the workflow and client (if
// provided) both belong to the caller's org. Resolves currentStageId to the
// stage with position=1 of the chosen workflow (rejects if the workflow has
// no stages — would only happen for a malformed clone). System templates
// can't be assigned to projects per ARCHITECTURE §13.
export async function createProject(
  input: unknown,
): Promise<ProjectActionResult<{ projectId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateProjectInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectNumber, siteAddress, workflowId, clientId, scopeSummary } =
    parsed.data;

  const workflowRows = await db
    .select({
      id: workflows.id,
      orgId: workflows.orgId,
      isSystemTemplate: workflows.isSystemTemplate,
    })
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), isNull(workflows.deletedAt)))
    .limit(1);
  if (workflowRows.length === 0) {
    return { error: 'not_found', reason: 'workflow' };
  }
  const workflow = workflowRows[0];
  if (workflow.isSystemTemplate || workflow.orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'workflow' };
  }

  // First stage = position 1 of this workflow.
  const stageRows = await db
    .select({ id: workflowStages.id })
    .from(workflowStages)
    .where(eq(workflowStages.workflowId, workflowId))
    .orderBy(asc(workflowStages.position))
    .limit(1);
  if (stageRows.length === 0) {
    return { error: 'internal_error', reason: 'workflow_has_no_stages' };
  }
  const firstStageId = stageRows[0].id;

  if (clientId) {
    const linkRows = await db
      .select({ id: clientOrgMemberships.id })
      .from(clientOrgMemberships)
      .where(
        and(
          eq(clientOrgMemberships.clientId, clientId),
          eq(clientOrgMemberships.orgId, ctx.orgId),
        ),
      )
      .limit(1);
    if (linkRows.length === 0) {
      return { error: 'not_found', reason: 'client' };
    }
  }

  // Pre-check the (org_id, project_number) UNIQUE constraint to surface a
  // friendly conflict before letting the INSERT raise a 23505. Cheaper +
  // more readable than parsing pg error messages.
  const dup = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.orgId, ctx.orgId),
        eq(projects.projectNumber, projectNumber),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    return { error: 'conflict', reason: 'project_number_taken' };
  }

  const projectId = uuidv7();

  // When clientId is supplied we additionally insert a project_stakeholders
  // row with role='primary_client' (visibility_profile='full', accepted_at=now()
  // since the org user is implicitly opting the client into the project).
  // The pair lives in one transaction so a duplicate-project race aborts
  // both rows together. The Client column on /dashboard/projects reads from
  // this row going forward (see Session 6 plan decision #5). Legacy Session 5
  // projects without a stakeholder row show "—" in the column.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        orgId: ctx.orgId,
        projectNumber,
        siteAddress,
        workflowId,
        currentStageId: firstStageId,
        scopeSummary,
        createdBy: ctx.userId,
      });

      if (clientId) {
        const fullFlags = VISIBILITY_PROFILES.full;
        await tx.insert(projectStakeholders).values({
          id: uuidv7(),
          projectId,
          clientId,
          role: 'primary_client',
          visibilityProfile: 'full',
          canMessage: fullFlags.canMessage,
          canUploadFiles: fullFlags.canUploadFiles,
          canViewFinancials: fullFlags.canViewFinancials,
          canViewDrawings: fullFlags.canViewDrawings,
          canViewSchedule: fullFlags.canViewSchedule,
          invitedBy: ctx.userId,
          acceptedAt: new Date(),
        });
      }
    });
  } catch (e) {
    // Race-condition fallback: if two concurrent createProject calls slip
    // past the pre-check, the second hits the UNIQUE violation here.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('projects_org_project_number_uniq') || msg.includes('23505')) {
      return { error: 'conflict', reason: 'project_number_taken' };
    }
    return { error: 'internal_error', reason: `project_insert:${msg}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'project',
    resourceId: projectId,
    metadata: { projectNumber, workflowId, clientId },
  });

  revalidatePath('/dashboard/projects');

  return { success: true, data: { projectId } };
}

const UpdateProjectInput = z.object({
  projectId: z.string().uuid(),
  siteAddress: z.string().trim().min(1).max(500).optional(),
  scopeSummary: z.string().trim().max(2000).nullable().optional(),
});

// Update mutable project fields. project_number, workflow_id, current_stage_id
// and client_id are NOT mutable here — stage transitions ship in Session 8;
// reassigning workflow or client is a deliberate later-session feature.
export async function updateProject(
  input: unknown,
): Promise<ProjectActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdateProjectInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, ...patch } = parsed.data;

  const found = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (found.length === 0 || found[0].orgId !== ctx.orgId) {
    // Cross-org targets surface as not_found to avoid leaking existence.
    return { error: 'not_found', reason: 'project' };
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return { error: 'validation_error', reason: 'no_fields_to_update' };
  }

  await db.update(projects).set(updates).where(eq(projects.id, projectId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'project',
    resourceId: projectId,
    metadata: { fields: Object.keys(updates) },
  });

  revalidatePath('/dashboard/projects');
  revalidatePath(`/dashboard/projects/${projectId}`);

  return { success: true };
}

const ProjectIdInput = z.object({
  projectId: z.string().uuid(),
});

// Admin-only soft delete. Cross-org targets surface as not_found.
export async function softDeleteProject(
  input: unknown,
): Promise<ProjectActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = ProjectIdInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId } = parsed.data;

  const found = await db
    .select({ id: projects.id, orgId: projects.orgId, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (found.length === 0 || found[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }
  if (found[0].deletedAt !== null) {
    return { error: 'conflict', reason: 'already_deleted' };
  }

  await db
    .update(projects)
    .set({ deletedAt: new Date() })
    .where(eq(projects.id, projectId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'soft_delete',
    resourceType: 'project',
    resourceId: projectId,
  });

  revalidatePath('/dashboard/projects');
  revalidatePath(`/dashboard/projects/${projectId}`);

  return { success: true };
}

const MoveProjectToStageInput = z.object({
  projectId: z.string().uuid(),
  toStageId: z.string().uuid(),
});

// Move a project to a different stage of its workflow. Forward and backward
// transitions are both allowed (mistakes happen — the UI surfaces a
// confirmation for backward moves but the server doesn't block).
//
// Single-row UPDATE; no transaction required because the audit log is fired
// after the row commits and lives in a separate table that doesn't roll back
// with the project update — by design, audit gaps surface in Sentry rather
// than blocking the user-facing mutation.
//
// Audit metadata schema is locked for forward-compatibility with the Phase 1c
// notification dispatch (see ARCHITECTURE-saas.md §12.7 + Session 8 plan
// Hard Rule 8): from_stage_id/name/position, to_stage_id/name/position,
// workflow_id, is_backward_transition, is_terminal_destination.
//
// Cross-workflow stage targets are rejected (validation_error) — the target
// stage must belong to the project's current workflow. Cross-org projects
// surface as not_found.
export async function moveProjectToStage(
  input: unknown,
): Promise<
  ProjectActionResult<{
    isBackwardTransition: boolean;
    isTerminalDestination: boolean;
  }>
> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = MoveProjectToStageInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, toStageId } = parsed.data;

  const projectRows = await db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      workflowId: projects.workflowId,
      currentStageId: projects.currentStageId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRows.length === 0 || projectRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }
  const project = projectRows[0];

  // No-op if the user picked the current stage. Surface as validation_error
  // so the UI can hide the menu item or react accordingly; cheaper than
  // logging a no-op audit row.
  if (project.currentStageId === toStageId) {
    return { error: 'validation_error', reason: 'already_on_stage' };
  }

  // Fetch both stages with their position/terminal/workflow_id in one query.
  // If toStageId doesn't exist or doesn't belong to the project's workflow,
  // we return validation_error.
  const stageRows = await db
    .select({
      id: workflowStages.id,
      workflowId: workflowStages.workflowId,
      name: workflowStages.name,
      position: workflowStages.position,
      isTerminal: workflowStages.isTerminal,
    })
    .from(workflowStages)
    .where(
      and(
        eq(workflowStages.workflowId, project.workflowId),
        // toStageId OR currentStageId — fetched together
      ),
    );
  const fromStage = stageRows.find((s) => s.id === project.currentStageId);
  const toStage = stageRows.find((s) => s.id === toStageId);
  if (!fromStage) {
    // Shouldn't happen — projects.current_stage_id FK guarantees it. Defensive.
    return { error: 'internal_error', reason: 'current_stage_missing' };
  }
  if (!toStage) {
    return { error: 'validation_error', reason: 'stage_not_in_project_workflow' };
  }

  const isBackwardTransition = toStage.position < fromStage.position;
  const isTerminalDestination = toStage.isTerminal === true;

  // ADR-019 9-field locked metadata. Reused as the dispatcher payload below
  // so the notification email + activity log + audit row all see the same
  // shape — no extra DB lookups inside the dispatcher.
  const stageChangeMetadata = {
    from_stage_id: fromStage.id,
    from_stage_name: fromStage.name,
    from_stage_position: fromStage.position,
    to_stage_id: toStage.id,
    to_stage_name: toStage.name,
    to_stage_position: toStage.position,
    workflow_id: project.workflowId,
    is_backward_transition: isBackwardTransition,
    is_terminal_destination: isTerminalDestination,
  };

  // Look up project_number for the payload (subjects.ts uses it as the
  // human-friendly label). Cheap — single-row read.
  const [projectMeta] = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const projectNumber = projectMeta?.projectNumber ?? '';

  try {
    await db.transaction(async (tx) => {
      // 1. Domain write: advance current_stage_id.
      await tx
        .update(projects)
        .set({ currentStageId: toStageId })
        .where(eq(projects.id, projectId));

      // 1a. Activity row — stakeholders always see stage transitions per
      //     the kickoff default (project.stage_changed → visible=true).
      await logActivityTx(tx, {
        projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'project.stage_changed',
        payload: {
          projectId,
          projectNumber,
          ...stageChangeMetadata,
          fromStageName: fromStage.name,
          toStageName: toStage.name,
        },
        visibleToStakeholders: true,
      });

      // 2. Fan out project.stage_changed to all org members + all accepted,
      //    non-deleted stakeholders on this project. Visibility profile
      //    flags don't gate dispatch (per §14: visibility gates SELECT;
      //    prefs gate channel). The 9-field metadata becomes the payload.
      const orgMembers = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.orgId, ctx.orgId), isNull(users.deletedAt)));
      const stakeholders = await tx
        .select({ clientId: projectStakeholders.clientId })
        .from(projectStakeholders)
        .where(
          and(
            eq(projectStakeholders.projectId, projectId),
            isNotNull(projectStakeholders.acceptedAt),
            isNull(projectStakeholders.deletedAt),
          ),
        );

      const payload = {
        projectId,
        projectNumber,
        ...stageChangeMetadata,
        // Friendlier aliases used by subjects.ts content builder.
        fromStageName: fromStage.name,
        toStageName: toStage.name,
      };

      for (const u of orgMembers) {
        await dispatchNotification({
          tx,
          recipientType: 'user',
          recipientId: u.id,
          eventType: 'project.stage_changed',
          payload,
        });
      }
      for (const s of stakeholders) {
        await dispatchNotification({
          tx,
          recipientType: 'client',
          recipientId: s.clientId,
          eventType: 'project.stage_changed',
          payload,
        });
      }
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `move_project_to_stage:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'stage_changed',
    resourceType: 'project',
    resourceId: projectId,
    metadata: stageChangeMetadata,
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');
  revalidatePath(`/portal/projects/${projectId}`, 'layout');

  return {
    success: true,
    data: { isBackwardTransition, isTerminalDestination },
  };
}

// Admin-only restore.
export async function restoreProject(
  input: unknown,
): Promise<ProjectActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = ProjectIdInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId } = parsed.data;

  const found = await db
    .select({ id: projects.id, orgId: projects.orgId, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (found.length === 0 || found[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }
  if (found[0].deletedAt === null) {
    return { error: 'conflict', reason: 'not_deleted' };
  }

  await db
    .update(projects)
    .set({ deletedAt: null })
    .where(eq(projects.id, projectId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'restore',
    resourceType: 'project',
    resourceId: projectId,
  });

  revalidatePath('/dashboard/projects');
  revalidatePath(`/dashboard/projects/${projectId}`);

  return { success: true };
}
