import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asAuthUser } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  confirmUpload,
  createUploadUrl,
  getDownloadUrl,
  restoreFile,
  softDeleteFile,
} from '@/actions/files';
import { listFilesForProject } from '@/db/queries/files';
import * as auth from '@/lib/auth/requireAuth';

const BUCKET = 'org-files';

// ─── Stakeholder identity setup (shared by upload + delete tests) ─────────────

type StakeholderIdentity = {
  authUserId: string;
  email: string;
  password: string;
  clientId: string;
  stakeholderRowId: string;
};

async function attachStakeholder(
  f: WorkflowProjectFixture,
  projectId: string,
  flags: { canUploadFiles?: boolean; canViewDrawings?: boolean } = {},
): Promise<StakeholderIdentity> {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  const email = `files-action-${ts}-${rnd}@test.local`;
  const password = `pwAct-${rnd}-x9X`;
  const { data: authData, error: authErr } = await f.service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !authData.user) {
    throw new Error(`stakeholder auth: ${authErr?.message ?? 'no user'}`);
  }
  const clientId = uuidv7();
  await f.service.from('clients').insert({
    id: clientId,
    auth_user_id: authData.user.id,
    email,
    name: 'Action Stakeholder',
  });
  await f.service.from('client_org_memberships').insert({
    id: uuidv7(),
    client_id: clientId,
    org_id: f.orgA.id,
  });
  const stakeholderRowId = uuidv7();
  await f.service.from('project_stakeholders').insert({
    id: stakeholderRowId,
    project_id: projectId,
    client_id: clientId,
    role: 'primary_client',
    visibility_profile: 'full',
    can_message: true,
    can_upload_files: flags.canUploadFiles ?? true,
    can_view_financials: true,
    can_view_drawings: flags.canViewDrawings ?? true,
    can_view_schedule: true,
    invited_by: f.userA.userId,
    accepted_at: new Date().toISOString(),
  });
  return {
    authUserId: authData.user.id,
    email,
    password,
    clientId,
    stakeholderRowId,
  };
}

async function detachStakeholder(
  f: WorkflowProjectFixture,
  s: StakeholderIdentity,
): Promise<void> {
  await f.service.from('project_stakeholders').delete().eq('id', s.stakeholderRowId);
  await f.service.from('client_org_memberships').delete().eq('client_id', s.clientId);
  await f.service.from('clients').delete().eq('id', s.clientId);
  await f.service.auth.admin.deleteUser(s.authUserId);
}

// ─── createUploadUrl ──────────────────────────────────────────────────────────

describe('createUploadUrl', () => {
  let f: WorkflowProjectFixture;
  const trackedFileIds = new Set<string>();

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    if (trackedFileIds.size > 0) {
      await f.service.from('project_files').delete().in('id', Array.from(trackedFileIds));
    }
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
  });

  test('happy path: org user requests upload URL', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'survey.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_000_000,
      source: 'surveyor_upload',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.bucket).toBe(BUCKET);
    expect(result.data.signedUrl).toContain('org-files');
    expect(result.data.storagePath).toMatch(
      new RegExp(`^org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/`),
    );
    expect(result.data.fileId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('validation: filename empty rejected', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: '',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('validation: sizeBytes must be positive', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'zero.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 0,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('cross-org rejection: user A requests upload to org B project', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgBProject.id,
      originalFilename: 'crossorg.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('source mismatch: org user CANNOT request client_upload source', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'wrong.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'client_upload',
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('per-file quota: file larger than max_upload_size_bytes rejected with quota_exceeded', async () => {
    // solo_free plan max_upload_size_bytes = 25 MB. Try 30 MB.
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'huge.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 30_000_000,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({
      error: 'quota_exceeded',
      reason: 'file_too_large',
    });
  });

  test('total storage quota: file would push org over max_storage_bytes rejected', async () => {
    // Pre-populate project_files with 99.9 MB of usage. solo_free total =
    // 100 MB. Then request a 1 MB upload → would total 100.9 MB → quota_exceeded.
    const filler = uuidv7();
    await f.service.from('project_files').insert({
      id: filler,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'user',
      uploaded_by_id: f.userA.userId,
      storage_path: `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${filler}.bin`,
      original_filename: 'filler.bin',
      mime_type: 'application/octet-stream',
      size_bytes: 99_900_000,
      source: 'surveyor_upload',
    });

    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'one-more.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_000_000,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({
      error: 'quota_exceeded',
      reason: 'org_storage_full',
    });

    await f.service.from('project_files').delete().eq('id', filler);
  });
});

