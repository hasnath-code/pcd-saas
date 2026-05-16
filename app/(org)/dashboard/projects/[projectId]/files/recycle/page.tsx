import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import { getProjectByIdForOrg } from '@/db/queries/projects';
import { listDeletedFilesForProject } from '@/db/queries/files';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { RestoreFileButton } from '@/components/files/RestoreFileButton';

// DEBT-035 — org-admin recycle bin for soft-deleted project files. Lists
// project_files rows with deleted_at set (the inverse of the project detail
// Files card) and exposes the existing `restoreFile` action per row.
// Admin-only: restoreFile already enforces org-admin, and this page 404s for
// non-admin org members so the surface stays as narrow as the action's
// "org admin is the recovery role" contract.
export default async function ProjectFilesRecyclePage({
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

  // Org-admin-only. A non-admin org member gets a 404 — the page doesn't
  // exist for them — rather than a redirect to onboarding (they are an org
  // user, just not an admin). restoreFile enforces the same gate server-side.
  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
  if (!isAdmin) notFound();

  const files = await listDeletedFilesForProject({ projectId });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="hover:underline"
          >
            ← {project.projectNumber}
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Recycle bin</h1>
        <p className="text-sm text-muted-foreground">
          Files deleted from this project. Restoring a file returns it to the
          Files list.
        </p>
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Recycle bin is empty"
          description="Deleted files appear here. Restoring returns a file to the Files list."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Deleted</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="font-medium">
                  {file.originalFilename}
                </TableCell>
                <TableCell>{file.uploaderDisplayName}</TableCell>
                <TableCell>
                  {file.deletedAt.toLocaleDateString('en-GB')}
                </TableCell>
                <TableCell className="text-right">
                  <RestoreFileButton
                    fileId={file.id}
                    filename={file.originalFilename}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
