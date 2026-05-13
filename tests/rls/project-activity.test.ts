import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { assertNotVisible, assertVisibleIds } from './_helpers';

// project_activity RLS (migration 0022 §12.7 + §14):
// - SELECT: org members of the project's org always see all rows; accepted
//   stakeholders see ONLY visible_to_stakeholders=true rows.
//   Uses auth_user_org_project_ids() + EXISTS against
//   auth_user_stakeholder_project_visibility().
// - INSERT / UPDATE / DELETE: no authenticated policy and not GRANTed.
//   Server actions write via the Drizzle pooler inside the same transaction
//   as the action they describe (Hard Rule 6).
//
// visible_to_stakeholders is the activity-side analogue of
// project_files.visibility — independent of the 5 visibility flags.

describe('project_activity RLS — org-side', () => {
  let f: WorkflowProjectFixture;
  let activityAVisibleId: string;
  let activityAInternalId: string;
  let activityBId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    activityAVisibleId = uuidv7();
    activityAInternalId = uuidv7();
    activityBId = uuidv7();

    const { error } = await f.service.from('project_activity').insert([
      {
        id: activityAVisibleId,
        project_id: f.extras.orgAProject.id,
        actor_type: 'user',
        actor_id: f.userA.userId,
        event_type: 'project.stage_changed',
        payload: { to_stage_name: 'Site Survey' },
        visible_to_stakeholders: true,
      },
      {
        id: activityAInternalId,
        project_id: f.extras.orgAProject.id,
        actor_type: 'user',
        actor_id: f.userA.userId,
        event_type: 'stakeholder.added_to_project',
        payload: { stakeholder_email: 'redacted@test.local' },
        visible_to_stakeholders: false,
      },
      {
        id: activityBId,
        project_id: f.extras.orgBProject.id,
        actor_type: 'user',
        actor_id: f.userB.userId,
        event_type: 'project.stage_changed',
        payload: { to_stage_name: 'Drafting' },
        visible_to_stakeholders: true,
      },
    ]);
    if (error) throw new Error(`seed project_activity: ${error.message}`);
  });

  afterAll(async () => {
    await f.service
      .from('project_activity')
      .delete()
      .in('id', [activityAVisibleId, activityAInternalId, activityBId]);
    await f.cleanup();
  });

  test('Org A user sees ALL Org A activity rows (visible + internal); NOT Org B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'project_activity',
      {
        column: 'id',
        values: [activityAVisibleId, activityAInternalId, activityBId],
      },
      [activityAVisibleId, activityAInternalId],
      'org member sees own-org rows regardless of visible_to_stakeholders; cross-org blocked',
    );
  });

  test('Anonymous cannot SELECT any activity row', async () => {
    await assertVisibleIds(
      asAnon(),
      'project_activity',
      {
        column: 'id',
        values: [activityAVisibleId, activityAInternalId, activityBId],
      },
      [],
      'anon SELECT blocked',
    );
  });

  test('Authenticated user cannot INSERT into project_activity (no policy + no GRANT)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data, error } = await c
      .from('project_activity')
      .insert({
        id: newId,
        project_id: f.extras.orgAProject.id,
        actor_type: 'user',
        actor_id: f.userA.userId,
        event_type: 'message.new',
        payload: {},
      })
      .select('id');
    expect(data ?? []).toEqual([]);
    if (error) {
      expect(error.code).toMatch(/42501|PGRST/);
    }

    const { data: check } = await f.service
      .from('project_activity')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Authenticated user cannot DELETE a project_activity row (no policy + no GRANT)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('project_activity')
      .delete()
      .eq('id', activityAVisibleId)
      .select('id');
    expect(data ?? []).toEqual([]);
    if (error) {
      expect(error.code).toMatch(/42501|PGRST/);
    }

    // Row still present.
    const { data: check } = await f.service
      .from('project_activity')
      .select('id')
      .eq('id', activityAVisibleId);
    expect(check?.length).toBe(1);
  });
});

