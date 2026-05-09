'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AuthError,
  requireAuth,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clients,
  projectFiles,
  projectStakeholders,
  projects,
  users,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { checkFeature } from '@/lib/features';
import { createServiceClient } from '@/lib/supabase/service';

// ARCHITECTURE-saas.md §20 standard shape per action: Zod parse → auth →
// access check → quota check → mutation → audit log → discriminated return.
//
// File uploads use a two-step pattern (§18):
//   1. createUploadUrl validates everything, mints a signed upload URL,
//      returns the pre-allocated fileId + storagePath.
//   2. Client uploads directly to Supabase Storage using the signed URL
//      (no proxying through Vercel — direct PUT keeps us under serverless
//      function size + timeout limits).
//   3. confirmUpload re-checks quota (race protection between create and
//      confirm), creates the project_files row, audit-logs, returns the row.
//
// Bucket: 'org-files'. Path: org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext}
// where subdir maps from `source`:
//   surveyor_upload   → surveyor-uploads
//   client_upload     → client-uploads
//   document_artifact → documents
//
// Signed URL TTLs (Session 10 reality, supersedes spec §18 5-min placeholder):
//   - Upload: 2 hours (Supabase storage-js v2.105 hard-codes — no expiresIn
//     option on createSignedUploadUrl). Documented in ADR-030.
//   - Download: 1 hour (matches kickoff §C; reasonable for a user clicking
//     a link, downloading, possibly redirecting).

export type FileActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

const BUCKET = 'org-files';
const DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hour
const FILENAME_MAX = 255;
const MIME_TYPE_MAX = 127;

const SOURCE_VALUES = [
  'surveyor_upload',
  'client_upload',
  'document_artifact',
] as const;
const VISIBILITY_VALUES = ['org_only', 'org_and_stakeholders'] as const;

// Maps file source → storage subdirectory. Mirrored in storage RLS (0019)
// path[5] checks. Keep in sync.
const SOURCE_TO_SUBDIR: Record<(typeof SOURCE_VALUES)[number], string> = {
  surveyor_upload: 'surveyor-uploads',
  client_upload: 'client-uploads',
  document_artifact: 'documents',
};

// Extract a safe extension from the original filename. Empty extension is
// allowed (some files genuinely have none, e.g. README). Returns '' or '.<ext>'.
function safeExtension(originalFilename: string): string {
  const idx = originalFilename.lastIndexOf('.');
  if (idx <= 0 || idx === originalFilename.length - 1) return '';
  const ext = originalFilename.slice(idx + 1).toLowerCase();
  // Reject extensions with path separators or control chars; cap length.
  if (!/^[a-z0-9]{1,16}$/.test(ext)) return '';
  return `.${ext}`;
}

function buildStoragePath(opts: {
  orgId: string;
  projectId: string;
  source: (typeof SOURCE_VALUES)[number];
  fileId: string;
  originalFilename: string;
}): string {
  const subdir = SOURCE_TO_SUBDIR[opts.source];
  const ext = safeExtension(opts.originalFilename);
  return `org/${opts.orgId}/projects/${opts.projectId}/${subdir}/${opts.fileId}${ext}`;
}

// ─── Internal: identity resolution ────────────────────────────────────────────

type FileUploaderIdentity =
  | {
      kind: 'user';
      userId: string;
      orgId: string;
      role: 'owner' | 'admin' | 'member';
    }
  | {
      kind: 'client';
      clientId: string;
      canUploadFiles: boolean;
      canViewDrawings: boolean;
    };

