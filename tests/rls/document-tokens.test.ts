import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { assertVisibleIds } from './_helpers';

// document_tokens RLS (migration 0024 §2.2 + ADR-016):
// All four policies gate on org-membership of the underlying document's
// project. Stakeholders never list tokens (they reach docs via the public
// URL — public-route lookup at /q/[token] uses the pooler, RLS bypassed).
// The public-route security envelope is documented in ADR-034.

describe('document_tokens RLS', () => {
  let f: WorkflowProjectFixture;
  let docAId: string;
  let docBId: string;
  let tokenAId: string;
  let tokenBId: string;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // Seed one quote per org.
    docAId = uuidv7();
    docBId = uuidv7();
    await f.service.from('documents').insert([
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

    // Seed one token per quote.
    tokenAId = uuidv7();
    tokenBId = uuidv7();
    await f.service.from('document_tokens').insert([
      { id: tokenAId, document_id: docAId, document_type: 'quote' },
      { id: tokenBId, document_id: docBId, document_type: 'quote' },
    ]);

    // Seed a stakeholder on Org A's project with can_view_financials=true —
    // tests assert they still can't see token rows.
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `tok-stakeholder-${ts}-${rnd}@test.local`;
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
      name: 'Token Stakeholder',
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
      can_view_financials: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await f.service.from('document_tokens').delete().in('id', [tokenAId, tokenBId]);
    await f.service.from('documents').delete().in('id', [docAId, docBId]);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('User A SELECT sees only Org A token (cross-org isolation)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'document_tokens',
      { column: 'id', values: [tokenAId, tokenBId] },
      [tokenAId],
      'org A token cross-org isolation',
    );
  });

  test('Anonymous cannot SELECT any document_token', async () => {
    await assertVisibleIds(
      asAnon(),
      'document_tokens',
      { column: 'id', values: [tokenAId, tokenBId] },
      [],
      'anon SELECT blocked',
    );
  });

  test('Stakeholder with can_view_financials=true CANNOT see token rows', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'document_tokens',
      { column: 'id', values: [tokenAId, tokenBId] },
      [],
      'stakeholder cannot list tokens',
    );
  });

  test('Org A user CAN INSERT a token for their own org document', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { error } = await c.from('document_tokens').insert({
      id: newId,
      document_id: docAId,
      document_type: 'quote',
    });
    expect(error).toBeNull();

    const { data: check } = await f.service
      .from('document_tokens')
      .select('id')
      .eq('id', newId);
    expect(check?.[0]?.id).toBe(newId);

    await f.service.from('document_tokens').delete().eq('id', newId);
  });

  test('Org A user CANNOT INSERT a token for Org B document', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data } = await c
      .from('document_tokens')
      .insert({ id: newId, document_id: docBId, document_type: 'quote' })
      .select('id');
    expect(data ?? []).toEqual([]);

    const { data: check } = await f.service
      .from('document_tokens')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });
});
