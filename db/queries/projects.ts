import 'server-only';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  clients,
  invitations,
  projectStakeholders,
  projects,
  users,
  workflowStages,
  workflows,
} from '@/db/schema';

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
  // Phase 1b Session 6: primary client (project_stakeholders WHERE
  // role='primary_client', deleted_at IS NULL). NULL when project has no
  // primary client (legacy Session 5 projects, or any project never wired up
  // with one). The list page renders "—" in this case.
  primaryClientName: string | null;
  primaryClientEmail: string | null;
};

// List active (non-deleted) projects in the org with workflow + stage joined,
// most recent first. Optional stage filter narrows by current_stage_id.
//
// LEFT JOIN to project_stakeholders + clients for the primary client column.
// Filter project_stakeholders to role='primary_client' + deleted_at IS NULL
// in the join clause (not the WHERE) so projects without a primary client
// aren't dropped. UNIQUE(project_id, client_id) means at most one client per
// (project, role) — but role isn't part of the unique key, so technically two
// primary_client rows could exist in pathological data. We accept the implicit
// dedupe (Postgres returns each match as a separate row); the UI shows the
// first row. A future hardening could add DISTINCT ON (project_id) + ORDER
// BY but Phase 1b doesn't enforce that strictness.
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
      primaryClientName: clients.name,
      primaryClientEmail: clients.email,
    })
    .from(projects)
    .innerJoin(workflows, eq(workflows.id, projects.workflowId))
    .innerJoin(workflowStages, eq(workflowStages.id, projects.currentStageId))
    .leftJoin(
      projectStakeholders,
      and(
        eq(projectStakeholders.projectId, projects.id),
        eq(projectStakeholders.role, 'primary_client'),
        isNull(projectStakeholders.deletedAt),
      ),
    )
    .leftJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .where(and(...baseConditions))
    .orderBy(desc(projects.createdAt));

  // Dedupe by project id — the LEFT JOIN can multiply rows if a project
  // somehow has multiple primary_client stakeholders (shouldn't happen in
  // practice). First match wins.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
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
      primaryClientName: clients.name,
      primaryClientEmail: clients.email,
    })
    .from(projects)
    .innerJoin(workflows, eq(workflows.id, projects.workflowId))
    .innerJoin(workflowStages, eq(workflowStages.id, projects.currentStageId))
    .leftJoin(
      projectStakeholders,
      and(
        eq(projectStakeholders.projectId, projects.id),
        eq(projectStakeholders.role, 'primary_client'),
        isNull(projectStakeholders.deletedAt),
      ),
    )
    .leftJoin(clients, eq(clients.id, projectStakeholders.clientId))
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

export type StakeholderRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  role: string;
  visibilityProfile: string;
  canMessage: boolean;
  canUploadFiles: boolean;
  canViewFinancials: boolean;
  canViewDrawings: boolean;
  canViewSchedule: boolean;
  acceptedAt: Date | null;
  invitedAt: Date;
};

// Active (non-deleted) stakeholders on a project. Org-isolation enforced via
// the projects join + orgId filter; RLS would also block but explicit filter
// keeps the query deterministic.
export async function listStakeholdersForProject(
  projectId: string,
  orgId: string,
): Promise<StakeholderRow[]> {
  return db
    .select({
      id: projectStakeholders.id,
      clientId: projectStakeholders.clientId,
      clientName: clients.name,
      clientEmail: clients.email,
      role: projectStakeholders.role,
      visibilityProfile: projectStakeholders.visibilityProfile,
      canMessage: projectStakeholders.canMessage,
      canUploadFiles: projectStakeholders.canUploadFiles,
      canViewFinancials: projectStakeholders.canViewFinancials,
      canViewDrawings: projectStakeholders.canViewDrawings,
      canViewSchedule: projectStakeholders.canViewSchedule,
      acceptedAt: projectStakeholders.acceptedAt,
      invitedAt: projectStakeholders.invitedAt,
    })
    .from(projectStakeholders)
    .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .innerJoin(projects, eq(projects.id, projectStakeholders.projectId))
    .where(
      and(
        eq(projectStakeholders.projectId, projectId),
        eq(projects.orgId, orgId),
        isNull(projectStakeholders.deletedAt),
      ),
    )
    .orderBy(asc(projectStakeholders.invitedAt));
}

export type StakeholderInvitationRow = {
  id: string;
  email: string;
  stakeholderRole: string | null;
  visibilityProfile: string | null;
  expiresAt: Date;
  invitedByName: string | null;
};

// Pending stakeholder invitations on a project (not accepted, not cancelled,
// not expired). Used by the project detail page's pending list.
export async function listStakeholderInvitationsForProject(
  projectId: string,
  orgId: string,
): Promise<StakeholderInvitationRow[]> {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      stakeholderRole: invitations.stakeholderRole,
      visibilityProfile: invitations.visibilityProfile,
      expiresAt: invitations.expiresAt,
      invitedByName: users.name,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .where(
      and(
        eq(invitations.projectId, projectId),
        eq(invitations.orgId, orgId),
        eq(invitations.invitationType, 'stakeholder'),
        isNull(invitations.acceptedAt),
        isNull(invitations.deletedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(invitations.createdAt));
}
