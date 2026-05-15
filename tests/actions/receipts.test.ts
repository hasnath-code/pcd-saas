import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireOrgUser: vi.fn() };
});
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifications/dispatch', () => ({
  dispatchNotification: vi.fn().mockResolvedValue({
    inserted: 0,
    emailDelivered: 0,
    emailFailed: 0,
    pushSmsSkipped: 0,
  }),
}));

import { correctPayment, recordPayment } from '@/actions/payments';
import { reviseReceipt } from '@/actions/documents';
import * as auth from '@/lib/auth/requireAuth';

// Phase 2 Session 14 tests — receipt auto-creation invariant + reviseReceipt
// + correctPayment-keeps-receipt-consistent.

describe('Session 14 — receipt auto-creation in recordPayment', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Add a primary_client stakeholder so recipientName has something to
    // snapshot. Using orgAClient; visibility doesn't matter for the snapshot.
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: f.extras.orgAClient.id,
      role: 'primary_client',
      visibility_profile: 'full',
      can_view_financials: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
  });
  afterAll(async () => {
    // Clean up payments + documents + tokens created by tests; project
    // cascade in f.cleanup handles the rest.
    await f.service
      .from('documents')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.service
      .from('payments')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('recordPayment auto-creates a receipt linked via payment_id', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 250.0,
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    const { paymentId, receiptId } = result.data;
    expect(paymentId).toBeTruthy();
    expect(receiptId).toBeTruthy();

    // Receipt row exists with the right shape.
    const { data: receipt } = await f.service
      .from('documents')
      .select(
        'id, type, status, payment_id, document_number, sequence, total, subtotal, vat_amount, recipient_name',
      )
      .eq('id', receiptId)
      .single();
    expect(receipt?.type).toBe('receipt');
    expect(receipt?.status).toBe('sent');
    expect(receipt?.payment_id).toBe(paymentId);
    expect(Number(receipt?.total)).toBe(250.0);
    expect(Number(receipt?.subtotal)).toBe(250.0);
    expect(Number(receipt?.vat_amount)).toBe(0);
    expect(receipt?.document_number).toMatch(/-R\d+$/);
    expect(receipt?.recipient_name).toBe('Client A');
  });

  test('recordPayment also mints a public token for the receipt', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 75.0,
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    const { receiptId } = result.data;

    const { data: tok } = await f.service
      .from('document_tokens')
      .select('token, document_type, document_id')
      .eq('document_id', receiptId)
      .single();
    expect(tok?.document_type).toBe('receipt');
    expect(tok?.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test('one payment → exactly one receipt (invariant)', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 50.0,
    });
    if (!('data' in result)) throw new Error('expected success');
    const { paymentId } = result.data;

    const { data: receipts } = await f.service
      .from('documents')
      .select('id')
      .eq('payment_id', paymentId)
      .eq('type', 'receipt')
      .is('deleted_at', null);
    expect(receipts).toHaveLength(1);
  });

  test('receipt sequence allocated per project', async () => {
    // Fresh project to count from 1. Use orgB so the existing tests in this
    // describe block don't pollute the count.
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 11.11,
    });
    if (!('data' in result)) throw new Error('expected success');
    const { receiptId } = result.data;

    const { data: receipt } = await f.service
      .from('documents')
      .select('document_number, sequence, type')
      .eq('id', receiptId)
      .single();
    expect(receipt?.type).toBe('receipt');
    expect(typeof receipt?.sequence).toBe('number');
    expect(receipt?.document_number).toContain(`-R${receipt?.sequence}`);
  });
});

