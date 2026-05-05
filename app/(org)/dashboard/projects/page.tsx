import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import { listProjectsForOrg } from '@/db/queries/projects';
import { getOrgDefaultWorkflow } from '@/db/queries/workflows';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProjectStageBadge } from '@/components/projects/ProjectStageBadge';

export default async function ProjectsListPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { stage } = await searchParams;
  const stageId = stage && stage.length > 0 ? stage : undefined;

  const [projectsList, defaultWorkflow] = await Promise.all([
    listProjectsForOrg(ctx.orgId, { stageId }),
    getOrgDefaultWorkflow(ctx.orgId),
  ]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            All active projects in your organization.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/projects/new">New project</Link>
        </Button>
      </div>

      {defaultWorkflow && defaultWorkflow.stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter by stage:</span>
          <Button
            asChild
            variant={!stageId ? 'secondary' : 'outline'}
            size="sm"
          >
            <Link href="/dashboard/projects">All</Link>
          </Button>
          {defaultWorkflow.stages.map((s) => (
            <Button
              key={s.id}
              asChild
              variant={stageId === s.id ? 'secondary' : 'outline'}
              size="sm"
            >
              <Link href={`/dashboard/projects?stage=${s.id}`}>{s.name}</Link>
            </Button>
          ))}
        </div>
      )}

      {projectsList.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              {stageId
                ? 'No projects match this stage filter.'
                : 'Create your first project to get started.'}
            </CardDescription>
          </CardHeader>
          {!stageId && (
            <CardContent>
              <Button asChild>
                <Link href="/dashboard/projects/new">Create your first project</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project number</TableHead>
                  <TableHead>Site address</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectsList.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/projects/${p.id}`}
                        className="hover:underline"
                      >
                        {p.projectNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.siteAddress}
                    </TableCell>
                    <TableCell>
                      <ProjectStageBadge
                        name={p.stageName}
                        color={p.stageColor}
                        isTerminal={p.stageIsTerminal}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.createdAt.toLocaleDateString('en-GB')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
