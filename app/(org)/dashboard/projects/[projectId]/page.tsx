import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import { getProjectByIdForOrg } from '@/db/queries/projects';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProjectStageBadge } from '@/components/projects/ProjectStageBadge';
import { SoftDeleteProjectButton } from '@/components/projects/SoftDeleteProjectButton';
import { InviteStakeholderForm } from '@/components/stakeholders/InviteStakeholderForm';

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

  const canDelete = ctx.role === 'owner' || ctx.role === 'admin';

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
          <p className="mt-3 text-xs text-muted-foreground">
            Stage transitions ship in a future update.
          </p>
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
          <p className="text-sm text-muted-foreground">
            Stakeholder list ships in the next commit.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming soon</CardTitle>
          <CardDescription>
            Messages and files land in the next sessions.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