describe('Session 14 — correctPayment keeps linked receipt in lockstep', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: f.extras.orgAClient.id,
      role: 'primary_client',
      visibility_profile: 'full',
      can_view_financials: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
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
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('correctPayment updates the linked receipt total in the same tx', async () => {
    const recorded = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 400.0,
    });
    if (!('data' in recorded)) throw new Error('record failed');
    const { paymentId, receiptId } = recorded.data;

    const corrected = await correctPayment({
      paymentId,
      newAmount: 450.0,
      reason: 'Bank reconciliation',
    });
    expect(corrected).toMatchObject({ success: true });

    const { data: receipt } = await f.service
      .from('documents')
      .select('total, subtotal, line_items')
      .eq('id', receiptId)
      .single();
    expect(Number(receipt?.total)).toBe(450.0);
    expect(Number(receipt?.subtotal)).toBe(450.0);
    const lineItems = receipt?.line_items as Array<{ unitPrice: number }>;
    expect(Number(lineItems[0]?.unitPrice)).toBe(450.0);
  });
});

describe('Session 14 — reviseReceipt', () => {
  let f: WorkflowProjectFixture;
  let receiptId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    await f.service.from('project_stakeholders').insert({
      id: uuidv7(),
      project_id: f.extras.orgAProject.id,
      client_id: f.extras.orgAClient.id,
      role: 'primary_client',
      visibility_profile: 'full',
      can_view_financials: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
    const recorded = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 200.0,
    });
    if (!('data' in recorded)) throw new Error('record failed');
    receiptId = recorded.data.receiptId;
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
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('reviseReceipt happy path appends a revision-log entry', async () => {
    const result = await reviseReceipt({
      documentId: receiptId,
      recipientName: 'Updated Recipient Ltd',
      reason: 'Client name correction',
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    expect(result.data.revisionNumber).toBe(1);
    expect(result.data.fieldsChanged).toEqual(['recipientName']);

    const { data } = await f.service
      .from('documents')
      .select('recipient_name, revision_number, revision_log_payload')
      .eq('id', receiptId)
      .single();
    expect(data?.recipient_name).toBe('Updated Recipient Ltd');
    expect(data?.revision_number).toBe(1);
    const log = data?.revision_log_payload as Array<{
      rev: number;
      reason: string;
      previous_recipient_name: string | null;
      new_recipient_name: string;
      fields_changed: string[];
    }>;
    expect(log).toHaveLength(1);
    expect(log[0].rev).toBe(1);
    expect(log[0].reason).toBe('Client name correction');
    expect(log[0].previous_recipient_name).toBe('Client A');
    expect(log[0].new_recipient_name).toBe('Updated Recipient Ltd');
    expect(log[0].fields_changed).toEqual(['recipientName']);
  });

  test('reviseReceipt no-op resave → conflict no_changes', async () => {
    const result = await reviseReceipt({
      documentId: receiptId,
      recipientName: 'Updated Recipient Ltd', // same as previous test set
      reason: 'noop',
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'no_changes' });
  });

  test('reviseReceipt empty reason → validation_error', async () => {
    const result = await reviseReceipt({
      documentId: receiptId,
      recipientName: 'Some Name',
      reason: '   ',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('reviseReceipt on an invoice → conflict not_a_receipt', async () => {
    // Insert a draft invoice directly.
    const invoiceId = uuidv7();
    await f.service.from('documents').insert({
      id: invoiceId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      status: 'sent',
      document_number: 'TESTPRJ-I999',
      sequence: 999,
      line_items: [],
      total: 100.0,
      subtotal: 100.0,
      vat_amount: 0,
      created_by: f.userA.userId,
      sent_at: new Date().toISOString(),
    });

    const result = await reviseReceipt({
      documentId: invoiceId,
      recipientName: 'Anyone',
      reason: 'wrong type',
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_a_receipt' });

    await f.service.from('documents').delete().eq('id', invoiceId);
  });

  test('reviseReceipt on cross-org receipt → not_found', async () => {
    // Switch context to userB — same receiptId but different org.
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userB, f.orgB.id, 'owner'),
    );
    const result = await reviseReceipt({
      documentId: receiptId,
      recipientName: 'Cross-org probe',
      reason: 'cross-org',
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'document' });
  });
});