// ─── createUploadUrl: stakeholder branch ──────────────────────────────────────

describe('createUploadUrl — stakeholder', () => {
  let f: WorkflowProjectFixture;
  let stakeholder: StakeholderIdentity;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    stakeholder = await attachStakeholder(f, f.extras.orgAProject.id);
  });
  afterAll(async () => {
    await detachStakeholder(f, stakeholder);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: stakeholder.authUserId,
      email: stakeholder.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    } as never);
  });

  test('happy path: stakeholder requests client_upload', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 50_000,
      source: 'client_upload',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.storagePath).toMatch(/\/client-uploads\//);
  });

  test('source mismatch: stakeholder CANNOT request surveyor_upload', async () => {
    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'forbidden.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('can_upload_files=false: stakeholder rejected', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ can_upload_files: false, visibility_profile: 'custom' })
      .eq('id', stakeholder.stakeholderRowId);

    const result = await createUploadUrl({
      projectId: f.extras.orgAProject.id,
      originalFilename: 'denied.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      source: 'client_upload',
    });
    expect(result).toMatchObject({ error: 'not_authorized' });

    await f.service
      .from('project_stakeholders')
      .update({ can_upload_files: true, visibility_profile: 'full' })
      .eq('id', stakeholder.stakeholderRowId);
  });
});

// ─── confirmUpload ────────────────────────────────────────────────────────────

