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
import { ActivityTimeline } from '@/components/activity/ActivityTimeline';
import { QuotesSection } from '@/components/quotes/QuotesSection';
import { InvoicesSection } from '@/components/invoices/InvoicesSection';
import { PaymentsSection } from '@/components/payments/PaymentsSection';
import { ReceiptsSection } from '@/components/receipts/ReceiptsSection';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarClock } from 'lucide-react';

// Per-project portal view. Sections are gated on the caller's per-stakeholder
// flag set (Phase 1b §14):
//   - Always: project header (number, site, org, stage)
//   - can_view_schedule → milestones list
//   - can_view_drawings → files
//   - can_message       → messages placeholder (real surface in /portal/conversations)
//   - can_view_financials → quotes + invoices + payments + receipts (read-only)
//
// RLS gates the underlying data via auth_user_stakeholder_project_visibility +
// project_milestones policies. The query in db/queries/portal-projects.ts
// also short-circuits on the flag — so when can_view_schedule=false, the
// milestones query isn't issued at all (avoids one round-trip per render).
//
// Session 14 wires the financial sections. Each section component now takes
// viewer='stakeholder' + stakeholderAuthUserId; the query layer enforces the
// can_view_financials gate as defense-in-depth via hasStakeholderFinancialAccess.
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

  // Files: only fetched when can_view_drawings. The pooler `db` bypasses
  // RLS, so `visibleOnly: true` is REQUIRED to enforce the project_files
  // visibility gate at the query layer (DEBT-059, mirrors listProjectActivity).
  const files = view.flags.canViewDrawings
    ? await listFilesForProject({ projectId, visibleOnly: true })
    : [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
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
              <EmptyState
                icon={CalendarClock}
                title="No milestones yet"
                description="Milestones the team schedules for this project appear here."
              />
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
        <>
          <QuotesSection
            projectId={projectId}
            viewer="stakeholder"
            stakeholderAuthUserId={ctx.authUserId}
          />
          <InvoicesSection
            projectId={projectId}
            viewer="stakeholder"
            stakeholderAuthUserId={ctx.authUserId}
          />
          <PaymentsSection
            projectId={projectId}
            viewer="stakeholder"
            stakeholderAuthUserId={ctx.authUserId}
          />
          <ReceiptsSection
            projectId={projectId}
            viewer="stakeholder"
            stakeholderAuthUserId={ctx.authUserId}
          />
        </>
      )}

      <ActivityTimeline
        projectId={projectId}
        viewer="stakeholder"
        stakeholderAuthUserId={ctx.authUserId}
      />
    </main>
  );
}
