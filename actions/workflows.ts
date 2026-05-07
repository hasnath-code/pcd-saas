'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireOrgAdmin,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { projects, workflows, workflowStages } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import {
  getWorkflowWithStages,
  type WorkflowDetail,
} from '@/db/queries/workflows';
import {
  AddWorkflowStageInput,
  CreateWorkflowInput,
  DeleteWorkflowInput,
  RemoveWorkflowStageInput,
  UpdateWorkflowInput,
  slugifyStageName,
  stageValidationReason,
  validateStageDraft,
} from '@/lib/workflow-validation';

export type WorkflowActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

// Internal helper: parse via Zod, return either the data or a validation_error
// envelope shaped like the standard discriminated union.
function parseInput<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message?: string }> } } },
  input: unknown,
): { ok: true; data: T } | { ok: false; result: WorkflowActionResult<never> } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      result: {
        error: 'validation_error',
        reason: parsed.error.issues[0]?.message ?? 'Invalid input',
      } as WorkflowActionResult<never>,
    };
  }
  return { ok: true, data: parsed.data };
}

// Owner/admin only; cross-org → not_authorized via requireOrgAdmin. The action
// validates the stage draft (unique names/slugs, sequential positions, ≥1
// terminal) before opening a transaction, so DB rollback only fires on
// genuinely unexpected conditions.
//
// On success, returns the new workflow id. The audit log captures the slug,
// stage count, and whether the draft included a terminal — useful when
// triaging botched seeds.
export async function createWorkflow(
  input: unknown,
): Promise<WorkflowActionResult<{ workflowId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = parseInput(CreateWorkflowInput, input);
  if (!parsed.ok) return parsed.result;
  const { name, description, stages } = parsed.data;

  const failure = validateStageDraft(stages);
  if (failure) {
    return { error: 'validation_error', reason: stageValidationReason(failure) };
  }

  const workflowId = uuidv7();
  const workflowSlug = slugifyStageName(name) || 'workflow';

  try {
    await db.transaction(async (tx) => {
      await tx.insert(workflows).values({
        id: workflowId,
        orgId: ctx.orgId,
        slug: workflowSlug,
        name,
        description: description ?? null,
        isSystemTemplate: false,
        isDefault: false,
      });

      await tx.insert(workflowStages).values(
        stages.map((s) => ({
          id: uuidv7(),
          workflowId,
          slug: slugifyStageName(s.name),
          name: s.name,
          position: s.position,
          isTerminal: s.isTerminal,
          requiresAction: false,
          color: s.color ?? null,
        })),
      );
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `workflow_insert:${msg}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'workflow',
    resourceId: workflowId,
    metadata: {
      slug: workflowSlug,
      stage_count: stages.length,
      has_terminal: stages.some((s) => s.isTerminal),
    },
  });

  revalidatePath('/settings/workflows');

  return { success: true, data: { workflowId } };
}

// Edit name/description on an org workflow. System templates are never
// editable by org users (returns not_authorized). Cross-org targets surface
// as not_found so we don't leak existence.
export async function updateWorkflow(input: unknown): Promise<WorkflowActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = parseInput(UpdateWorkflowInput, input);
  if (!parsed.ok) return parsed.result;
  const { workflowId, ...patch } = parsed.data;

  const found = await db
    .select({
      id: workflows.id,
      orgId: workflows.orgId,
      isSystemTemplate: workflows.isSystemTemplate,
    })
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), isNull(workflows.deletedAt)))
    .limit(1);
  if (found.length === 0) {
    return { error: 'not_found', reason: 'workflow' };
  }
  // System templates are visible to every org (org_id IS NULL) so leak isn't
  // a concern — return the precise reason. Check this BEFORE the org-match
  // so the org_id null comparison doesn't shadow it.
  if (found[0].isSystemTemplate) {
    return { error: 'not_authorized', reason: 'system_template' };
  }
  if (found[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'workflow' };
  }

  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (Object.keys(updates).length === 0) {
    return { error: 'validation_error', reason: 'no_fields_to_update' };
  }

  await db.update(workflows).set(updates).where(eq(workflows.id, workflowId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'workflow',
    resourceId: workflowId,
    metadata: { fields: Object.keys(updates) },
  });

  revalidatePath('/settings/workflows');

  return { success: true };
}

// Append a stage to a workflow. Position must be free (UNIQUE
// (workflow_id, position) at the DB layer; we pre-check for a friendly error).
// System templates are immutable from this action. Cross-org → not_found.
export async function addWorkflowStage(
  input: unknown,
): Promise<WorkflowActionResult<{ stageId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = parseInput(AddWorkflowStageInput, input);
  if (!parsed.ok) return parsed.result;
  const { workflowId, name, position, isTerminal, color } = parsed.data;

  const found = await db
    .select({
      id: workflows.id,
      orgId: workflows.orgId,
      isSystemTemplate: workflows.isSystemTemplate,
    })
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), isNull(workflows.deletedAt)))
    .limit(1);
  if (found.length === 0) {
    return { error: 'not_found', reason: 'workflow' };
  }
  if (found[0].isSystemTemplate) {
    return { error: 'not_authorized', reason: 'system_template' };
  }
  if (found[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'workflow' };
  }

  const slug = slugifyStageName(name);
  if (slug.length === 0) {
    return { error: 'validation_error', reason: 'invalid_name' };
  }

  // Pre-check the (workflow_id, position) and (workflow_id, slug) UNIQUE
  // constraints so we surface a friendly conflict instead of a 23505.
  const existingPos = await db
    .select({ id: workflowStages.id })
    .from(workflowStages)
    .where(
      and(
        eq(workflowStages.workflowId, workflowId),
        eq(workflowStages.position, position),
      ),
    )
    .limit(1);
  if (existingPos.length > 0) {
    return { error: 'conflict', reason: `position_taken:${position}` };
  }

  const existingSlug = await db
    .select({ id: workflowStages.id })
    .from(workflowStages)
    .where(
      and(
        eq(workflowStages.workflowId, workflowId),
        eq(workflowStages.slug, slug),
      ),
    )
    .limit(1);
  if (existingSlug.length > 0) {
    return { error: 'conflict', reason: `stage_name_taken:${name}` };
  }

  const stageId = uuidv7();
  try {
    await db.insert(workflowStages).values({
      id: stageId,
      workflowId,
      slug,
      name,
      position,
      isTerminal,
      requiresAction: false,
      color: color ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('workflow_stages_workflow_position_uniq') || msg.includes('23505')) {
      return { error: 'conflict', reason: `position_taken:${position}` };
    }
    return { error: 'internal_error', reason: `stage_insert:${msg}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'workflow_stage',
    resourceId: stageId,
    metadata: { workflow_id: workflowId, slug, position, is_terminal: isTerminal },
  });

  revalidatePath('/settings/workflows');

  return { success: true, data: { stageId } };
}

// Remove a stage. Blocked if any project in the org currently sits on this
// stage (otherwise we'd violate the projects.current_stage_id NOT NULL FK
// via the ON DELETE RESTRICT semantics — we surface a friendly conflict
// before that fires). Also blocked if it's the only terminal stage left in
// the workflow (a workflow without a terminal can never close out a project).
//
// Hard delete: workflow_stages has no deleted_at column. Stages don't carry
// independent history — they're a structural part of their parent workflow.
export async function removeWorkflowStage(
  input: unknown,
): Promise<WorkflowActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = parseInput(RemoveWorkflowStageInput, input);
  if (!parsed.ok) return parsed.result;
  const { stageId } = parsed.data;

  const stageRows = await db
    .select({
      id: workflowStages.id,
      workflowId: workflowStages.workflowId,
      isTerminal: workflowStages.isTerminal,
      orgId: workflows.orgId,
      isSystemTemplate: workflows.isSystemTemplate,
    })
    .from(workflowStages)
    .innerJoin(workflows, eq(workflows.id, workflowStages.workflowId))
    .where(eq(workflowStages.id, stageId))
    .limit(1);
  if (stageRows.length === 0) {
    return { error: 'not_found', reason: 'stage' };
  }
  if (stageRows[0].isSystemTemplate) {
    return { error: 'not_authorized', reason: 'system_template' };
  }
  if (stageRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'stage' };
  }
  const stage = stageRows[0];

  // Block if any non-deleted project points at this stage.
  const inUse = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.currentStageId, stageId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (inUse.length > 0) {
    return { error: 'conflict', reason: 'stage_in_use' };
  }

  // If this is a terminal stage, ensure another terminal exists in the same
  // workflow before we let it go.
  if (stage.isTerminal) {
    const otherTerminal = await db
      .select({ id: workflowStages.id })
      .from(workflowStages)
      .where(
        and(
          eq(workflowStages.workflowId, stage.workflowId),
          eq(workflowStages.isTerminal, true),
        ),
      )
      .limit(2); // need >= 2 to allow removing this one
    if (otherTerminal.length < 2) {
      return { error: 'conflict', reason: 'last_terminal' };
    }
  }

  await db.delete(workflowStages).where(eq(workflowStages.id, stageId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'delete',
    resourceType: 'workflow_stage',
    resourceId: stageId,
    metadata: { workflow_id: stage.workflowId, was_terminal: stage.isTerminal },
  });

  revalidatePath('/settings/workflows');

  return { success: true };
}

