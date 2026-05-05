import 'server-only';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { projects, workflowStages, workflows } from '@/db/schema';

export type ProjectRow = {
  id: string;
  projectNumber: string;
  siteAddress: string;
  scopeSummary: string | null;
  workflowId: string;
  workflowName: string;
  currentStageId: string;
  stageName: string;
  stageColor: string | null;
  stageIsTerminal: boolean;
  createdAt: Date;
};

// List active (non-deleted) projects in the org with workflow + stage joined,
// most recent first. Optional stage filter narrows by current_stage_id.
export async function listProjectsForOrg(
  orgId: string,
  opts?: { stageId?: string },
): Promise<ProjectRow[]> {
  const baseConditions = [eq(projects.orgId, orgId), isNull(projects.deletedAt)];
  if (opts?.stageId) {
    baseConditions.push(eq(projects.currentStageId, opts.stageId));
  }

  const rows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      siteAddress: projects.siteAddress,
      scopeSummary: projects.scopeSummary,
      workflowId: projects.workflowId,
      workflowName: workflows.name,
      currentStageId: projects.currentStageId,
      stageName: workflowStages.name,
      stageColor: workflowStages.color,
      stageIsTerminal: workflowStages.isTerminal,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(workflows, eq(workflows.id, projects.workflowId))
    .innerJoin(workflowStages, eq(workflowStages.id, projects.currentStageId))
    .where(and(...baseConditions))
    .orderBy(desc(projects.createdAt));

  return rows;
}

export type ProjectDetail = ProjectRow & {
  createdBy: string;
  workflowStages: { id: string; name: string; position: number; color: string | null; isTerminal: boolean }[];
};

// Single project + its workflow's stage list. Returns null if not found OR
// if the project is in a different org (org-isolation enforced at query level
// via orgId; RLS would also block but query-level filter is faster + clearer).
export async function getProjectByIdForOrg(
  projectId: string,
  orgId: string,
): Promise<ProjectDetail | null> {
  const rows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      siteAddress: projects.siteAddress,
      scopeSummary: projects.scopeSummary,
      workflowId: projects.workflowId,
      workflowName: workflows.name,
      currentStageId: projects.currentStageId,
      stageName: workflowStages.name,
      stageColor: workflowStages.color,
      stageIsTerminal: workflowStages.isTerminal,
      createdAt: projects.createdAt,
      createdBy: projects.createdBy,
    })
    .from(projects)
    .innerJoin(workflows, eq(workflows.id, projects.workflowId))
    .innerJoin(workflowStages, eq(workflowStages.id, projects.currentStageId))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.orgId, orgId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const project = rows[0];

  const stages = await db
    .select({
      id: workflowStages.id,
      name: workflowStages.name,
      position: workflowStages.position,
      color: workflowStages.color,
      isTerminal: workflowStages.isTerminal,
    })
    .from(workflowStages)
    .where(eq(workflowStages.workflowId, project.workflowId))
    .orderBy(asc(workflowStages.position));

  return { ...project, workflowStages: stages };
}
