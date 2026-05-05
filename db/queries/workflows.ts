import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { workflows, workflowStages } from '@/db/schema';

export type WorkflowStageRow = {
  id: string;
  slug: string;
  name: string;
  position: number;
  isTerminal: boolean;
  color: string | null;
};

export type OrgWorkflow = {
  workflowId: string;
  workflowName: string;
  workflowSlug: string;
  isDefault: boolean;
  stages: WorkflowStageRow[];
};

// List the org's workflows (non-system, non-deleted) with their stages,
// ordered by stage position. Used by the project create form to populate the
// workflow picker.
export async function listOrgWorkflows(orgId: string): Promise<OrgWorkflow[]> {
  const wfRows = await db
    .select({
      id: workflows.id,
      slug: workflows.slug,
      name: workflows.name,
      isDefault: workflows.isDefault,
    })
    .from(workflows)
    .where(
      and(
        eq(workflows.orgId, orgId),
        eq(workflows.isSystemTemplate, false),
        isNull(workflows.deletedAt),
      ),
    )
    .orderBy(asc(workflows.name));

  if (wfRows.length === 0) return [];

  // Single batched query for all workflows' stages.
  const stageRows = await db
    .select({
      id: workflowStages.id,
      workflowId: workflowStages.workflowId,
      slug: workflowStages.slug,
      name: workflowStages.name,
      position: workflowStages.position,
      isTerminal: workflowStages.isTerminal,
      color: workflowStages.color,
    })
    .from(workflowStages)
    .innerJoin(workflows, eq(workflows.id, workflowStages.workflowId))
    .where(
      and(eq(workflows.orgId, orgId), eq(workflows.isSystemTemplate, false)),
    )
    .orderBy(asc(workflowStages.workflowId), asc(workflowStages.position));

  const stagesByWorkflow = new Map<string, WorkflowStageRow[]>();
  for (const s of stageRows) {
    const list = stagesByWorkflow.get(s.workflowId) ?? [];
    list.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      position: s.position,
      isTerminal: s.isTerminal,
      color: s.color,
    });
    stagesByWorkflow.set(s.workflowId, list);
  }

  return wfRows.map((w) => ({
    workflowId: w.id,
    workflowName: w.name,
    workflowSlug: w.slug,
    isDefault: w.isDefault,
    stages: stagesByWorkflow.get(w.id) ?? [],
  }));
}

// The org's default workflow (is_default = true), or the first workflow if
// none is marked default. Returns null if the org has no workflows at all
// (shouldn't happen post-Session-5 — createOrganization atomically clones
// Simple).
export async function getOrgDefaultWorkflow(orgId: string): Promise<OrgWorkflow | null> {
  const all = await listOrgWorkflows(orgId);
  if (all.length === 0) return null;
  return all.find((w) => w.isDefault) ?? all[0];
}