describe('confirmUpload', () => {
  let f: WorkflowProjectFixture;
  const trackedFileIds = new Set<string>();

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    if (trackedFileIds.size > 0) {
      await f.service.from('project_files').delete().in('id', Array.from(trackedFileIds));
    }
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
  });

  test('happy path: creates project_files row + audit log', async () => {
    const fileId = uuidv7();
    const storagePath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${fileId}.pdf`;
    const result = await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath,
      originalFilename: 'final.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5000,
      source: 'surveyor_upload',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.fileId).toBe(fileId);

    const { data: row } = await f.service
      .from('project_files')
      .select('id, original_filename, uploaded_by_type, uploaded_by_id, storage_path')
      .eq('id', fileId)
      .single();
    expect(row).not.toBeNull();
    expect(row?.uploaded_by_type).toBe('user');
    expect(row?.uploaded_by_id).toBe(f.userA.userId);
    expect(row?.storage_path).toBe(storagePath);

    trackedFileIds.add(fileId);
  });

  test('storage_path tampering rejected', async () => {
    const fileId = uuidv7();
    const tamperedPath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/different-id.pdf`;
    const result = await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath: tamperedPath,
      originalFilename: 'tampered.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({
      error: 'validation_error',
      reason: 'storage_path_mismatch',
    });
  });

  test('cross-org rejection: user A confirms upload claiming org B project', async () => {
    const fileId = uuidv7();
    const result = await confirmUpload({
      fileId,
      projectId: f.extras.orgBProject.id,
      storagePath: `org/${f.orgB.id}/projects/${f.extras.orgBProject.id}/surveyor-uploads/${fileId}.pdf`,
      originalFilename: 'crossorg.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('race re-check: quota exceeded between createUploadUrl and confirmUpload', async () => {
    // Fill org to 99.9 MB. Then attempt to confirm a 1 MB file → would push
    // over → expects quota_exceeded.
    const filler = uuidv7();
    await f.service.from('project_files').insert({
      id: filler,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'user',
      uploaded_by_id: f.userA.userId,
      storage_path: `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${filler}.bin`,
      original_filename: 'filler.bin',
      mime_type: 'application/octet-stream',
      size_bytes: 99_900_000,
      source: 'surveyor_upload',
    });

    const fileId = uuidv7();
    const storagePath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${fileId}.pdf`;
    const result = await confirmUpload({
      fileId,
      projectId: f.extras.orgAProject.id,
      storagePath,
      originalFilename: 'over-quota.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_000_000,
      source: 'surveyor_upload',
    });
    expect(result).toMatchObject({
      error: 'quota_exceeded',
      reason: 'org_storage_full',
    });

    await f.service.from('project_files').delete().eq('id', filler);
  });
});

// ─── getDownloadUrl ───────────────────────────────────────────────────────────

describe('getDownloadUrl', () => {
  let f: WorkflowProjectFixture;
  let orgFileId: string;
  let orgOnlyFileId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    orgFileId = uuidv7();
    orgOnlyFileId = uuidv7();
    const sharedPath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${orgFileId}.pdf`;
    const orgOnlyPath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${orgOnlyFileId}.pdf`;

    // Upload tiny blobs so createSignedUrl in the action can succeed —
    // local Supabase storage verifies object existence at sign-time.
    const blob = new Blob([new Uint8Array([1])], { type: 'application/pdf' });
    await f.service.storage.from('org-files').upload(sharedPath, blob);
    await f.service.storage.from('org-files').upload(orgOnlyPath, blob);

    await f.service.from('project_files').insert([
      {
        id: orgFileId,
        project_id: f.extras.orgAProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userA.userId,
        storage_path: sharedPath,
        original_filename: 'shared.pdf',
        mime_type: 'application/pdf',
        size_bytes: 5000,
        source: 'surveyor_upload',
        visibility: 'org_and_stakeholders',
      },
      {
        id: orgOnlyFileId,
        project_id: f.extras.orgAProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userA.userId,
        storage_path: orgOnlyPath,
        original_filename: 'internal.pdf',
        mime_type: 'application/pdf',
        size_bytes: 5000,
        source: 'surveyor_upload',
        visibility: 'org_only',
      },
    ]);
  });
  afterAll(async () => {
    const sharedPath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${orgFileId}.pdf`;
    const orgOnlyPath = `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${orgOnlyFileId}.pdf`;
    await f.service.storage.from('org-files').remove([sharedPath, orgOnlyPath]);
    await f.service.from('project_files').delete().in('id', [orgFileId, orgOnlyFileId]);
    await f.cleanup();
  });

  test('org user gets a signed download URL for org_and_stakeholders file', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await getDownloadUrl({ fileId: orgFileId });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.downloadUrl).toContain('org-files');
    expect(result.data.originalFilename).toBe('shared.pdf');
    expect(result.data.expiresInSeconds).toBe(3600);
  });

  test('org user gets a signed URL even for org_only file (their own org)', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await getDownloadUrl({ fileId: orgOnlyFileId });
    expect('error' in result).toBe(false);
  });

  test('cross-org user CANNOT get download URL', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userB));
    const result = await getDownloadUrl({ fileId: orgFileId });
    expect(result).toMatchObject({ error: 'not_found' });
  });

  test('not_found for missing file', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await getDownloadUrl({ fileId: uuidv7() });
    expect(result).toMatchObject({ error: 'not_found' });
  });

  // DEBT-036: the signed URL must carry a `download` query param so Supabase
  // Storage responds with Content-Disposition: attachment. Without this, PDFs
  // and images render inline in the new tab instead of triggering a save.
  test('signed URL carries the download disposition param with the original filename', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await getDownloadUrl({ fileId: orgFileId });
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.data.downloadUrl).toContain('download=');
    const parsed = new URL(result.data.downloadUrl);
    expect(parsed.searchParams.get('download')).toBe('shared.pdf');
  });
});

// ─── softDeleteFile + restoreFile ─────────────────────────────────────────────

