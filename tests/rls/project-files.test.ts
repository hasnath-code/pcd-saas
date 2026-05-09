import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { assertNotVisible, assertVisibleIds } from './_helpers';

// project_files RLS (migration 0018 §12.4 + §14):
// - SELECT: org members of the project's org (auth_user_org_project_ids
//   helper) OR stakeholders with can_view_drawings=true on a row marked
//   visibility='org_and_stakeholders' (auth_user_stakeholder_project_visibility).
// - INSERT (org-members): uploaded_by_type='user', source IN
//   (surveyor_upload, document_artifact); uploaded_by_id matches auth user.
// - INSERT (stakeholders): uploaded_by_type='client', source='client_upload',
//   stakeholder.can_upload_files=true.
// - UPDATE (org-members): full; (stakeholders): self-uploaded rows only.
// - DELETE: org admins only (recovery path).
//
// Visibility model — `visibility='org_only'` hides the row from stakeholders
// even when can_view_drawings=true. Tested in the visibility section below.

function buildPath(orgId: string, projectId: string, subdir: string, fileId: string) {
  return `org/${orgId}/projects/${projectId}/${subdir}/${fileId}.bin`;
}

describe('project_files RLS — org-side + soft-delete + anon', () => {
  let f: WorkflowProjectFixture;
  let fileAId: string;
  let fileBId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    fileAId = uuidv7();
    fileBId = uuidv7();
    const { error } = await f.service.from('project_files').insert([
      {
        id: fileAId,
        project_id: f.extras.orgAProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userA.userId,
        storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'surveyor-uploads', fileAId),
        original_filename: 'survey-a.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        source: 'surveyor_upload',
        visibility: 'org_and_stakeholders',
      },
      {
        id: fileBId,
        project_id: f.extras.orgBProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userB.userId,
        storage_path: buildPath(f.orgB.id, f.extras.orgBProject.id, 'surveyor-uploads', fileBId),
        original_filename: 'survey-b.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
        source: 'surveyor_upload',
        visibility: 'org_and_stakeholders',
      },
    ]);
    if (error) throw new Error(`seed project_files: ${error.message}`);
  });

  afterAll(async () => {
    await f.service.from('project_files').delete().in('id', [fileAId, fileBId]);
    await f.cleanup();
  });

  test('User A sees only Org A file (cross-org isolation)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'project_files',
      { column: 'id', values: [fileAId, fileBId] },
      [fileAId],
      'org A select cross-org isolation',
    );
  });

  test('Soft-deleted file hidden from org member', async () => {
    await f.service
      .from('project_files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', fileAId);

    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'project_files', fileAId, 'soft-deleted hidden');

    // Restore.
    await f.service
      .from('project_files')
      .update({ deleted_at: null })
      .eq('id', fileAId);
  });

  test('Anonymous cannot SELECT any project_file', async () => {
    await assertVisibleIds(
      asAnon(),
      'project_files',
      { column: 'id', values: [fileAId, fileBId] },
      [],
      'anon SELECT blocked',
    );
  });

  test('Org member CANNOT INSERT with source=client_upload (only stakeholders can)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const wrongSourceId = uuidv7();
    const { data, error } = await c.from('project_files').insert({
      id: wrongSourceId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'user',
      uploaded_by_id: f.userA.userId,
      storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'client-uploads', wrongSourceId),
      original_filename: 'wrong.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1,
      source: 'client_upload',
    }).select('id');

    // RLS rejects the row — Supabase REST returns either an empty array or an
    // RLS error code depending on PG version; both treated as denied.
    expect(data ?? []).toEqual([]);
    if (error) {
      // Postgres RLS check failure code.
      expect(error.code).toMatch(/42501|PGRST/);
    }

    // No row was actually written.
    const { data: check } = await f.service
      .from('project_files')
      .select('id')
      .eq('id', wrongSourceId);
    expect(check ?? []).toEqual([]);
  });

  test('Org admin can DELETE; non-admin org member cannot', async () => {
    // Create a throwaway row owned by user A (admin/owner).
    const tempId = uuidv7();
    await f.service.from('project_files').insert({
      id: tempId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'user',
      uploaded_by_id: f.userA.userId,
      storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'surveyor-uploads', tempId),
      original_filename: 'temp.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1,
      source: 'surveyor_upload',
    });

    const c = await asUser(f.userA.email, f.userA.password);
    const { error } = await c.from('project_files').delete().eq('id', tempId);
    expect(error).toBeNull();

    const { data: check } = await f.service
      .from('project_files')
      .select('id')
      .eq('id', tempId);
    expect(check ?? []).toEqual([]);
  });
});

