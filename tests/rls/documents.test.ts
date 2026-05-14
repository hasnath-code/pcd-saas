import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { assertNotVisible, assertVisibleIds } from './_helpers';

// documents RLS (migration 0023 §2.2 + §14):
// - SELECT: org members of the project's org OR stakeholders with
//   can_view_financials=true on the project (via auth_user_stakeholder_project_visibility).
//   This is the case ARCHITECTURE-saas.md §26's stub test targets.
// - INSERT (org-members): project_id in caller's org-project set AND created_by
//   matches the caller's public.users.id.
// - UPDATE (org-members): any org-member of the project's org. Token-authorized
//   acceptQuote writes route through the Drizzle pooler (ADR-034) and bypass
//   this policy entirely.
// - DELETE: org admins only (recovery hard-delete; standard delete is soft).

describe('documents RLS — org-side + soft-delete + anon', () => {
  let f: WorkflowProjectFixture;
  let docAId: string;
  let docBId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    docAId = uuidv7();
    docBId = uuidv7();
    const { error } = await f.service.from('documents').insert([
      {
        id: docAId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        type: 'quote',
        document_number: `${f.extras.orgAProject.projectNumber}-Q1`,
        sequence: 1,
        created_by: f.userA.userId,
      },
      {
        id: docBId,
        org_id: f.orgB.id,
        project_id: f.extras.orgBProject.id,
        type: 'quote',
        document_number: `${f.extras.orgBProject.projectNumber}-Q1`,
        sequence: 1,
        created_by: f.userB.userId,
      },
    ]);
    if (error) throw new Error(`seed documents: ${error.message}`);
  });

  afterAll(async () => {
    await f.service.from('documents').delete().in('id', [docAId, docBId]);
    await f.cleanup();
  });

  test('User A SELECT sees only Org A document (cross-org isolation)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'documents',
      { column: 'id', values: [docAId, docBId] },
      [docAId],
      'org A select cross-org isolation',
    );
  });

  test('Soft-deleted document hidden from org member', async () => {
    await f.service
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', docAId);

    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'documents', docAId, 'soft-deleted hidden');

    await f.service.from('documents').update({ deleted_at: null }).eq('id', docAId);
  });

  test('Anonymous cannot SELECT any document row', async () => {
    await assertVisibleIds(
      asAnon(),
      'documents',
      { column: 'id', values: [docAId, docBId] },
      [],
      'anon SELECT blocked',
    );
  });

  test('Org A user cannot INSERT a document for Org B project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('documents')
      .insert({
        id: newId,
        org_id: f.orgB.id,
        project_id: f.extras.orgBProject.id,
        type: 'quote',
        document_number: `${f.extras.orgBProject.projectNumber}-Q99`,
        sequence: 99,
        created_by: f.userA.userId,
      })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('documents')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Org A user cannot UPDATE Org B document', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('documents')
      .update({ accepted_by_name: 'hijack' })
      .eq('id', docBId)
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('documents')
      .select('accepted_by_name')
      .eq('id', docBId)
      .single();
    expect(check?.accepted_by_name).toBeNull();
  });

  test('Org A user cannot DELETE Org B document', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { error } = await c.from('documents').delete().eq('id', docBId);
    // Either the RLS policy blocks (no row affected) or PostgREST returns an
    // error; both treated as denied. We assert via service-role that the row
    // still exists.
    if (error) {
      expect(error.code).toMatch(/42501|PGRST/);
    }
    const { data: check } = await f.service
      .from('documents')
      .select('id')
      .eq('id', docBId);
    expect(check?.[0]?.id).toBe(docBId);
  });

  test('Org A user CAN INSERT a document for their own org/project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { error } = await c.from('documents').insert({
      id: newId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      document_number: `${f.extras.orgAProject.projectNumber}-Q2`,
      sequence: 2,
      created_by: f.userA.userId,
    });
    expect(error).toBeNull();

    const { data: check } = await f.service
      .from('documents')
      .select('id')
      .eq('id', newId);
    expect(check?.[0]?.id).toBe(newId);

    await f.service.from('documents').delete().eq('id', newId);
  });

  test('Org A user CANNOT INSERT a document for own org with created_by=Org B user', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('documents')
      .insert({
        id: newId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        type: 'quote',
        document_number: `${f.extras.orgAProject.projectNumber}-Q3`,
        sequence: 3,
        created_by: f.userB.userId, // cross-user created_by — should be denied
      })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('documents')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });
});

describe('documents RLS — stakeholder financial visibility (§14 + §26 stub)', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;
  let docAId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `doc-stakeholder-${ts}-${rnd}@test.local`;
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
      name: 'Doc Stakeholder',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: stakeholderClientId,
      org_id: f.orgA.id,
    });

    // Start with `full` profile (can_view_financials=true). Tests toggle the
    // flag down to false to assert the negative branch.
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

    docAId = uuidv7();
    await f.service.from('documents').insert({
      id: docAId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      document_number: `${f.extras.orgAProject.projectNumber}-Q1`,
      sequence: 1,
      created_by: f.userA.userId,
    });
  });

  afterAll(async () => {
    await f.service.from('documents').delete().eq('id', docAId);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('Stakeholder with can_view_financials=true SEES the project document', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'documents',
      { column: 'id', values: [docAId] },
      [docAId],
      'full profile sees document',
    );
  });

  test('Stakeholder with can_view_financials=false (progress_only) SEES NOTHING', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ can_view_financials: false, visibility_profile: 'progress_only' })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'documents',
      { column: 'id', values: [docAId] },
      [],
      'progress_only hides document',
    );

    await f.service
      .from('project_stakeholders')
      .update({ can_view_financials: true, visibility_profile: 'full' })
      .eq('id', stakeholderRowId);
  });

  test('Stakeholder cannot INSERT documents (no stakeholder INSERT policy)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const newId = uuidv7();
    const { data } = await c
      .from('documents')
      .insert({
        id: newId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        type: 'quote',
        document_number: `${f.extras.orgAProject.projectNumber}-Q-stkh`,
        sequence: 999,
        created_by: f.userA.userId,
      })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('documents')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Stakeholder cannot UPDATE documents (no stakeholder UPDATE policy)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const { data } = await c
      .from('documents')
      .update({ accepted_by_name: 'stakeholder-hijack' })
      .eq('id', docAId)
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('documents')
      .select('accepted_by_name')
      .eq('id', docAId)
      .single();
    expect(check?.accepted_by_name).toBeNull();
  });
});
