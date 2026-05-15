import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import {
  hasStakeholderFinancialAccess,
  listInvoicesForProject,
  listReceiptsForProject,
} from '@/db/queries/documents';
import { getPaymentsForProject } from '@/db/queries/payments';

// Phase 2 Session 14 — defense-in-depth verification of the
// hasStakeholderFinancialAccess gate + the visibleOnly: true / stakeholder
// branches on the financial queries. Mirrors the DEBT-059 / DEBT-R006 pattern
// from db/queries/files.ts:listFilesForProject.

describe('Session 14 — portal-side financial visibility', () => {
  let f: WorkflowProjectFixture;
  // We seed two stakeholder identities on orgA's project, plus one stakeholder
  // on orgB's project for cross-org isolation testing.
  let financialStakeholderAuthUserId: string;
  let progressOnlyStakeholderAuthUserId: string;
  let orgBStakeholderAuthUserId: string;

  let invoiceId: string;
  let paymentId: string;
  let receiptId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();

    // Create three auth users + clients backed by them. Client.auth_user_id
    // is the join the gate looks up.
    async function makeStakeholder(
      orgId: string,
      projectId: string,
      flags: { canViewFinancials: boolean },
      label: string,
    ): Promise<string> {
      const ts = Date.now();
      const rnd = Math.random().toString(36).slice(2, 8);
      const email = `s14-stake-${label}-${ts}-${rnd}@test.local`;
      const { data: au } = await f.service.auth.admin.createUser({
        email,
        password: 'test-pass-1234',
        email_confirm: true,
      });
      const authUserId = au!.user!.id;

      const clientId = uuidv7();
      await f.service.from('clients').insert({
        id: clientId,
        email,
        name: `S14 Stakeholder ${label}`,
        auth_user_id: authUserId,
      });
      await f.service.from('client_org_memberships').insert({
        id: uuidv7(),
        client_id: clientId,
        org_id: orgId,
      });
      await f.service.from('project_stakeholders').insert({
        id: uuidv7(),
        project_id: projectId,
        client_id: clientId,
        role: 'collaborator',
        visibility_profile: flags.canViewFinancials ? 'full' : 'progress_only',
        can_view_financials: flags.canViewFinancials,
        can_view_drawings: true,
        can_view_schedule: true,
        invited_by: orgId === f.orgA.id ? f.userA.userId : f.userB.userId,
        accepted_at: new Date().toISOString(),
      });
      return authUserId;
    }

    financialStakeholderAuthUserId = await makeStakeholder(
      f.orgA.id,
      f.extras.orgAProject.id,
      { canViewFinancials: true },
      'fin',
    );
    progressOnlyStakeholderAuthUserId = await makeStakeholder(
      f.orgA.id,
      f.extras.orgAProject.id,
      { canViewFinancials: false },
      'noprog',
    );
    orgBStakeholderAuthUserId = await makeStakeholder(
      f.orgB.id,
      f.extras.orgBProject.id,
      { canViewFinancials: true },
      'orgb',
    );

    // Seed one sent invoice + one payment + receipt on orgA's project.
    invoiceId = uuidv7();
    await f.service.from('documents').insert({
      id: invoiceId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      status: 'sent',
      document_number: 'TESTPRJ-PORTAL-I1',
      sequence: 1,
      line_items: [{ description: 'Item', quantity: 1, unitPrice: 500 }],
      total: 500,
      subtotal: 500,
      vat_amount: 0,
      created_by: f.userA.userId,
      invoice_subtype: 'initial',
      sent_at: new Date().toISOString(),
    });

    paymentId = uuidv7();
    await f.service.from('payments').insert({
      id: paymentId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      amount: 500,
      recorded_by: f.userA.userId,
    });

    receiptId = uuidv7();
    await f.service.from('documents').insert({
      id: receiptId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'receipt',
      status: 'sent',
      document_number: 'TESTPRJ-PORTAL-R1',
      sequence: 1,
      line_items: [
        { description: 'Payment received', quantity: 1, unitPrice: 500 },
      ],
      total: 500,
      subtotal: 500,
      vat_amount: 0,
      created_by: f.userA.userId,
      payment_id: paymentId,
      sent_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await f.service
      .from('documents')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.service
      .from('payments')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    // Delete stakeholder rows + clients + memberships + auth users.
    for (const projectId of [
      f.extras.orgAProject.id,
      f.extras.orgBProject.id,
    ]) {
      const { data: stakeRows } = await f.service
        .from('project_stakeholders')
        .select('client_id')
        .eq('project_id', projectId);
      const clientIds = (stakeRows ?? []).map((r) => r.client_id as string);
      if (clientIds.length > 0) {
        const { data: clientRows } = await f.service
          .from('clients')
          .select('id, auth_user_id')
          .in('id', clientIds);
        const authIds = (clientRows ?? [])
          .map((c) => c.auth_user_id as string | null)
          .filter((a): a is string => a !== null);

        await f.service
          .from('project_stakeholders')
          .delete()
          .eq('project_id', projectId);
        await f.service
          .from('client_org_memberships')
          .delete()
          .in('client_id', clientIds);
        await f.service.from('clients').delete().in('id', clientIds);
        for (const authId of authIds) {
          try {
            await f.service.auth.admin.deleteUser(authId);
          } catch {
            // ignore — best-effort
          }
        }
      }
    }
    await f.cleanup();
  });

  test('hasStakeholderFinancialAccess: true for can_view_financials=true', async () => {
    const ok = await hasStakeholderFinancialAccess({
      projectId: f.extras.orgAProject.id,
      authUserId: financialStakeholderAuthUserId,
    });
    expect(ok).toBe(true);
  });

  test('hasStakeholderFinancialAccess: false for can_view_financials=false', async () => {
    const ok = await hasStakeholderFinancialAccess({
      projectId: f.extras.orgAProject.id,
      authUserId: progressOnlyStakeholderAuthUserId,
    });
    expect(ok).toBe(false);
  });

  test('hasStakeholderFinancialAccess: false for cross-org stakeholder', async () => {
    const ok = await hasStakeholderFinancialAccess({
      projectId: f.extras.orgAProject.id,
      authUserId: orgBStakeholderAuthUserId,
    });
    expect(ok).toBe(false);
  });

  test('listInvoicesForProject(visibleOnly=true) returns rows for financial-stakeholder', async () => {
    const rows = await listInvoicesForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: financialStakeholderAuthUserId,
    });
    expect(rows.some((r) => r.id === invoiceId)).toBe(true);
  });

  test('listInvoicesForProject(visibleOnly=true) returns [] for progress-only stakeholder', async () => {
    const rows = await listInvoicesForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: progressOnlyStakeholderAuthUserId,
    });
    expect(rows).toEqual([]);
  });

  test('listInvoicesForProject(visibleOnly=true) returns [] without stakeholderAuthUserId', async () => {
    const rows = await listInvoicesForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
    });
    expect(rows).toEqual([]);
  });

  test('listReceiptsForProject(visibleOnly=true) returns rows for financial-stakeholder', async () => {
    const rows = await listReceiptsForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: financialStakeholderAuthUserId,
    });
    expect(rows.some((r) => r.id === receiptId)).toBe(true);
  });

  test('listReceiptsForProject(visibleOnly=true) returns [] for progress-only stakeholder', async () => {
    const rows = await listReceiptsForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: progressOnlyStakeholderAuthUserId,
    });
    expect(rows).toEqual([]);
  });

  test('getPaymentsForProject(visibleOnly=true) returns rows + total for financial-stakeholder', async () => {
    const result = await getPaymentsForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: financialStakeholderAuthUserId,
    });
    expect(result.runningTotal).toBe(500);
    expect(result.rows.some((r) => r.id === paymentId)).toBe(true);
  });

  test('getPaymentsForProject(visibleOnly=true) returns []/0 for progress-only stakeholder', async () => {
    const result = await getPaymentsForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: progressOnlyStakeholderAuthUserId,
    });
    expect(result.rows).toEqual([]);
    expect(result.runningTotal).toBe(0);
  });

  test('getPaymentsForProject(visibleOnly=true) returns []/0 for cross-org stakeholder', async () => {
    const result = await getPaymentsForProject({
      projectId: f.extras.orgAProject.id,
      visibleOnly: true,
      stakeholderAuthUserId: orgBStakeholderAuthUserId,
    });
    expect(result.rows).toEqual([]);
    expect(result.runningTotal).toBe(0);
  });
});