describe('project_activity RLS — stakeholder visibility gating', () => {
  let f: WorkflowProjectFixture;
  let stakeholderAuth: { id: string; email: string; password: string };
  let stakeholderClientId: string;
  let stakeholderRowId: string;
  let visibleActivityId: string;
  let internalActivityId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // Create stakeholder auth + clients row + project_stakeholders link on Org A's project.
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `pa-stakeholder-${ts}-${rnd}@test.local`;
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
      name: 'Activity Stakeholder',
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

    visibleActivityId = uuidv7();
    internalActivityId = uuidv7();
    await f.service.from('project_activity').insert([
      {
        id: visibleActivityId,
        project_id: f.extras.orgAProject.id,
        actor_type: 'user',
        actor_id: f.userA.userId,
        event_type: 'file.uploaded',
        payload: { filename: 'survey.pdf' },
        visible_to_stakeholders: true,
      },
      {
        id: internalActivityId,
        project_id: f.extras.orgAProject.id,
        actor_type: 'user',
        actor_id: f.userA.userId,
        event_type: 'stakeholder.added_to_project',
        payload: { redacted: true },
        visible_to_stakeholders: false,
      },
    ]);
  });

  afterAll(async () => {
    await f.service
      .from('project_activity')
      .delete()
      .in('id', [visibleActivityId, internalActivityId]);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderRowId);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', stakeholderClientId);
    await f.service.from('clients').delete().eq('id', stakeholderClientId);
    await f.service.auth.admin.deleteUser(stakeholderAuth.id);
    await f.cleanup();
  });

  test('Accepted stakeholder sees visible_to_stakeholders=true rows', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'project_activity',
      { column: 'id', values: [visibleActivityId, internalActivityId] },
      [visibleActivityId],
      'stakeholder sees only visible rows',
    );
  });

  test('Accepted stakeholder does NOT see visible_to_stakeholders=false rows', async () => {
    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertNotVisible(c, 'project_activity', internalActivityId);
  });

  test('Pending stakeholder (accepted_at IS NULL) sees nothing', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ accepted_at: null })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertVisibleIds(
      c,
      'project_activity',
      { column: 'id', values: [visibleActivityId, internalActivityId] },
      [],
      'pending stakeholder sees nothing',
    );

    // Restore.
    await f.service
      .from('project_stakeholders')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', stakeholderRowId);
  });

  test('Soft-deleted stakeholder loses access', async () => {
    await f.service
      .from('project_stakeholders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', stakeholderRowId);

    const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
    await assertNotVisible(c, 'project_activity', visibleActivityId);

    // Restore.
    await f.service
      .from('project_stakeholders')
      .update({ deleted_at: null })
      .eq('id', stakeholderRowId);
  });

  test('Dual-context auth (users row + clients row on same auth identity) — org branch wins', async () => {
    // User A also has a clients row attached to their auth user, but no
    // project_stakeholders link on Org B. The org-branch check
    // (auth_user_org_project_ids) returns Org A's projects, so User A sees
    // Org A activity unconditionally (including internal rows). They still
    // can't see Org B activity — they're not a stakeholder there either.
    const dualClientId = uuidv7();
    const rnd = Math.random().toString(36).slice(2, 10);
    await f.service.from('clients').insert({
      id: dualClientId,
      auth_user_id: f.userA.authUserId,
      email: `dual-${rnd}@test.local`,
      name: 'Dual A',
    });

    try {
      const c = await asUser(f.userA.email, f.userA.password);
      // Org A internal row visible via org-branch (despite User A having a
      // clients row that would otherwise restrict via the stakeholder branch).
      await assertVisibleIds(
        c,
        'project_activity',
        { column: 'id', values: [visibleActivityId, internalActivityId] },
        [visibleActivityId, internalActivityId],
        'dual-context: org branch wins over stakeholder branch',
      );
    } finally {
      await f.service.from('clients').delete().eq('id', dualClientId);
    }
  });
});
