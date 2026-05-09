import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

// storage.objects RLS for the 'org-files' bucket (migration 0019 §18).
//
// Path layout: org/{org_id}/projects/{project_id}/{subdir}/{file_id}{ext}
// where {subdir} is surveyor-uploads | client-uploads | documents.
//
// Five policies (see 0019). These tests use the storage API (not REST) so
// the actual storage authorization path is exercised. Uploads go through
// `supabase.storage.from('org-files').upload(path, blob)` which evaluates
// the bucket's storage.objects INSERT policies in postgres.
//
// Service-role uploads bypass RLS — used only for fixture setup. The tests
// that matter here use authenticated user/client JWTs.

const BUCKET = 'org-files';

function buildPath(orgId: string, projectId: string, subdir: string, fileId: string): string {
  return `org/${orgId}/projects/${projectId}/${subdir}/${fileId}.bin`;
}

function makeBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' });
}

describe('storage.objects RLS — org-files bucket', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;
  // Track uploaded paths so afterAll can delete them via service-role.
  const uploadedPaths = new Set<string>();

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // Build a stakeholder identity on orgA's project with full visibility
    // (matches the project_files test fixture pattern).
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `storage-stakeholder-${ts}-${rnd}@test.local`;
    const password = `pwStor-${rnd}-x9X`;
    const { data: authData } = await f.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (!authData?.user) throw new Error('storage test: stakeholder auth failed');
    stakeholderAuth = { id: authData.user.id, email, password };

    stakeholderClientId = uuidv7();
    await f.service.from('clients').insert({
      id: stakeholderClientId,
      auth_user_id: authData.user.id,
      email,
      name: 'Storage Stakeholder',
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
  });

  afterAll(async () => {
    if (uploadedPaths.size > 0) {
      await f.service.storage.from(BUCKET).remove(Array.from(uploadedPaths));
    }
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('Anonymous CANNOT upload to org-files', async () => {
    const c = asAnon();
    const path = buildPath(
      f.orgA.id,
      f.extras.orgAProject.id,
      'surveyor-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).not.toBeNull();
    // Don't track — upload didn't succeed.
  });

  test('Org member CAN upload to own org surveyor-uploads', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const path = buildPath(
      f.orgA.id,
      f.extras.orgAProject.id,
      'surveyor-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).toBeNull();
    if (!error) uploadedPaths.add(path);
  });

  test('Org member CANNOT upload to ANOTHER org surveyor-uploads (cross-org path)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const path = buildPath(
      f.orgB.id,
      f.extras.orgBProject.id,
      'surveyor-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).not.toBeNull();
  });

  test('Org member CANNOT upload to client-uploads (subdir gated)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const path = buildPath(
      f.orgA.id,
      f.extras.orgAProject.id,
      'client-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).not.toBeNull();
  });

  test('Stakeholder CAN upload to client-uploads on permitted project', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const path = buildPath(
      f.orgA.id,
      f.extras.orgAProject.id,
      'client-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).toBeNull();
    if (!error) uploadedPaths.add(path);
  });

  test('Stakeholder CANNOT upload to surveyor-uploads (subdir gated for clients)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const path = buildPath(
      f.orgA.id,
      f.extras.orgAProject.id,
      'surveyor-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).not.toBeNull();
  });

  test('Stakeholder CANNOT upload to a project they have no stakeholder row on', async () => {
    // orgB project — stakeholder has no project_stakeholders row there, so
    // auth_user_stakeholder_project_visibility returns 0 rows → policy
    // rejects.
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const path = buildPath(
      f.orgB.id,
      f.extras.orgBProject.id,
      'client-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).not.toBeNull();
  });

  test('Stakeholder with can_upload_files=false CANNOT upload to client-uploads', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ can_upload_files: false, visibility_profile: 'custom' })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const path = buildPath(
      f.orgA.id,
      f.extras.orgAProject.id,
      'client-uploads',
      uuidv7(),
    );
    const { error } = await c.storage.from(BUCKET).upload(path, makeBlob());
    expect(error).not.toBeNull();

    // Restore.
    await f.service
      .from('project_stakeholders')
      .update({ can_upload_files: true, visibility_profile: 'full' })
      .eq('id', stakeholderRowId);
  });
});
