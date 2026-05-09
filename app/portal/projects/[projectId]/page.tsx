import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import { getStakeholderProjectView } from '@/db/queries/portal-projects';
import { listFilesForProject } from '@/db/queries/files';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ProjectStageBadge } from '@/components/projects/ProjectStageBadge';
import { FileList } from '@/components/files/FileList';
import { FileUploadZone } from '@/components/files/FileUploadZone';

// Per-project portal view. Sections are gated on the caller's per-stakeholder
// flag set (Phase 1b §14):
//   - Always: project header (number, site, org, stage)
//   - can_view_schedule → milestones list
//   - can_view_drawings → "Files coming in Session 10" placeholder
//   - can_message       → "Messages coming in Session 9" placeholder
//   - can_view_financials → "Invoices coming in Phase 2" placeholder
//
// RLS gates the underlying data via auth_user_stakeholder_project_visibility +
// project_milestones policies. The query in db/queries/portal-projects.ts
// also short-circuits on the flag — so when can_view_schedule=false, the
// milestones query isn't issued at all (avoids one round-trip per render).
export default async function PortalProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) redirect('/login');
    throw e;
  }

  const { projectId } = await params;
  const view = await getStakeholderProjectView(projectId, ctx.authUserId);
  if (!view) notFound();

  // Files: only fetched when can_view_drawings — RLS would already filter
  // these to zero rows, but skipping the query saves a round-trip.
  const files = view.flags.canViewDrawings
    ? await listFilesForProject(projectId)
    : [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/portal/projects" className="hover:underline">
            ← My projects
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">{view.projectNumber}</h1>
        <p className="text-sm text-muted-foreground">{view.siteAddress}</p>
        <p className="text-xs text-muted-foreground">{view.orgName}</p>
        <div>
          <ProjectStageBadge
            name={view.stageName}
            color={view.stageColor}
            isTerminal={view.stageIsTerminal}
          />
        </div>
      </div>

      {view.flags.canViewSchedule && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
            <CardDescription>
              Project milestones the team is tracking.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {view.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No milestones recorded yet.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {view.milestones.map((m) => (
                  <li key={m.id} className="flex items-start gap-3">
                    <span
                      className={
                        m.completedAt
                          ? 'mt-0.5 h-2 w-2 rounded-full bg-green-500'
                          : 'mt-0.5 h-2 w-2 rounded-full bg-muted-foreground/30'
                      }
                      aria-hidden
                    />
                    <div className="flex-1">
                      <p className="font-medium">{m.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.completedAt
                          ? `Completed ${m.completedAt.toLocaleDateString('en-GB')}`
                          : m.scheduledAt
                            ? `Due ${m.scheduledAt.toLocaleDateString('en-GB')}`
                            : 'No date set'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {view.flags.canViewDrawings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Drawings &amp; files</CardTitle>
            <CardDescription>
              {view.flags.canUploadFiles
                ? 'Files shared on this project. Drag &amp; drop to upload.'
                : 'Files shared on this project.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {view.flags.canUploadFiles && (
              <FileUploadZone projectId={projectId} source="client_upload" />
            )}
            <FileList
              files={files}
              viewer={{ kind: 'stakeholder', clientId: ctx.clientId }}
            />
          </CardContent>
        </Card>
      )}

      {view.flags.canMessage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages</CardTitle>
            <CardDescription>
              Coming in a future update — direct messaging with the team lands
              soon.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {view.flags.canViewFinancials && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoices &amp; quotes</CardTitle>
            <CardDescription>
              Coming in Phase 2 — billing visibility lands later.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
