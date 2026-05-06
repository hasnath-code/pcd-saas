import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import { listProjectsForStakeholder } from '@/db/queries/portal-projects';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProjectStageBadge } from '@/components/projects/ProjectStageBadge';

export default async function PortalProjectsListPage() {
  let ctx;
  try {
    ctx = await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) redirect('/login');
    throw e;
  }

  const list = await listProjectsForStakeholder(ctx.authUserId);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold">My projects</h1>
        <p className="text-sm text-muted-foreground">
          Projects you&apos;ve been invited to.
        </p>
      </div>

      {list.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              When a project team adds you as a stakeholder, the project will
              show up here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Site address</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Current stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/portal/projects/${p.id}`}
                        className="hover:underline"
                      >
                        {p.projectNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.siteAddress}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.orgName}
                    </TableCell>
                    <TableCell>
                      <ProjectStageBadge
                        name={p.stageName}
                        color={p.stageColor}
                        isTerminal={p.stageIsTerminal}
                      />
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
