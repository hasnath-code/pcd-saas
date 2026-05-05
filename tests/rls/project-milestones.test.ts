import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

// project_milestones RLS (migration 0011 §11.7):
// - SELECT: org members of the project's org (via auth_user_org_project_ids
//   helper) OR stakeholders with can_view_schedule=true on a milestone marked
//   visible_to_stakeholders=true (via auth_user_stakeholder_project_visibility).
// - ALL (INSERT/UPDATE/DELETE): org members only.
//
// This file verifies the org-side branch + soft-delete + anon block. The
// stakeholder visibility-profile matrix lives in
// tests/rls/projects-stakeholder-visibility.test.ts (commit 3) where the
// fixture wires a clients.auth_user_id link.
describe('project_milestones RLS', () => {
  let f: WorkflowProjectFixture;
  let milestoneAId: string;
  let milestoneBId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    milestoneAId = uuidv7();
    milestoneBId = uuidv7();
    const { error } = await f.service.from('project_milestones').insert([
      {
        id: milestoneAId,
        project_id: f.extras.orgAProject.id,
        label: 'Survey complete',
        visible_to_stakeholders: true,
      },
      {
        id: milestoneBId,
        project_id: f.extras.orgBProject.id,
        label: 'Concept design done',
        visible_to_stakeholders: true,
      },
    ]);
    if (error) throw new Error(`seed project_milestones: ${error.message}`);
  });

  afterAll(async () => {
    await f.service
      .from('project_milestones')
      .delete()
      .in('id', [milestoneAId, milestoneBId]);
    await f.cleanup();
  });

  test('User A SELECT sees only Org A milestone (cross-org isolation)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('project_milestones')
      .select('id')
      .in('id', [milestoneAId, milestoneBId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([milestoneAId]);
  });

  test('Soft-deleted milestone hidden from org member', async () => {
    // Soft-delete via service role.
    const { data: updData, error: delErr } = await f.service
      .from('project_milestones')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', milestoneAId)
      .select('id, deleted_at');
    expect(delErr).toBeNull();
    // Diagnostic: confirm deleted_at actually persisted.
    expect(updData?.[0]?.deleted_at).not.toBeNull();

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('project_milestones')
      .select('id')
      .eq('id', milestoneAId);
    expect(data ?? []).toEqual([]);

    // Restore so test 3 (anon block) can re-check both rows.
    await f.service
      .from('project_milestones')
      .update({ deleted_at: null })
      .eq('id', milestoneAId);
  });

  test('Anonymous cannot SELECT any milestone', async () => {
    const a = asAnon();
    const { data } = await a
      .from('project_milestones')
      .select('id')
      .in('id', [milestoneAId, milestoneBId]);
    expect(data ?? []).toEqual([]);
  });
});
