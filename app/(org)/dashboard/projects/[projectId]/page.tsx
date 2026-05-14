import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import {
  getProjectByIdForOrg,
  listStakeholderInvitationsForProject,
  listStakeholdersForProject,
} from '@/db/queries/projects';
import { listFilesForProject } from '@/db/queries/files';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProjectStageBadge } from '@/components/projects/ProjectStageBadge';
import { SoftDeleteProjectButton } from '@/components/projects/SoftDeleteProjectButton';
import { StageSelector } from '@/components/projects/StageSelector';
import { InviteStakeholderForm } from '@/components/stakeholders/InviteStakeholderForm';
import { StakeholdersList } from '@/components/stakeholders/StakeholdersList';
import { CancelInvitationButton } from '@/components/team/CancelInvitationButton';
import { FileList } from '@/components/files/FileList';
import { FileUploadZone } from '@/components/files/FileUploadZone';
import { ActivityTimeline } from '@/components/activity/ActivityTimeline';
import { QuotesSection } from '@/components/quotes/QuotesSection';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { projectId } = await params;
  const project = await getProjectByIdForOrg(projectId, ctx.orgId);
  if (!project) notFound();

  const [stakeholders, pendingInvites, files] = await Promise.all([
    listStakeholdersForProject(projectId, ctx.orgId),
    listStakeholderInvitationsForProject(projectId, ctx.orgId),
    // Org-side: see all files. Pooler bypasses RLS, but org members are
    // entitled to both visibility classes — so visibleOnly: false (DEBT-059).
    listFilesForProject({ projectId, visibleOnly: false }),
  ]);

  const canDelete = ctx.role === 'owner' || ctx.role === 'admin';
  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            <Link
              href="/dashboard/projects"
              className="hover:underline"
            >
              ← All projects
            </Link>
          </p>
          <h1 className="text-3xl font-semibold">{project.projectNumber}</h1>
          <p className="text-sm text-muted-foreground">{project.siteAddress}</p>
          <div>
            <ProjectStageBadge
              name={project.stageName}
              color={project.stageColor}
              isTerminal={project.stageIsTerminal}
            />
          </div>
        </div>
        {canDelete && (
          <SoftDeleteProjectButton
            projectId={project.id}
            projectNumber={project.projectNumber}
          />
        )}
      </div>

      {project.scopeSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scope</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">
            {project.scopeSummary}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow</CardTitle>
          <CardDescription>{project.workflowName}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {project.workflowStages.map((s) => {
              const isCurrent = s.id === project.currentStageId;
              return (
                <div
                  key={s.id}
                  className={
                    isCurrent
                      ? 'rounded-md border-2 border-foreground bg-muted/50 px-2 py-1'
                      : 'rounded-md border px-2 py-1 opacity-60'
                  }
                >
                  <ProjectStageBadge
                    name={s.name}
                    color={s.color}
                    isTerminal={s.isTerminal}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t pt-4">
            <StageSelector
              projectId={project.id}
              currentStageId={project.currentStageId}
              stages={project.workflowStages.map((s) => ({
                id: s.id,
                name: s.name,
                position: s.position,
                isTerminal: s.isTerminal,
              }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Stakeholders</CardTitle>
            <CardDescription>
              People outside the team who can see this project in their portal.
            </CardDescription>
          </div>
          <InviteStakeholderForm projectId={project.id} />
        </CardHeader>
        <CardContent>
          <StakeholdersList rows={stakeholders} />
        </CardContent>
      </Card>

      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending stakeholder invitations</CardTitle>
            <CardDescription>
              {pendingInvites.length} awaiting acceptance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {inv.stakeholderRole ?? 'collaborator'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {inv.visibilityProfile ?? 'progress_only'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <CancelInvitationButton
                        invitationId={inv.id}
                        email={inv.email}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
          <CardDescription>
            Drawings, surveys, and documents shared on this project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileUploadZone projectId={project.id} source="surveyor_upload" />
          <FileList
            files={files}
            viewer={{ kind: 'org_user', userId: ctx.userId, isAdmin }}
          />
        </CardContent>
      </Card>

      <QuotesSection projectId={project.id} />

      <ActivityTimeline projectId={project.id} viewer="org" />
    </main>
  );
}
