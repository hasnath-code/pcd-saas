import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { assertNotVisible, assertVisibleIds } from './_helpers';

// payments RLS (migration 0025 §2.3 + §14):
// - SELECT: org members of the project's org OR stakeholders with
//   can_view_financials=true (via auth_user_stakeholder_project_visibility).
//   Mirrors documents_select — the same financial-visibility gate.
// - INSERT (org-members): project_id in caller's org-project set AND
//   recorded_by matches the caller's public.users.id.
// - UPDATE (org-members): any org-member of the project's org (corrections).
// - DELETE: org admins only.

describe('payments RLS — org-side + soft-delete + anon', () => {
  let f: WorkflowProjectFixture;
  let paymentAId: string;
  let paymentBId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    paymentAId = uuidv7();
    paymentBId = uuidv7();
    const { error } = await f.service.from('payments').insert([
      {
        id: paymentAId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        amount: 250.0,
        recorded_by: f.userA.userId,
      },
      {
        id: paymentBId,
        org_id: f.orgB.id,
        project_id: f.extras.orgBProject.id,
        amount: 175.5,
        recorded_by: f.userB.userId,
      },
    ]);
    if (error) throw new Error(`seed payments: ${error.message}`);
  });

  afterAll(async () => {
    await f.service.from('payments').delete().in('id', [paymentAId, paymentBId]);
    await f.cleanup();
  });

  test('User A SELECT sees only Org A payment (cross-org isolation)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'payments',
      { column: 'id', values: [paymentAId, paymentBId] },
      [paymentAId],
      'org A select cross-org isolation',
    );
  });

  test('Soft-deleted payment hidden from org member', async () => {
    await f.service
      .from('payments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', paymentAId);

    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'payments', paymentAId, 'soft-deleted hidden');

    await f.service.from('payments').update({ deleted_at: null }).eq('id', paymentAId);
  });

  test('Anonymous cannot SELECT any payment row', async () => {
    await assertVisibleIds(
      asAnon(),
      'payments',
      { column: 'id', values: [paymentAId, paymentBId] },
      [],
      'anon SELECT blocked',
    );
  });

  test('Org A user cannot INSERT a payment for Org B project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('payments')
      .insert({
        id: newId,
        org_id: f.orgB.id,
        project_id: f.extras.orgBProject.id,
        amount: 50.0,
        recorded_by: f.userA.userId,
      })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('payments')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Org A user cannot UPDATE Org B payment', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('payments')
      .update({ amount: 9999.99 })
      .eq('id', paymentBId)
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('payments')
      .select('amount')
      .eq('id', paymentBId)
      .single();
    expect(Number(check?.amount)).toBe(175.5);
  });

  test('Org A user cannot DELETE Org B payment', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { error } = await c.from('payments').delete().eq('id', paymentBId);
    if (error) {
      expect(error.code).toMatch(/42501|PGRST/);
    }
    const { data: check } = await f.service
      .from('payments')
      .select('id')
      .eq('id', paymentBId);
    expect(check?.[0]?.id).toBe(paymentBId);
  });

  test('Org A user CAN INSERT a payment for their own org/project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { error } = await c.from('payments').insert({
      id: newId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      amount: 99.99,
      recorded_by: f.userA.userId,
    });
    expect(error).toBeNull();

    const { data: check } = await f.service
      .from('payments')
      .select('id')
      .eq('id', newId);
    expect(check?.[0]?.id).toBe(newId);

    await f.service.from('payments').delete().eq('id', newId);
  });

  test('Org A user CANNOT INSERT a payment with recorded_by=Org B user', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('payments')
      .insert({
        id: newId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        amount: 12.0,
        recorded_by: f.userB.userId, // cross-user recorded_by — denied
      })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('payments')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('amount > 0 CHECK rejects non-positive values', async () => {
    const newId = uuidv7();
    const { error } = await f.service.from('payments').insert({
      id: newId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      amount: 0, // CHECK violation
      recorded_by: f.userA.userId,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/payments_amount_positive|check/i);

    const { data: check } = await f.service
      .from('payments')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });
});

describe('payments RLS — stakeholder financial visibility (§14)', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;
  let paymentAId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `pay-stakeholder-${ts}-${rnd}@test.local`;
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
      name: 'Payment Stakeholder',
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

    paymentAId = uuidv7();
    await f.service.from('payments').insert({
      id: paymentAId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      amount: 500.0,
      recorded_by: f.userA.userId,
    });
  });

  afterAll(async () => {
    await f.service.from('payments').delete().eq('id', paymentAId);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('Stakeholder with can_view_financials=true SEES the project payment', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'payments',
      { column: 'id', values: [paymentAId] },
      [paymentAId],
      'full profile sees payment',
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
      'payments',
      { column: 'id', values: [paymentAId] },
      [],
      'progress_only hides payment',
    );

    await f.service
      .from('project_stakeholders')
      .update({ can_view_financials: true, visibility_profile: 'full' })
      .eq('id', stakeholderRowId);
  });

  test('Stakeholder cannot INSERT payments (no stakeholder INSERT policy)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const newId = uuidv7();
    const { data } = await c
      .from('payments')
      .insert({
        id: newId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        amount: 10.0,
        recorded_by: f.userA.userId,
      })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('payments')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Stakeholder cannot UPDATE payments (no stakeholder UPDATE policy)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const { data } = await c
      .from('payments')
      .update({ amount: 9999.99 })
      .eq('id', paymentAId)
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('payments')
      .select('amount')
      .eq('id', paymentAId)
      .single();
    expect(Number(check?.amount)).toBe(500.0);
  });
});
