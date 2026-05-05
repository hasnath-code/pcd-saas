import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

// project_stakeholders RLS (migration 0010 §11.6):
// - SELECT: org members of the project's org OR the stakeholder themselves
//   (matched by client_id via auth_user_client_ids() from 0007).
// - ALL (INSERT/UPDATE/DELETE): org members of the project's org only.
//   Stakeholders cannot self-modify their visibility flags or role.
describe('project_stakeholders RLS', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAId: string;
  let stakeholderBId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Seed one stakeholder per org's project. Note acceptedAt is NULL —
    // org-side visibility doesn't depend on acceptance, only modify rights do.
    stakeholderAId = uuidv7();
    stakeholderBId = uuidv7();
    const { error } = await f.service.from('project_stakeholders').insert([
      {
        id: stakeholderAId,
        project_id: f.extras.orgAProject.id,
        client_id: f.extras.orgAClient.id,
        role: 'primary_client',
        visibility_profile: 'full',
        invited_by: f.userA.userId,
      },
      {
        id: stakeholderBId,
        project_id: f.extras.orgBProject.id,
        client_id: f.extras.orgBClient.id,
        role: 'primary_client',
        visibility_profile: 'full',
        invited_by: f.userB.userId,
      },
    ]);
    if (error) throw new Error(`seed project_stakeholders: ${error.message}`);
  });

  afterAll(async () => {
    await f.service
      .from('project_stakeholders')
      .delete()
      .in('id', [stakeholderAId, stakeholderBId]);
    await f.cleanup();
  });

  test('User A SELECT sees only Org A stakeholder (cross-org isolation)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('project_stakeholders')
      .select('id, project_id')
      .in('id', [stakeholderAId, stakeholderBId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([stakeholderAId]);
  });

  test('User A cannot UPDATE Org B stakeholder visibility flags', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('project_stakeholders')
      .update({ can_view_financials: true })
      .eq('id', stakeholderBId)
      .select();
    // RLS modify policy filters out the row → empty array, no error.
    expect(data ?? []).toEqual([]);

    // Service-role re-read confirms the flag is unchanged.
    const { data: verify } = await f.service
      .from('project_stakeholders')
      .select('can_view_financials')
      .eq('id', stakeholderBId)
      .single();
    expect(verify?.can_view_financials).toBe(false);
  });

  test('Anonymous cannot SELECT any project_stakeholders row', async () => {
    const a = asAnon();
    const { data } = await a
      .from('project_stakeholders')
      .select('id')
      .in('id', [stakeholderAId, stakeholderBId]);
    expect(data ?? []).toEqual([]);
  });
});