// Soft-delete a workflow. Blocked if any non-deleted project uses it
// (FK is ON DELETE RESTRICT; projects must be migrated off first — that's a
// post-launch UX). System templates are never deletable.
export async function deleteWorkflow(input: unknown): Promise<WorkflowActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = parseInput(DeleteWorkflowInput, input);
  if (!parsed.ok) return parsed.result;
  const { workflowId } = parsed.data;

  const found = await db
    .select({
      id: workflows.id,
      orgId: workflows.orgId,
      isSystemTemplate: workflows.isSystemTemplate,
      deletedAt: workflows.deletedAt,
    })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);
  if (found.length === 0) {
    return { error: 'not_found', reason: 'workflow' };
  }
  if (found[0].isSystemTemplate) {
    return { error: 'not_authorized', reason: 'system_template' };
  }
  if (found[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'workflow' };
  }
  if (found[0].deletedAt !== null) {
    return { error: 'conflict', reason: 'already_deleted' };
  }

  const inUse = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workflowId, workflowId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (inUse.length > 0) {
    return { error: 'conflict', reason: 'workflow_in_use' };
  }

  await db
    .update(workflows)
    .set({ deletedAt: new Date() })
    .where(eq(workflows.id, workflowId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'soft_delete',
    resourceType: 'workflow',
    resourceId: workflowId,
  });

  revalidatePath('/settings/workflows');

  return { success: true };
}

// Read-only fetch for the EditWorkflowDialog. Wraps getWorkflowWithStages with
// the standard auth + discriminated-union shape so client components can call
// it directly. Any org member (not just admins) can read; mutation actions
// gate on admin role.
const FetchWorkflowInput = z.object({ workflowId: z.string().uuid() });

export async function fetchWorkflowDetail(
  input: unknown,
): Promise<WorkflowActionResult<WorkflowDetail>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = parseInput(FetchWorkflowInput, input);
  if (!parsed.ok) return parsed.result;

  const detail = await getWorkflowWithStages(parsed.data.workflowId, ctx.orgId);
  if (!detail) {
    return { error: 'not_found', reason: 'workflow' };
  }
  return { success: true, data: detail };
}