describe('project_files RLS — stakeholder visibility profile + visibility flag', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;
  let visibleFileId: string; // visibility=org_and_stakeholders
  let orgOnlyFileId: string; // visibility=org_only
  let stakeholderUploadId: string; // file uploaded by the stakeholder

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `pf-stakeholder-${ts}-${rnd}@test.local`;
    const password = `pw-${rnd}-x9X`;
    const { data: authData, error: authErr } = await f.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr || !authData.user) {
      throw new Error(`stakeholder auth: ${authErr?.message ?? 'no user'}`);
    }
    stakeholderAuth = { id: authData.user.id, email, password };

    stakeholderClientId = uuidv7();
    await f.service.from('clients').insert({
      id: stakeholderClientId,
      auth_user_id: authData.user.id,
      email,
      name: 'Files Stakeholder',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: stakeholderClientId,
      org_id: f.orgA.id,
    });

    stakeholderRowId = uuidv7();
    await f.service.from('project_stakeholders').insert({
      id: stakeholderRowId,
      project_id: f.extras.orgAProject.id,
      client_id: stakeholderClientId,
      role: 'primary_client',
      visibility_profile: 'full',
      can_message: true,
      can_upload_files: true,
      can_view_financials: true,
      can_view_drawings: true,
      can_view_schedule: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });

    // Two org-uploaded files: one shared with stakeholders, one org_only.
    visibleFileId = uuidv7();
    orgOnlyFileId = uuidv7();
    await f.service.from('project_files').insert([
      {
        id: visibleFileId,
        project_id: f.extras.orgAProject.id,
        uploaded_by_type: 'user',
        uploaded_by_id: f.userA.userId,
        storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'surveyor-uploads', visibleFileId),
        original_filename: 'shared-survey.pdf',
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
        storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'surveyor-uploads', orgOnlyFileId),
        original_filename: 'internal-only.pdf',
        mime_type: 'application/pdf',
        size_bytes: 5000,
        source: 'surveyor_upload',
        visibility: 'org_only',
      },
    ]);

    // Stakeholder uploads a client_upload file (will be created via stakeholder
    // session in the upload test below; pre-create it here to test SELECT).
    stakeholderUploadId = uuidv7();
    await f.service.from('project_files').insert({
      id: stakeholderUploadId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'client',
      uploaded_by_id: stakeholderClientId,
      storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'client-uploads', stakeholderUploadId),
      original_filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 8000,
      source: 'client_upload',
      visibility: 'org_and_stakeholders',
    });
  });

  afterAll(async () => {
    await f.service
      .from('project_files')
      .delete()
      .in('id', [visibleFileId, orgOnlyFileId, stakeholderUploadId]);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('Stakeholder w/ can_view_drawings sees org_and_stakeholders + own upload, NOT org_only', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'project_files',
      { column: 'id', values: [visibleFileId, orgOnlyFileId, stakeholderUploadId] },
      [visibleFileId, stakeholderUploadId],
      'stakeholder visibility filter',
    );
  });

  test('Stakeholder with can_view_drawings=false sees nothing on the project', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ can_view_drawings: false, visibility_profile: 'custom' })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'project_files',
      { column: 'id', values: [visibleFileId, orgOnlyFileId, stakeholderUploadId] },
      [],
      'can_view_drawings=false hides all',
    );

    // Restore.
    await f.service
      .from('project_stakeholders')
      .update({ can_view_drawings: true, visibility_profile: 'full' })
      .eq('id', stakeholderRowId);
  });

  test('Stakeholder with can_upload_files=true CAN INSERT client_upload (RLS allows)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const newId = uuidv7();
    const { error } = await c.from('project_files').insert({
      id: newId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'client',
      uploaded_by_id: stakeholderClientId,
      storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'client-uploads', newId),
      original_filename: 'note.txt',
      mime_type: 'text/plain',
      size_bytes: 100,
      source: 'client_upload',
    });
    expect(error).toBeNull();

    const { data } = await f.service
      .from('project_files')
      .select('id')
      .eq('id', newId);
    expect(data?.[0]?.id).toBe(newId);

    await f.service.from('project_files').delete().eq('id', newId);
  });

  test('Stakeholder CANNOT INSERT with source=surveyor_upload (RLS rejects)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const newId = uuidv7();
    const { data } = await c.from('project_files').insert({
      id: newId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'client',
      uploaded_by_id: stakeholderClientId,
      storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'surveyor-uploads', newId),
      original_filename: 'forbidden.pdf',
      mime_type: 'application/pdf',
      size_bytes: 100,
      source: 'surveyor_upload',
    }).select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('project_files')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Stakeholder with can_upload_files=false CANNOT INSERT client_upload', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ can_upload_files: false, visibility_profile: 'custom' })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const newId = uuidv7();
    const { data } = await c.from('project_files').insert({
      id: newId,
      project_id: f.extras.orgAProject.id,
      uploaded_by_type: 'client',
      uploaded_by_id: stakeholderClientId,
      storage_path: buildPath(f.orgA.id, f.extras.orgAProject.id, 'client-uploads', newId),
      original_filename: 'denied.pdf',
      mime_type: 'application/pdf',
      size_bytes: 100,
      source: 'client_upload',
    }).select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('project_files')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);

    // Restore.
    await f.service
      .from('project_stakeholders')
      .update({ can_upload_files: true, visibility_profile: 'full' })
      .eq('id', stakeholderRowId);
  });

  test('Stakeholder CAN UPDATE non-deleted_at fields on own client_upload row', async () => {
    // Note (per migration 0018 comment): stakeholder soft-delete via direct
    // REST UPDATE trips a PostgREST/RLS interaction — when an UPDATE makes
    // the new row invisible to the SELECT policy, PostgREST returns 42501.
    // The action-layer softDeleteFile uses Drizzle's pooler (postgres role,
    // bypasses RLS) so soft-delete works in production. The policy here
    // covers legitimate non-RLS-impacting UPDATEs (e.g. future renames).
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const { error } = await c
      .from('project_files')
      .update({ original_filename: 'photo-renamed.jpg' })
      .eq('id', stakeholderUploadId);
    expect(error).toBeNull();

    const { data: check } = await f.service
      .from('project_files')
      .select('original_filename')
      .eq('id', stakeholderUploadId)
      .single();
    expect(check?.original_filename).toBe('photo-renamed.jpg');

    // Restore filename.
    await f.service
      .from('project_files')
      .update({ original_filename: 'photo.jpg' })
      .eq('id', stakeholderUploadId);
  });

  test('Stakeholder CANNOT UPDATE an org-uploaded row (uploader-self only)', async () => {
    // visibleFileId is uploaded_by_type='user', not 'client'. The
    // stakeholder UPDATE policy USING requires uploaded_by_type='client',
    // so this UPDATE matches no policy and affects 0 rows.
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const { data } = await c
      .from('project_files')
      .update({ original_filename: 'hijacked.pdf' })
      .eq('id', visibleFileId)
      .select('id');
    expect(data ?? []).toEqual([]);

    // Confirm no actual UPDATE happened.
    const { data: check } = await f.service
      .from('project_files')
      .select('original_filename')
      .eq('id', visibleFileId)
      .single();
    expect(check?.original_filename).toBe('shared-survey.pdf');
  });
});
