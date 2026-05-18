import 'server-only';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import { clients, projectFiles, projects, users } from '@/db/schema';

// Phase 1c §12.4. SSR data fetches for project_files. Body shaped here so
// server components share the same display contract.
//
// DEBT-027 audit (Session 10): all date columns are direct table columns —
// Drizzle coerces timestamptz→Date correctly for those. No `sql<Date>`
// subqueries here; if a future query needs one, coerce inside the .map()
// projection so the public type stays honest as Date.
//
// Server-side visibility filter (DEBT-059, Session 11 mini-session)
// ==================================================================
// `db` is the Drizzle pooler client (postgres role) which BYPASSES RLS.
// That means the project_files SELECT policy from migration 0018 doesn't
// apply to these queries — we must enforce the stakeholder-visibility gate
// explicitly when the caller is a stakeholder. The `visibleOnly` flag does
// exactly that: org-side callers pass false (org members see everything;
// they wouldn't pass the stakeholder filter anyway since they're not
// stakeholders), portal-side callers pass true. Defense-in-depth — even if
// a future refactor accidentally passes the wrong flag, the RLS policy
// from 0018 is still the canonical gate at the database boundary and
// would re-apply if the query were ever routed through the Supabase REST
// client (authenticated role). Mirrors `listProjectActivity` (project-activity.ts).

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

// List visible files for a project, newest first. Soft-deleted rows excluded.
// `visibleOnly` is REQUIRED — see file-level comment block above for why.
//
// Decision 10.5: ordered by created_at DESC (most recent first). Matches
// the ConversationsInbox pattern and what users expect from a file feed.
//
// Phase 2 Session 14 Phase F fix 2: ALWAYS exclude `source='document_artifact'`
// rows. Generated PDFs (quote/invoice/receipt artifacts created by
// generateDocumentPdf) are stored in project_files with this source value
// + a source_document_id FK back to the documents row, but they aren't
// drawings/files in the user-facing sense — they're shared via the
// document_tokens link, downloaded via the per-document Download PDF
// affordance, and shouldn't appear in the org-side or portal-side Files
// list (where they'd confuse: 'why is "PCD-2026-001-R1.pdf" in my drawings?').
// If a future surface needs to surface artifacts, opt in via a new flag —
// no caller wants them today.
export async function listFilesForProject(opts: {
  projectId: string;
  /** When true, filter rows to visibility='org_and_stakeholders'. */
  visibleOnly: boolean;
}): Promise<ProjectFileRow[]> {
  const baseWhere = opts.visibleOnly
    ? and(
        eq(projectFiles.projectId, opts.projectId),
        eq(projectFiles.visibility, 'org_and_stakeholders'),
        ne(projectFiles.source, 'document_artifact'),
        isNull(projectFiles.deletedAt),
      )
    : and(
        eq(projectFiles.projectId, opts.projectId),
        ne(projectFiles.source, 'document_artifact'),
        isNull(projectFiles.deletedAt),
      );

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
    .where(baseWhere)
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

export type DeletedProjectFileRow = ProjectFileRow & { deletedAt: Date };

// List soft-deleted files for a project, most-recently-deleted first — the
// inverse of listFilesForProject. Feeds the org-admin recycle-bin page
// (DEBT-035: /dashboard/projects/[id]/files/recycle). There is no
// `visibleOnly` flag: the recycle bin is an org-admin-only surface and org
// members are entitled to both visibility classes (mirrors the
// visibleOnly:false branch of listFilesForProject). `document_artifact` rows
// are excluded for the same reason as listFilesForProject — generated PDFs
// aren't drawings/files in the user-facing sense and have their own
// lifecycle, so they don't belong in a file recycle bin.
export async function listDeletedFilesForProject(opts: {
  projectId: string;
}): Promise<DeletedProjectFileRow[]> {
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
      deletedAt: projectFiles.deletedAt,
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
      and(
        eq(projectFiles.projectId, opts.projectId),
        ne(projectFiles.source, 'document_artifact'),
        isNotNull(projectFiles.deletedAt),
      ),
    )
    .orderBy(desc(projectFiles.deletedAt));

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
    sizeBytes: Number(r.sizeBytes),
    source: r.source as ProjectFileSource,
    visibility: r.visibility as ProjectFileVisibility,
    thumbnailPath: r.thumbnailPath,
    createdAt: r.createdAt,
    // Non-null by the isNotNull(deletedAt) filter above; Drizzle types the
    // nullable column as Date | null, so assert here.
    deletedAt: r.deletedAt!,
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
