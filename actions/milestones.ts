'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { projectMilestones, projects } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';

export type MilestoneActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

const CreateMilestoneInput = z.object({
  projectId: z.string().uuid(),
  label: z.string().trim().min(1, 'Label is required').max(200),
  scheduledAt: z.coerce.date().optional(),
  visibleToStakeholders: z.boolean().default(true),
});

// Create a milestone on a project in the caller's org. Cross-org → not_found.
export async function createMilestone(
  input: unknown,
): Promise<MilestoneActionResult<{ milestoneId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateMilestoneInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, label, scheduledAt, visibleToStakeholders } = parsed.data;

  const projectRows = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRows.length === 0 || projectRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }

  const milestoneId = uuidv7();
  await db.insert(projectMilestones).values({
    id: milestoneId,
    projectId,
    label,
    scheduledAt,
    visibleToStakeholders,
  });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'project_milestone',
    resourceId: milestoneId,
    metadata: { project_id: projectId, label, visible_to_stakeholders: visibleToStakeholders },
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');
  revalidatePath(`/portal/projects/${projectId}`, 'layout');

  return { success: true, data: { milestoneId } };
}

const UpdateMilestoneInput = z.object({
  milestoneId: z.string().uuid(),
  label: z.string().trim().min(1).max(200).optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  visibleToStakeholders: z.boolean().optional(),
});

export async function updateMilestone(input: unknown): Promise<MilestoneActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdateMilestoneInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'validation_error', reason: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { milestoneId, ...patch } = parsed.data;

  const rows = await db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      orgId: projects.orgId,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(and(eq(projectMilestones.id, milestoneId), isNull(projectMilestones.deletedAt)))
    .limit(1);
  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'milestone' };
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return { error: 'validation_error', reason: 'no_fields_to_update' };
  }

  await db.update(projectMilestones).set(updates).where(eq(projectMilestones.id, milestoneId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'project_milestone',
    resourceId: milestoneId,
    metadata: { project_id: rows[0].projectId, fields: Object.keys(updates) },
  });

  revalidatePath(`/dashboard/projects/${rows[0].projectId}`, 'layout');
  revalidatePath(`/portal/projects/${rows[0].projectId}`, 'layout');

  return { success: true };
}

const MilestoneIdInput = z.object({ milestoneId: z.string().uuid() });

export async function softDeleteMilestone(input: unknown): Promise<MilestoneActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = MilestoneIdInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'validation_error', reason: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { milestoneId } = parsed.data;

  const rows = await db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      deletedAt: projectMilestones.deletedAt,
      orgId: projects.orgId,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(eq(projectMilestones.id, milestoneId))
    .limit(1);
  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'milestone' };
  }
  if (rows[0].deletedAt !== null) {
    return { error: 'conflict', reason: 'already_deleted' };
  }

  await db
    .update(projectMilestones)
    .set({ deletedAt: new Date() })
    .where(eq(projectMilestones.id, milestoneId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'soft_delete',
    resourceType: 'project_milestone',
    resourceId: milestoneId,
    metadata: { project_id: rows[0].projectId },
  });

  revalidatePath(`/dashboard/projects/${rows[0].projectId}`, 'layout');
  revalidatePath(`/portal/projects/${rows[0].projectId}`, 'layout');

  return { success: true };
}
