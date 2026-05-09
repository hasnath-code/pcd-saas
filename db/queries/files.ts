import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { clients, projectFiles, projects, users } from '@/db/schema';

// Phase 1c §12.4. SSR data fetches for project_files. RLS enforces
// access; this query just shapes the data for the file-list UI.
//
// DEBT-027 audit (Session 10): all date columns are direct table columns —
// Drizzle coerces timestamptz→Date correctly for those. No `sql<Date>`
// subqueries here; if a future query needs one, coerce inside the .map()
// projection so the public type stays honest as Date.

export type ProjectFileSource =
  | 'surveyor_upload'
  | 'client_upload'
  | 'document_artifact';

export type ProjectFileVisibility = 'org_only' | 'org_and_stakeholders';

export type ProjectFileRow = {
  id: string;
  projectId: string;
  uploadedByType: 'user' | 'client';
  uploadedById: string;
  uploaderDisplayName: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  source: ProjectFileSource;
  visibility: ProjectFileVisibility;
  thumbnailPath: string | null;
  createdAt: Date;
};

// List visible files for a project, newest first. RLS auto-filters by the
// caller's identity (org member of project's org OR stakeholder w/
// can_view_drawings). Soft-deleted rows excluded.
//
// Decision 10.5: ordered by created_at DESC (most recent first). Matches
// the ConversationsInbox pattern and what users expect from a file feed.
export async function listFilesForProject(
  projectId: string,
): Promise<ProjectFileRow[]> {
  const rows = await db
    .select({
      id: projectFiles.id,
      projectId: projectFiles.projectId,
      uploadedByType: projectFiles.uploadedByType,
      uploadedById: projectFiles.uploadedById,
      storagePath: projectFiles.storagePath,
      originalFilename: projectFiles.originalFilename,
      mimeType: projectFiles.mimeType,
      sizeBytes: projectFiles.sizeBytes,
      source: projectFiles.source,
      visibility: projectFiles.visibility,
      thumbnailPath: projectFiles.thumbnailPath,
      createdAt: projectFiles.createdAt,
      userName: users.name,
      clientName: clients.name,
    })
    .from(projectFiles)
    .leftJoin(
      users,
      and(eq(users.id, projectFiles.uploadedById), eq(projectFiles.uploadedByType, 'user')),
    )
    .leftJoin(
      clients,
      and(
        eq(clients.id, projectFiles.uploadedById),
        eq(projectFiles.uploadedByType, 'client'),
      ),
    )
    .where(
      and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)),
    )
    .orderBy(desc(projectFiles.createdAt));

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    uploadedByType: r.uploadedByType as ProjectFileRow['uploadedByType'],
    uploadedById: r.uploadedById,
    uploaderDisplayName:
      r.uploadedByType === 'user'
        ? r.userName ?? 'Team member'
        : r.clientName ?? 'Stakeholder',
    storagePath: r.storagePath,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    // bigint mode 'number' returns number directly; coerce defensively in
    // case the underlying column is ever read via raw sql in the future.
    sizeBytes: Number(r.sizeBytes),
    source: r.source as ProjectFileSource,
    visibility: r.visibility as ProjectFileVisibility,
    thumbnailPath: r.thumbnailPath,
    createdAt: r.createdAt,
  }));
}

// Project-context lookup used by file actions to (a) resolve the org_id for
// auth dispatch, (b) verify the project isn't soft-deleted before issuing
// upload URLs.
export async function getProjectContextForFile(
  projectId: string,
): Promise<{ orgId: string } | null> {
  const rows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}