describe('softDeleteFile + restoreFile', () => {
  let f: WorkflowProjectFixture;
  let memberFileId: string;
  let memberAuth: { authUserId: string; email: string; password: string; userId: string };

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Create a non-admin member of orgA so we can test uploader-self vs
    // admin authorization.
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `member-${ts}-${rnd}@test.local`;
    const password = `pwM-${rnd}-x9X`;
    const { data: authData } = await f.service.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    const userId = uuidv7();
    await f.service.from('users').insert({
      id: userId,
      auth_user_id: authData!.user!.id,
      org_id: f.orgA.id,
      email,
      name: 'Member',
      role: 'member',
    });
    memberAuth = { authUserId: authData!.user!.id, email, password, userId };

    memberFileId = uuidv7();
    await f.service.from('project_files').insert({
      id: memberFileId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'user',
      uploaded_by_id: userId,
      storage_path: `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${memberFileId}.pdf`,
      original_filename: 'member-upload.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1000,
      source: 'surveyor_upload',
    });
  });
  afterAll(async () => {
    await f.service.from('project_files').delete().eq('id', memberFileId);
    await f.service.from('users').delete().eq('id', memberAuth.userId);
    await f.service.auth.admin.deleteUser(memberAuth.authUserId);
    await f.cleanup();
  });
  afterEach(async () => {
    // Reset deleted_at so tests are independent.
    await f.service
      .from('project_files')
      .update({ deleted_at: null })
      .eq('id', memberFileId);
  });

  test('uploader can soft-delete own file', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: memberAuth.authUserId,
      email: memberAuth.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    } as never);

    const result = await softDeleteFile({ fileId: memberFileId });
    expect('error' in result).toBe(false);

    const { data: row } = await f.service
      .from('project_files')
      .select('deleted_at')
      .eq('id', memberFileId)
      .single();
    expect(row?.deleted_at).not.toBeNull();
  });

  test('org admin can soft-delete another member\'s file', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await softDeleteFile({ fileId: memberFileId });
    expect('error' in result).toBe(false);
  });

  test('non-uploader non-admin CANNOT soft-delete (cross-org)', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userB));
    const result = await softDeleteFile({ fileId: memberFileId });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('restoreFile: admin only — non-admin uploader rejected', async () => {
    // Soft-delete first.
    await f.service
      .from('project_files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', memberFileId);

    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: memberAuth.authUserId,
      email: memberAuth.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    } as never);

    const result = await restoreFile({ fileId: memberFileId });
    expect(result).toMatchObject({
      error: 'not_authorized',
      reason: 'org_admin_required',
    });
  });

  test('restoreFile: org admin succeeds', async () => {
    await f.service
      .from('project_files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', memberFileId);

    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await restoreFile({ fileId: memberFileId });
    expect('error' in result).toBe(false);

    const { data: row } = await f.service
      .from('project_files')
      .select('deleted_at')
      .eq('id', memberFileId)
      .single();
    expect(row?.deleted_at).toBeNull();
  });
});

// ─── listFilesForProject visibility filter (DEBT-059) ─────────────────────────
// Regression: before the fix, listFilesForProject scoped by project_id + soft-
// delete only. Because the Drizzle pooler bypasses RLS, stakeholders viewing
// the portal project page received `visibility='org_only'` rows. The fix
// adds a required `visibleOnly: boolean` and ANDs in
// `visibility='org_and_stakeholders'` when true. These tests pin that
// contract at the query layer (RLS-level coverage continues to live in
// tests/rls/project-files.test.ts).

describe('listFilesForProject — visibleOnly filter (DEBT-059)', () => {
  let f: WorkflowProjectFixture;
  const trackedFileIds = new Set<string>();
  let visibleFileId: string;
  let hiddenFileId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    visibleFileId = uuidv7();
    hiddenFileId = uuidv7();
    await f.service.from('project_files').insert([
      {
        id: visibleFileId,
        project_id: f.extras.orgAProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userA.userId,
        storage_path: `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${visibleFileId}.pdf`,
        original_filename: 'shared.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        source: 'surveyor_upload',
        visibility: 'org_and_stakeholders',
      },
      {
        id: hiddenFileId,
        project_id: f.extras.orgAProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userA.userId,
        storage_path: `org/${f.orgA.id}/projects/${f.extras.orgAProject.id}/surveyor-uploads/${hiddenFileId}.pdf`,
        original_filename: 'internal.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
        source: 'surveyor_upload',
        visibility: 'org_only',
      },
    ]);
    trackedFileIds.add(visibleFileId);
    trackedFileIds.add(hiddenFileId);
  });

  afterAll(async () => {
    if (trackedFileIds.size > 0) {
      await f.service
        .from('project_files')
        .delete()
        .in('id', Array.from(trackedFileIds));
    }
    await f.cleanup();
  });

  test('visibleOnly: true returns only org_and_stakeholders rows', async () => {
    const rows = await listFilesForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(visibleFileId);
    expect(ids).not.toContain(hiddenFileId);
    for (const row of rows) {
      expect(row.visibility).toBe('org_and_stakeholders');
    }
  });

  test('visibleOnly: false returns all visibilities', async () => {
    const rows = await listFilesForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: false,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(visibleFileId);
    expect(ids).toContain(hiddenFileId);
  });
});
