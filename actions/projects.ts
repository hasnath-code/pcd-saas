'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, asc, eq, isNull } from 'drizzle-orm';
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
  workflows,
  workflowStages,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { VISIBILITY_PROFILES } from '@/lib/visibility-profiles';

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
