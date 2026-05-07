import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

// Session 8 — RLS coverage specific to the stage-transition write path.
// The general projects RLS suite (tests/rls/projects.test.ts) already proves
// that org members can UPDATE and that cross-org UPDATEs are silently filtered.
// These tests focus on the column we now mutate (current_stage_id) so the
// suite explicitly proves the new use case is gated correctly.
//
// Stakeholder write blocks aren't exercised here because they're enforced by
// the projects_update_org_members policy which restricts writes to is_org_member
// (stakeholders are not org members; they're clients). That branch is covered
// by tests/rls/projects-stakeholder-visibility.test.ts indirectly.

describe('projects RLS — stage transitions', () => {
  let f: WorkflowProjectFixture;
  let secondStageId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    const { data } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', f.extras.orgAWorkflow.id)
      .eq('position', 2)
      .single();
    secondStageId = data!.id as string;
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('Org A owner CAN UPDATE current_stage_id on own project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('projects')
      .update({ current_stage_id: secondStageId })
      .eq('id', f.extras.orgAProject.id)
      .select('id, current_stage_id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].current_stage_id).toBe(secondStageId);

    // Reset for the next test.
    await f.service
      .from('projects')
      .update({ current_stage_id: f.extras.orgAWorkflow.firstStageId })
      .eq('id', f.extras.orgAProject.id);
  });

  test('Org A owner cannot UPDATE current_stage_id on Org B project', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    // Pick any Org B stage as target.
    const { data: orgBStages } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', f.extras.orgBWorkflow.id)
      .limit(1);
    const target = orgBStages?.[0]?.id;
    expect(target).toBeDefined();

    const { data } = await c
      .from('projects')
      .update({ current_stage_id: target! })
      .eq('id', f.extras.orgBProject.id)
      .select();
    expect(data ?? []).toEqual([]);
    // Service-role: stage unchanged.
    const { data: project } = await f.service
      .from('projects')
      .select('current_stage_id')
      .eq('id', f.extras.orgBProject.id)
      .single();
    expect(project?.current_stage_id).toBe(f.extras.orgBWorkflow.firstStageId);
  });

  test('After service-role stage UPDATE, the row remains visible to org members via SELECT', async () => {
    // Regression: prove the projects_select_org_or_stakeholder policy doesn't
    // filter the row based on stage_id (it only checks org_id + deleted_at +
    // stakeholder visibility).
    await f.service
      .from('projects')
      .update({ current_stage_id: secondStageId })
      .eq('id', f.extras.orgAProject.id);

    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('projects')
      .select('id, current_stage_id')
      .eq('id', f.extras.orgAProject.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].current_stage_id).toBe(secondStageId);

    // Reset.
    await f.service
      .from('projects')
      .update({ current_stage_id: f.extras.orgAWorkflow.firstStageId })
      .eq('id', f.extras.orgAProject.id);
  });
});
