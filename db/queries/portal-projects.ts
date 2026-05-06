import 'server-only';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  clients,
  organizations,
  projectMilestones,
  projectStakeholders,
  projects,
  workflowStages,
  workflows,
} from '@/db/schema';

export type PortalProjectRow = {
  id: string;
  projectNumber: string;
  siteAddress: string;
  orgName: string;
  stageName: string;
  stageColor: string | null;
  stageIsTerminal: boolean;
};

// List projects the calling stakeholder has accepted access to. The query-level
// filter on (clients.auth_user_id + accepted_at NOT NULL + soft-delete-aware)
// matches what the unstubbed auth_user_stakeholder_projects() RLS helper does;
// keeping it in the query keeps the page deterministic regardless of role
// changes mid-session.
export async function listProjectsForStakeholder(
  authUserId: string,
): Promise<PortalProjectRow[]> {
  return db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      siteAddress: projects.siteAddress,
      orgName: organizations.name,
      stageName: workflowStages.name,
      stageColor: workflowStages.color,
      stageIsTerminal: workflowStages.isTerminal,
    })
    .from(projectStakeholders)
    .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .innerJoin(projects, eq(projects.id, projectStakeholders.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(workflows, eq(workflows.id, projects.workflowId))
    .innerJoin(workflowStages, eq(workflowStages.id, projects.currentStageId))
    .where(
      and(
        eq(clients.authUserId, authUserId),
        isNull(clients.deletedAt),
        isNull(projectStakeholders.deletedAt),
        isNotNull(projectStakeholders.acceptedAt),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(desc(projects.createdAt));
}

export type PortalProjectDetail = {
  id: string;
  projectNumber: string;
  siteAddress: string;
  scopeSummary: string | null;
  orgName: string;
  stageName: string;
  stageColor: string | null;
  stageIsTerminal: boolean;
  // Visibility flags for the calling stakeholder. Drives conditional
  // section rendering (always-visible header + flag-gated cards).
  flags: {
    canMessage: boolean;
    canUploadFiles: boolean;
    canViewFinancials: boolean;
    canViewDrawings: boolean;
    canViewSchedule: boolean;
  };
  milestones: {
    id: string;
    label: string;
    scheduledAt: Date | null;
    completedAt: Date | null;
  }[];
};

// Per-project portal view. Returns null if the stakeholder has no accepted,
// non-deleted relationship to the project (RLS would also block, but we
// short-circuit at the query level so the page renders 404 cleanly).
export async function getStakeholderProjectView(
  projectId: string,
  authUserId: string,
): Promise<PortalProjectDetail | null> {
  const rows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      siteAddress: projects.siteAddress,
      scopeSummary: projects.scopeSummary,
      orgName: organizations.name,
      stageName: workflowStages.name,
      stageColor: workflowStages.color,
      stageIsTerminal: workflowStages.isTerminal,
      canMessage: projectStakeholders.canMessage,
      canUploadFiles: projectStakeholders.canUploadFiles,
      canViewFinancials: projectStakeholders.canViewFinancials,
      canViewDrawings: projectStakeholders.canViewDrawings,
      canViewSchedule: projectStakeholders.canViewSchedule,
    })
    .from(projectStakeholders)
    .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .innerJoin(projects, eq(projects.id, projectStakeholders.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(workflows, eq(workflows.id, projects.workflowId))
    .innerJoin(workflowStages, eq(workflowStages.id, projects.currentStageId))
    .where(
      and(
        eq(projectStakeholders.projectId, projectId),
        eq(clients.authUserId, authUserId),
        isNull(clients.deletedAt),
        isNull(projectStakeholders.deletedAt),
        isNotNull(projectStakeholders.acceptedAt),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  // Milestones: respect can_view_schedule + visible_to_stakeholders. The RLS
  // policy already filters this server-side, but the explicit query keeps
  // the rendered list deterministic + skipping the query when can_view_schedule
  // is false saves a round-trip on every render.
  let milestones: PortalProjectDetail['milestones'] = [];
  if (row.canViewSchedule) {
    milestones = await db
      .select({
        id: projectMilestones.id,
        label: projectMilestones.label,
        scheduledAt: projectMilestones.scheduledAt,
        completedAt: projectMilestones.completedAt,
      })
      .from(projectMilestones)
      .where(
        and(
          eq(projectMilestones.projectId, projectId),
          eq(projectMilestones.visibleToStakeholders, true),
          isNull(projectMilestones.deletedAt),
        ),
      )
      .orderBy(asc(projectMilestones.scheduledAt));
  }

  return {
    id: row.id,
    projectNumber: row.projectNumber,
    siteAddress: row.siteAddress,
    scopeSummary: row.scopeSummary,
    orgName: row.orgName,
    stageName: row.stageName,
    stageColor: row.stageColor,
    stageIsTerminal: row.stageIsTerminal,
    flags: {
      canMessage: row.canMessage,
      canUploadFiles: row.canUploadFiles,
      canViewFinancials: row.canViewFinancials,
      canViewDrawings: row.canViewDrawings,
      canViewSchedule: row.canViewSchedule,
    },
    milestones,
  };
}
