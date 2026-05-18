import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { listProjectActivity } from '@/db/queries/project-activity';
import { FINANCIAL_EVENT_TYPES } from '@/lib/notifications/events';

// ─── listProjectActivity — financial-event read-time gate (DEBT-066) ──────────
// Financial events (quote/invoice/payment/receipt) are logged with
// visible_to_stakeholders=true — correct for a can_view_financials stakeholder,
// but a progress_only / documents_only stakeholder must not see them. The
// Drizzle pooler bypasses RLS, so listProjectActivity enforces the per-
// stakeholder financial gate explicitly via hasStakeholderFinancialAccess when
// visibleOnly=true. These tests pin that contract at the query layer.

type Attached = { authUserId: string; clientId: string; stakeholderRowId: string };

// Attaches an accepted stakeholder to a project with a given financial-access
// flag. Mirrors tests/actions/files.test.ts:attachStakeholder, parameterised
// on can_view_financials.
async function attachStakeholder(
  f: WorkflowProjectFixture,
  projectId: string,
  canViewFinancials: boolean,
): Promise<Attached> {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  const email = `activity-debt066-${ts}-${rnd}@test.local`;
  const { data: authData, error: authErr } = await f.service.auth.admin.createUser({
    email,
    password: `pwAct-${rnd}-x9X`,
    email_confirm: true,
  });
  if (authErr || !authData.user) {
    throw new Error(`stakeholder auth: ${authErr?.message ?? 'no user'}`);
  }
  const clientId = uuidv7();
  await f.service.from('clients').insert({
    id: clientId,
    auth_user_id: authData.user.id,
    email,
    name: canViewFinancials ? 'Financial Stakeholder' : 'Progress Stakeholder',
  });
  await f.service.from('client_org_memberships').insert({
    id: uuidv7(),
    client_id: clientId,
    org_id: f.orgA.id,
  });
  const stakeholderRowId = uuidv7();
  await f.service.from('project_stakeholders').insert({
    id: stakeholderRowId,
    project_id: projectId,
    client_id: clientId,
    role: canViewFinancials ? 'primary_client' : 'collaborator',
    visibility_profile: canViewFinancials ? 'full' : 'progress_only',
    can_message: true,
    can_upload_files: true,
    can_view_financials: canViewFinancials,
    can_view_drawings: true,
    can_view_schedule: true,
    invited_by: f.userA.userId,
    accepted_at: new Date().toISOString(),
  });
  return { authUserId: authData.user.id, clientId, stakeholderRowId };
}

describe('listProjectActivity — financial-event gate (DEBT-066)', () => {
  let f: WorkflowProjectFixture;
  let financial: Attached;
  let progressOnly: Attached;
  const trackedActivityIds = new Set<string>();
  // Two financial event rows + two non-financial rows, all visible_to_stakeholders.
  const paymentEventId = uuidv7(); // payment.recorded — financial
  const invoiceEventId = uuidv7(); // invoice.sent — financial
  const stageEventId = uuidv7(); // project.stage_changed — non-financial
  const fileEventId = uuidv7(); // file.uploaded — non-financial

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    const projectId = f.extras.orgAProject.id;
    financial = await attachStakeholder(f, projectId, true);
    progressOnly = await attachStakeholder(f, projectId, false);

    await f.service.from('project_activity').insert([
      {
        id: paymentEventId,
        project_id: projectId,
        actor_type: 'system',
        actor_id: null,
        event_type: 'payment.recorded',
        payload: { amount: '400.00' },
        visible_to_stakeholders: true,
      },
      {
        id: invoiceEventId,
        project_id: projectId,
        actor_type: 'system',
        actor_id: null,
        event_type: 'invoice.sent',
        payload: { documentNumber: 'INV-001' },
        visible_to_stakeholders: true,
      },
      {
        id: stageEventId,
        project_id: projectId,
        actor_type: 'system',
        actor_id: null,
        event_type: 'project.stage_changed',
        payload: {},
        visible_to_stakeholders: true,
      },
      {
        id: fileEventId,
        project_id: projectId,
        actor_type: 'system',
        actor_id: null,
        event_type: 'file.uploaded',
        payload: {},
        visible_to_stakeholders: true,
      },
    ]);
    for (const id of [paymentEventId, invoiceEventId, stageEventId, fileEventId]) {
      trackedActivityIds.add(id);
    }
  });

  afterAll(async () => {
    if (trackedActivityIds.size > 0) {
      await f.service
        .from('project_activity')
        .delete()
        .in('id', Array.from(trackedActivityIds));
    }
    await f.service
      .from('project_stakeholders')
      .delete()
      .in('id', [financial.stakeholderRowId, progressOnly.stakeholderRowId]);
    await f.service
      .from('client_org_memberships')
      .delete()
      .in('client_id', [financial.clientId, progressOnly.clientId]);
    await f.service
      .from('clients')
      .delete()
      .in('id', [financial.clientId, progressOnly.clientId]);
    await f.service.auth.admin.deleteUser(financial.authUserId);
    await f.service.auth.admin.deleteUser(progressOnly.authUserId);
    await f.cleanup();
  });

  test('financial-visible stakeholder sees financial activity rows', async () => {
    const rows = await listProjectActivity({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: financial.authUserId,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(paymentEventId);
    expect(ids).toContain(invoiceEventId);
    expect(ids).toContain(stageEventId);
    expect(ids).toContain(fileEventId);
  });

  test('non-financial stakeholder sees no financial rows but keeps the rest', async () => {
    const rows = await listProjectActivity({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: progressOnly.authUserId,
    });
    const ids = rows.map((r) => r.id);
    // Financial events filtered out for a stakeholder without can_view_financials.
    expect(ids).not.toContain(paymentEventId);
    expect(ids).not.toContain(invoiceEventId);
    // Non-financial events remain visible.
    expect(ids).toContain(stageEventId);
    expect(ids).toContain(fileEventId);
    // Belt-and-braces: no financial event_type leaks through, regardless of id.
    const financialSet = new Set<string>(FINANCIAL_EVENT_TYPES);
    for (const r of rows) {
      expect(financialSet.has(r.eventType)).toBe(false);
    }
  });
});
