import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

// Linchpin test for migration 0013: verifies the unstubbed
// auth_user_stakeholder_projects() actually grants project visibility to
// accepted stakeholders, cross-project isolation holds, and the per-stakeholder
// can_view_schedule flag correctly gates milestone visibility per the §14
// visibility profile matrix.
//
// Setup wires a third identity beyond the two-org fixture:
//   - a fresh auth.users row (the "stakeholder")
//   - a clients row with email + auth_user_id linked to the stakeholder
//   - a project_stakeholders row on orgA's project with accepted_at set
// Then signs in as the stakeholder and asserts what they can SELECT.
describe('projects + project_milestones stakeholder visibility (0013 unstub)', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;
  let visibleMilestoneId: string;
  let hiddenMilestoneId: string; // visible_to_stakeholders=false

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // 1. Create stakeholder auth user.
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `stakeholder-${ts}-${rnd}@test.local`;
    const password = `pwSt-${rnd}-x9X`;
    const { data: authData, error: authErr } = await f.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr || !authData.user) {
      throw new Error(`stakeholder auth: ${authErr?.message ?? 'no user'}`);
    }
    stakeholderAuth = { id: authData.user.id, email, password };

    // 2. Create clients row with auth_user_id linked + a membership in orgA so
    //    clients RLS lets the stakeholder self-read their row in any future
    //    diagnostic queries (not used directly here but matches production
    //    invariants).
    stakeholderClientId = uuidv7();
    const { error: clientErr } = await f.service.from('clients').insert({
      id: stakeholderClientId,
      auth_user_id: authData.user.id,
      email,
      name: 'Stakeholder One',
    });
    if (clientErr) throw new Error(`stakeholder client: ${clientErr.message}`);
    const { error: memErr } = await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: stakeholderClientId,
      org_id: f.orgA.id,
    });
    if (memErr) throw new Error(`stakeholder membership: ${memErr.message}`);

    // 3. Create the project_stakeholders row on orgA's project, accepted.
    //    Default visibility_profile='full' (all 5 flags true).
    stakeholderRowId = uuidv7();
    const { error: psErr } = await f.service.from('project_stakeholders').insert({
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
    if (psErr) throw new Error(`project_stakeholders insert: ${psErr.message}`);

    // 4. Two milestones on orgA's project: one client-visible, one not.
    visibleMilestoneId = uuidv7();
    hiddenMilestoneId = uuidv7();
    const { error: msErr } = await f.service.from('project_milestones').insert([
      {
        id: visibleMilestoneId,
        project_id: f.extras.orgAProject.id,
        label: 'Concept signed off',
        visible_to_stakeholders: true,
      },
      {
        id: hiddenMilestoneId,
        project_id: f.extras.orgAProject.id,
        label: 'Internal QA pass',
        visible_to_stakeholders: false,
      },
    ]);
    if (msErr) throw new Error(`milestones insert: ${msErr.message}`);
  });

  afterAll(async () => {
    await f.service
      .from('project_milestones')
      .delete()
      .in('id', [visibleMilestoneId, hiddenMilestoneId]);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('Accepted stakeholder SELECT projects sees orgA project, not orgB (cross-project isolation)', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const { data, error } = await c
      .from('projects')
      .select('id')
      .in('id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([f.extras.orgAProject.id]);
  });

  test('Stakeholder with accepted_at=NULL does NOT see project', async () => {
    // Revoke acceptance via service role.
    await f.service
      .from('project_stakeholders')
      .update({ accepted_at: null })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    const { data } = await c
      .from('projects')
      .select('id')
      .eq('id', f.extras.orgAProject.id);
    expect(data ?? []).toEqual([]);

    // Restore acceptance for subsequent tests.
    await f.service
      .from('project_stakeholders')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', stakeholderRowId);
  });

  test('Visibility profile matrix on project_milestones (per §14)', async () => {
    type Row = {
      profile: string;
      can_view_schedule: boolean;
      shouldSeeVisible: boolean;
    };
    // Per §14 mapping. The negative cases verify the
    // auth_user_stakeholder_project_visibility helper correctly returns the
    // flag value and the policy COALESCEs absence to false.
    const matrix: Row[] = [
      { profile: 'full', can_view_schedule: true, shouldSeeVisible: true },
      { profile: 'progress_only', can_view_schedule: true, shouldSeeVisible: true },
      { profile: 'documents_only', can_view_schedule: false, shouldSeeVisible: false },
      { profile: 'schedule_only', can_view_schedule: true, shouldSeeVisible: true },
      { profile: 'custom', can_view_schedule: false, shouldSeeVisible: false },
    ];

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);

    for (const row of matrix) {
      // Set the stakeholder's flags via service role.
      await f.service
        .from('project_stakeholders')
        .update({
          visibility_profile: row.profile,
          can_view_schedule: row.can_view_schedule,
        })
        .eq('id', stakeholderRowId);

      // Query milestones on the project as the stakeholder.
      const { data } = await c
        .from('project_milestones')
        .select('id')
        .eq('project_id', f.extras.orgAProject.id);
      const seenIds = (data ?? []).map((r) => r.id);

      if (row.shouldSeeVisible) {
        expect(seenIds, `profile=${row.profile} should see visible milestone`).toContain(
          visibleMilestoneId,
        );
      } else {
        expect(seenIds, `profile=${row.profile} should NOT see visible milestone`).not.toContain(
          visibleMilestoneId,
        );
      }
      // Hidden milestone (visible_to_stakeholders=false) is never visible to
      // any stakeholder profile, regardless of can_view_schedule.
      expect(seenIds, `profile=${row.profile} must never see hidden milestone`).not.toContain(
        hiddenMilestoneId,
      );
    }
  });
});