// Resolve the auth user's identity in the context of a specific project.
// For org users, returns a user identity scoped to the project's org_id
// (cross-org rejected). For stakeholders, returns the per-project visibility
// flags by joining project_stakeholders. Returns null if neither identity
// matches — caller returns 'not_authorized'.
async function resolveIdentityForProject(
  authUserId: string,
  projectId: string,
): Promise<{ orgId: string; identity: FileUploaderIdentity } | null> {
  const projectRow = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRow.length === 0) return null;
  const orgId = projectRow[0].orgId;

  // Try org-user identity first (more common case + cheaper join).
  const userRow = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.authUserId, authUserId),
        eq(users.orgId, orgId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (userRow.length > 0) {
    const role = userRow[0].role as 'owner' | 'admin' | 'member';
    return {
      orgId,
      identity: { kind: 'user', userId: userRow[0].id, orgId, role },
    };
  }

  // Stakeholder identity. Join clients → project_stakeholders for the per-
  // project flags.
  const clientRow = await db
    .select({
      clientId: clients.id,
      canUploadFiles: projectStakeholders.canUploadFiles,
      canViewDrawings: projectStakeholders.canViewDrawings,
    })
    .from(clients)
    .innerJoin(
      projectStakeholders,
      and(
        eq(projectStakeholders.clientId, clients.id),
        eq(projectStakeholders.projectId, projectId),
        isNull(projectStakeholders.deletedAt),
      ),
    )
    .where(
      and(
        eq(clients.authUserId, authUserId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (clientRow.length > 0) {
    return {
      orgId,
      identity: {
        kind: 'client',
        clientId: clientRow[0].clientId,
        canUploadFiles: clientRow[0].canUploadFiles,
        canViewDrawings: clientRow[0].canViewDrawings,
      },
    };
  }

  return null;
}

// ─── createUploadUrl ──────────────────────────────────────────────────────────

const CreateUploadUrlInput = z.object({
  projectId: z.string().uuid(),
  originalFilename: z.string().trim().min(1).max(FILENAME_MAX),
  mimeType: z.string().trim().min(1).max(MIME_TYPE_MAX),
  sizeBytes: z.number().int().positive(),
  source: z.enum(SOURCE_VALUES),
  visibility: z.enum(VISIBILITY_VALUES).optional(),
});

export type CreateUploadUrlData = {
  fileId: string;
  storagePath: string;
  signedUrl: string;
  uploadToken: string;
  bucket: string;
};

// Validate access + quota + per-file size; mint a signed upload URL; return
// pre-allocated fileId so confirmUpload can reference the same row id.
export async function createUploadUrl(
  input: unknown,
): Promise<FileActionResult<CreateUploadUrlData>> {
  let authUser: Awaited<ReturnType<typeof requireAuth>>;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateUploadUrlInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, originalFilename, mimeType, sizeBytes, source, visibility } =
    parsed.data;

  const resolved = await resolveIdentityForProject(authUser.id, projectId);
  if (!resolved) return { error: 'not_authorized', reason: 'no_project_access' };
  const { orgId, identity } = resolved;

  // Source must match identity. Stakeholders write client_upload only; org
  // users write surveyor_upload or document_artifact. Mirrors the storage
  // RLS subdir gating in 0019.
  if (identity.kind === 'user') {
    if (source === 'client_upload') {
      return { error: 'not_authorized', reason: 'org_user_cannot_write_client_upload' };
    }
  } else {
    if (source !== 'client_upload') {
      return {
        error: 'not_authorized',
        reason: 'stakeholder_can_only_write_client_upload',
      };
    }
    if (!identity.canUploadFiles) {
      return { error: 'not_authorized', reason: 'stakeholder_lacks_can_upload_files' };
    }
  }

  // Quota: per-file cap + running total. Both gates evaluated by checkFeature.
  const quota = await checkFeature(orgId, 'upload_file', { sizeBytes });
  if (!quota.allowed) {
    if (quota.reason === 'file_too_large') {
      return {
        error: 'quota_exceeded',
        reason: 'file_too_large',
      };
    }
    if (quota.reason === 'quota_exceeded') {
      return {
        error: 'quota_exceeded',
        reason: 'org_storage_full',
      };
    }
    return { error: 'feature_gated', reason: quota.reason };
  }

  const fileId = uuidv7();
  const storagePath = buildStoragePath({
    orgId,
    projectId,
    source,
    fileId,
    originalFilename,
  });

  // Service client — minting signed upload URLs requires service role.
  // Storage RLS still applies on SELECT/UPDATE/DELETE; INSERT-via-signed-URL
  // bypasses RLS at the storage layer (the signed URL is the auth). The
  // server action's validation above is the gate. Visibility-flag also
  // restricts (see DEBT note below).
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error) {
    return { error: 'internal_error', reason: error.message };
  }

  // Pin visibility default at the action layer too — we don't pass it through
  // to confirmUpload, so we capture the choice here and re-pass on confirm.
  // (Reserved for a future extension where createUploadUrl returns an opaque
  // token whose visibility is part of the signed payload.)
  void visibility;

  return {
    success: true,
    data: {
      fileId,
      storagePath,
      signedUrl: data.signedUrl,
      uploadToken: data.token,
      bucket: BUCKET,
    },
  };
}

// ─── confirmUpload ────────────────────────────────────────────────────────────

const ConfirmUploadInput = z.object({
  fileId: z.string().uuid(),
  projectId: z.string().uuid(),
  storagePath: z.string().min(1),
  originalFilename: z.string().trim().min(1).max(FILENAME_MAX),
  mimeType: z.string().trim().min(1).max(MIME_TYPE_MAX),
  sizeBytes: z.number().int().positive(),
  source: z.enum(SOURCE_VALUES),
  visibility: z.enum(VISIBILITY_VALUES).optional(),
});

export type ConfirmUploadData = {
  fileId: string;
};

// Create the project_files row after the client-side upload completes.
// Re-quota-checks defensively to close the create→confirm race window:
// if a concurrent upload pushed the org over the cap between createUploadUrl
// and confirmUpload, we delete the just-uploaded storage object and reject.
export async function confirmUpload(
  input: unknown,
): Promise<FileActionResult<ConfirmUploadData>> {
  let authUser: Awaited<ReturnType<typeof requireAuth>>;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = ConfirmUploadInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const {
    fileId,
    projectId,
    storagePath,
    originalFilename,
    mimeType,
    sizeBytes,
    source,
    visibility,
  } = parsed.data;

  const resolved = await resolveIdentityForProject(authUser.id, projectId);
  if (!resolved) return { error: 'not_authorized', reason: 'no_project_access' };
  const { orgId, identity } = resolved;

  // Source/identity match (same gates as createUploadUrl — run again
  // because the input could be tampered with between calls).
  if (identity.kind === 'user' && source === 'client_upload') {
    return { error: 'not_authorized', reason: 'org_user_cannot_write_client_upload' };
  }
  if (identity.kind === 'client') {
    if (source !== 'client_upload') {
      return {
        error: 'not_authorized',
        reason: 'stakeholder_can_only_write_client_upload',
      };
    }
    if (!identity.canUploadFiles) {
      return {
        error: 'not_authorized',
        reason: 'stakeholder_lacks_can_upload_files',
      };
    }
  }

  // Validate the storagePath matches what we'd build for this (project, source,
  // fileId) tuple. Defense against a tampered storagePath redirecting the row
  // to point at a different file the user couldn't legitimately upload to.
  const expectedPathPrefix = `org/${orgId}/projects/${projectId}/${SOURCE_TO_SUBDIR[source]}/${fileId}`;
  if (!storagePath.startsWith(expectedPathPrefix)) {
    return { error: 'validation_error', reason: 'storage_path_mismatch' };
  }

  // Re-check quota — race protection. Use service-side SUM, not the
  // currentUsageBytes returned at createUploadUrl time.
  const quota = await checkFeature(orgId, 'upload_file', { sizeBytes });
  if (!quota.allowed) {
    // Best-effort cleanup of the just-uploaded object so we don't accumulate
    // orphaned bytes against the bucket. Service client; ignore deletion
    // errors (Sentry breadcrumb captures the upload audit anyway).
    const supabase = createServiceClient();
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    if (quota.reason === 'file_too_large') {
      return { error: 'quota_exceeded', reason: 'file_too_large' };
    }
    if (quota.reason === 'quota_exceeded') {
      return { error: 'quota_exceeded', reason: 'org_storage_full' };
    }
    return { error: 'feature_gated', reason: quota.reason };
  }

  const uploadedByType = identity.kind === 'user' ? 'user' : 'client';
  const uploadedById =
    identity.kind === 'user' ? identity.userId : identity.clientId;

  await db.insert(projectFiles).values({
    id: fileId,
    projectId,
    uploadedByType,
    uploadedById,
    storagePath,
    originalFilename,
    mimeType,
    sizeBytes,
    source,
    visibility: visibility ?? 'org_and_stakeholders',
  });

  await logAudit({
    orgId,
    userId: identity.kind === 'user' ? identity.userId : undefined,
    clientId: identity.kind === 'client' ? identity.clientId : undefined,
    action: 'create',
    resourceType: 'project_file',
    resourceId: fileId,
    metadata: {
      projectId,
      originalFilename,
      mimeType,
      sizeBytes,
      source,
    },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);

  return { success: true, data: { fileId } };
}

// ─── getDownloadUrl ───────────────────────────────────────────────────────────

const GetDownloadUrlInput = z.object({
  fileId: z.string().uuid(),
});

export type GetDownloadUrlData = {
  downloadUrl: string;
  originalFilename: string;
  mimeType: string;
  expiresInSeconds: number;
};

// Issue a signed download URL with 1-hour TTL. RLS on project_files filters
// by caller identity — if the row is invisible to them, we return not_found.
export async function getDownloadUrl(
  input: unknown,
): Promise<FileActionResult<GetDownloadUrlData>> {
  let authUser: Awaited<ReturnType<typeof requireAuth>>;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = GetDownloadUrlInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { fileId } = parsed.data;

  // Read the file row + verify access via resolveIdentityForProject (mirrors
  // RLS but gives a structured 'not_found' rather than an empty row).
  const fileRows = await db
    .select({
      id: projectFiles.id,
      projectId: projectFiles.projectId,
      storagePath: projectFiles.storagePath,
      originalFilename: projectFiles.originalFilename,
      mimeType: projectFiles.mimeType,
      visibility: projectFiles.visibility,
    })
    .from(projectFiles)
    .where(and(eq(projectFiles.id, fileId), isNull(projectFiles.deletedAt)))
    .limit(1);
  if (fileRows.length === 0) return { error: 'not_found' };
  const file = fileRows[0];

  const resolved = await resolveIdentityForProject(authUser.id, file.projectId);
  if (!resolved) return { error: 'not_found' };

  // Stakeholder visibility gate — org_only files are invisible to stakeholders
  // even when can_view_drawings=true. Org users see everything in their org.
  if (resolved.identity.kind === 'client') {
    if (file.visibility === 'org_only') return { error: 'not_found' };
    if (!resolved.identity.canViewDrawings) {
      return { error: 'not_authorized', reason: 'stakeholder_lacks_can_view_drawings' };
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storagePath, DOWNLOAD_TTL_SECONDS);
  if (error || !data) {
    return { error: 'internal_error', reason: error?.message ?? 'sign_failed' };
  }

  return {
    success: true,
    data: {
      downloadUrl: data.signedUrl,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    },
  };
}

// ─── softDeleteFile ───────────────────────────────────────────────────────────

const SoftDeleteFileInput = z.object({
  fileId: z.string().uuid(),
});

// Sets deleted_at = now(). Authorization: uploader (user or client) self,
// OR org admin. Storage object stays — recoverable via restoreFile.
export async function softDeleteFile(
  input: unknown,
): Promise<FileActionResult> {
  let authUser: Awaited<ReturnType<typeof requireAuth>>;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = SoftDeleteFileInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { fileId } = parsed.data;

  const fileRows = await db
    .select({
      id: projectFiles.id,
      projectId: projectFiles.projectId,
      uploadedByType: projectFiles.uploadedByType,
      uploadedById: projectFiles.uploadedById,
    })
    .from(projectFiles)
    .where(and(eq(projectFiles.id, fileId), isNull(projectFiles.deletedAt)))
    .limit(1);
  if (fileRows.length === 0) return { error: 'not_found' };
  const file = fileRows[0];

  const resolved = await resolveIdentityForProject(authUser.id, file.projectId);
  if (!resolved) return { error: 'not_authorized', reason: 'no_project_access' };

  // Authorization: uploader-self OR org admin/owner.
  let allowed = false;
  if (resolved.identity.kind === 'user') {
    if (
      resolved.identity.role === 'owner' ||
      resolved.identity.role === 'admin'
    ) {
      allowed = true;
    } else if (
      file.uploadedByType === 'user' &&
      file.uploadedById === resolved.identity.userId
    ) {
      allowed = true;
    }
  } else if (resolved.identity.kind === 'client') {
    if (
      file.uploadedByType === 'client' &&
      file.uploadedById === resolved.identity.clientId
    ) {
      allowed = true;
    }
  }
  if (!allowed) {
    return { error: 'not_authorized', reason: 'not_uploader_or_admin' };
  }

  await db
    .update(projectFiles)
    .set({ deletedAt: new Date() })
    .where(eq(projectFiles.id, fileId));

  await logAudit({
    orgId: resolved.orgId,
    userId: resolved.identity.kind === 'user' ? resolved.identity.userId : undefined,
    clientId:
      resolved.identity.kind === 'client' ? resolved.identity.clientId : undefined,
    action: 'soft_delete',
    resourceType: 'project_file',
    resourceId: fileId,
    metadata: { projectId: file.projectId },
  });

  revalidatePath(`/projects/${file.projectId}`);
  revalidatePath(`/portal/projects/${file.projectId}`);

  return { success: true };
}

// ─── restoreFile ──────────────────────────────────────────────────────────────

const RestoreFileInput = z.object({
  fileId: z.string().uuid(),
});

// Clears deleted_at. Org admin only — the typical recovery path. Stakeholders
// don't get a restore affordance even on their own files (keeps the UI surface
// narrow; org admin is the recovery role).
export async function restoreFile(input: unknown): Promise<FileActionResult> {
  let authUser: Awaited<ReturnType<typeof requireAuth>>;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = RestoreFileInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { fileId } = parsed.data;

  // Find the row even if soft-deleted — we need the projectId for auth.
  const fileRows = await db
    .select({
      id: projectFiles.id,
      projectId: projectFiles.projectId,
    })
    .from(projectFiles)
    .where(eq(projectFiles.id, fileId))
    .limit(1);
  if (fileRows.length === 0) return { error: 'not_found' };
  const file = fileRows[0];

  const resolved = await resolveIdentityForProject(authUser.id, file.projectId);
  if (!resolved) return { error: 'not_authorized', reason: 'no_project_access' };
  if (
    resolved.identity.kind !== 'user' ||
    (resolved.identity.role !== 'owner' && resolved.identity.role !== 'admin')
  ) {
    return { error: 'not_authorized', reason: 'org_admin_required' };
  }

  await db
    .update(projectFiles)
    .set({ deletedAt: null })
    .where(eq(projectFiles.id, fileId));

  await logAudit({
    orgId: resolved.orgId,
    userId: resolved.identity.userId,
    action: 'restore',
    resourceType: 'project_file',
    resourceId: fileId,
    metadata: { projectId: file.projectId },
  });

  revalidatePath(`/projects/${file.projectId}`);
  revalidatePath(`/portal/projects/${file.projectId}`);

  return { success: true };
}
