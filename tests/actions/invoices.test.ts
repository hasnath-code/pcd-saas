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
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({
    messageId: 'msg_test',
    emailEventId: null,
  }),
}));
vi.mock('@/lib/notifications/dispatch', () => ({
  dispatchNotification: vi.fn().mockResolvedValue({
    inserted: 0,
    emailDelivered: 0,
    emailFailed: 0,
    pushSmsSkipped: 0,
  }),
}));

import {
  createInvoice,
  reviseInvoice,
  sendInvoice,
  updateInvoiceDraft,
} from '@/actions/documents';
import * as auth from '@/lib/auth/requireAuth';
import * as Sentry from '@sentry/nextjs';
import * as emailMod from '@/lib/email/send';
import * as dispatchMod from '@/lib/notifications/dispatch';

async function documentIdsForProjects(f: WorkflowProjectFixture): Promise<string[]> {
  const { data } = await f.service
    .from('documents')
    .select('id')
    .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
  return (data ?? []).map((r) => r.id as string);
}

async function paymentIdsForProjects(f: WorkflowProjectFixture): Promise<string[]> {
  const { data } = await f.service
    .from('payments')
    .select('id')
    .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
  return (data ?? []).map((r) => r.id as string);
}

describe('actions/documents — createInvoice', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service
      .from('document_tokens')
      .delete()
      .in('document_id', await documentIdsForProjects(f));
    await f.service
      .from('payments')
      .delete()
      .in('id', await paymentIdsForProjects(f));
    await f.service
      .from('documents')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
    vi.mocked(emailMod.sendEmail).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(dispatchMod.dispatchNotification).mockClear();
  });

  test('createInvoice initial happy path with no accepted quote', async () => {
    const result = await createInvoice({
      projectId: f.extras.orgAProject.id,
      subtype: 'initial',
      lineItems: [{ description: 'Deposit', quantity: 1, unitPrice: 200 }],
      vatApplicable: false,
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;

    const { data } = await f.service
      .from('documents')
      .select(
        'status, type, invoice_subtype, document_number, sequence, subtotal, total, revision_number, revision_log_payload',
      )
      .eq('id', result.data.documentId)
      .single();
    expect(data?.status).toBe('draft');
    expect(data?.type).toBe('invoice');
    expect(data?.invoice_subtype).toBe('initial');
    expect(data?.document_number).toMatch(/-I\d+$/);
    expect(Number(data?.subtotal)).toBe(200);
    expect(Number(data?.total)).toBe(200);
    expect(data?.revision_number).toBe(0);
    expect(data?.revision_log_payload).toEqual([]);
  });

  test('createInvoice final without accepted quote → conflict no_accepted_quote', async () => {
    const result = await createInvoice({
      projectId: f.extras.orgAProject.id,
      subtype: 'final',
      lineItems: [{ description: 'Final', quantity: 1, unitPrice: 1000 }],
    });
    expect(result).toMatchObject({
      error: 'conflict',
      reason: 'no_accepted_quote',
    });
  });

  test('createInvoice final WITH accepted quote → happy path', async () => {
    // Seed an accepted quote for the project.
    const acceptedQuoteId = uuidv7();
    await f.service.from('documents').insert({
      id: acceptedQuoteId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-Q-acc`,
      sequence: 88,
      created_by: f.userA.userId,
      total: 2000,
      accepted_at: new Date().toISOString(),
      accepted_by_name: 'Jane Client',
    });

    const result = await createInvoice({
      projectId: f.extras.orgAProject.id,
      subtype: 'final',
      lineItems: [{ description: 'Final', quantity: 1, unitPrice: 2000 }],
    });
    expect(result).toMatchObject({ success: true });

    await f.service.from('documents').delete().eq('id', acceptedQuoteId);
  });

  test('createInvoice cross-org project → not_found', async () => {
    const result = await createInvoice({
      projectId: f.extras.orgBProject.id,
      subtype: 'initial',
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 1 }],
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'project' });
  });

  test('createInvoice empty line items → validation_error', async () => {
    const result = await createInvoice({
      projectId: f.extras.orgAProject.id,
      subtype: 'initial',
      lineItems: [],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('createInvoice missing subtype → validation_error', async () => {
    const result = await createInvoice({
      projectId: f.extras.orgAProject.id,
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 100 }],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });
});

describe('actions/documents — updateInvoiceDraft', () => {
  let f: WorkflowProjectFixture;
  let draftId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    draftId = uuidv7();
    await f.service.from('documents').insert({
      id: draftId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      invoice_subtype: 'initial',
      status: 'draft',
      document_number: `${f.extras.orgAProject.projectNumber}-I1`,
      sequence: 1,
      created_by: f.userA.userId,
      line_items: [{ description: 'old', quantity: 1, unitPrice: 100 }],
      subtotal: 100,
      total: 100,
    });
  });
  afterAll(async () => {
    await f.service.from('documents').delete().eq('id', draftId);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('updateInvoiceDraft happy path recomputes totals', async () => {
    const result = await updateInvoiceDraft({
      documentId: draftId,
      lineItems: [{ description: 'new', quantity: 2, unitPrice: 300 }],
      vatApplicable: true,
    });
    expect(result).toMatchObject({ success: true });
    const { data } = await f.service
      .from('documents')
      .select('subtotal, vat_amount, total')
      .eq('id', draftId)
      .single();
    expect(Number(data?.subtotal)).toBe(600);
    expect(Number(data?.vat_amount)).toBe(120);
    expect(Number(data?.total)).toBe(720);
  });

  test('updateInvoiceDraft on a sent invoice → conflict not_draft', async () => {
    const sentId = uuidv7();
    await f.service.from('documents').insert({
      id: sentId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      invoice_subtype: 'initial',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-I99`,
      sequence: 99,
      created_by: f.userA.userId,
    });
    const result = await updateInvoiceDraft({
      documentId: sentId,
      discountPct: 5,
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_draft' });
    await f.service.from('documents').delete().eq('id', sentId);
  });

  test('updateInvoiceDraft on a quote-type doc → conflict not_an_invoice', async () => {
    const quoteId = uuidv7();
    await f.service.from('documents').insert({
      id: quoteId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'draft',
      document_number: `${f.extras.orgAProject.projectNumber}-Q88`,
      sequence: 88,
      created_by: f.userA.userId,
    });
    const result = await updateInvoiceDraft({
      documentId: quoteId,
      discountPct: 5,
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_an_invoice' });
    await f.service.from('documents').delete().eq('id', quoteId);
  });
});

describe('actions/documents — sendInvoice', () => {
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
      .from('document_tokens')
      .delete()
      .in('document_id', await documentIdsForProjects(f));
    await f.service
      .from('documents')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
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
    vi.mocked(emailMod.sendEmail).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(dispatchMod.dispatchNotification).mockClear();
    vi.mocked(emailMod.sendEmail).mockResolvedValue({
      messageId: 'msg_test',
      emailEventId: null,
    });
  });

  test('sendInvoice happy path flips status, mints token, sends email + dispatches', async () => {
    const created = await createInvoice({
      projectId: f.extras.orgAProject.id,
      subtype: 'initial',
      lineItems: [{ description: 'Deposit', quantity: 1, unitPrice: 500 }],
    });
    if (!('data' in created)) throw new Error('createInvoice failed');
    const documentId = created.data.documentId;

    const result = await sendInvoice({ documentId });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;

    const { data: doc } = await f.service
      .from('documents')
      .select('status, sent_at')
      .eq('id', documentId)
      .single();
    expect(doc?.status).toBe('sent');
    expect(doc?.sent_at).not.toBeNull();

    const { data: token } = await f.service
      .from('document_tokens')
      .select('token, document_type')
      .eq('document_id', documentId)
      .single();
    expect(token?.token).toBe(result.data.token);
    expect(token?.document_type).toBe('invoice');

    expect(vi.mocked(emailMod.sendEmail)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(emailMod.sendEmail).mock.calls[0][0];
    expect(call.template).toBe('invoice-sent');
    expect(call.subject).toMatch(/^Invoice /);

    // Dispatch fan-out for invoice.sent — at least the org owner gets one.
    const invoiceSentDispatches = vi
      .mocked(dispatchMod.dispatchNotification)
      .mock.calls.filter((c) => c[0].eventType === 'invoice.sent');
    expect(invoiceSentDispatches.length).toBeGreaterThan(0);
  });

  test('sendInvoice on non-draft → conflict', async () => {
    const sentId = uuidv7();
    await f.service.from('documents').insert({
      id: sentId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      invoice_subtype: 'initial',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-I-already-sent`,
      sequence: 97,
      created_by: f.userA.userId,
    });
    const result = await sendInvoice({ documentId: sentId });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_draft' });
    await f.service.from('documents').delete().eq('id', sentId);
  });

  test('sendInvoice on a quote → conflict not_an_invoice', async () => {
    const quoteId = uuidv7();
    await f.service.from('documents').insert({
      id: quoteId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'draft',
      document_number: `${f.extras.orgAProject.projectNumber}-Q-other`,
      sequence: 96,
      created_by: f.userA.userId,
    });
    const result = await sendInvoice({ documentId: quoteId });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_an_invoice' });
    await f.service.from('documents').delete().eq('id', quoteId);
  });

  test('sendInvoice isolates email failure to Sentry; document still flips to sent', async () => {
    vi.mocked(emailMod.sendEmail).mockRejectedValueOnce(
      new Error('resend rate limit'),
    );

    const created = await createInvoice({
      projectId: f.extras.orgAProject.id,
      subtype: 'initial',
      lineItems: [{ description: 'Y', quantity: 1, unitPrice: 1 }],
    });
    if (!('data' in created)) throw new Error('createInvoice failed');

    const result = await sendInvoice({ documentId: created.data.documentId });
    expect(result).toMatchObject({ success: true });

    const { data: doc } = await f.service
      .from('documents')
      .select('status')
      .eq('id', created.data.documentId)
      .single();
    expect(doc?.status).toBe('sent');

    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
  });
});

describe('actions/documents — reviseInvoice', () => {
  let f: WorkflowProjectFixture;
  let sentInvoiceId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    sentInvoiceId = uuidv7();
    await f.service.from('documents').insert({
      id: sentInvoiceId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      invoice_subtype: 'initial',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-I-rev`,
      sequence: 50,
      created_by: f.userA.userId,
      line_items: [{ description: 'Survey', quantity: 1, unitPrice: 500 }],
      subtotal: 500,
      vat_amount: 0,
      total: 500,
      vat_applicable: false,
      discount_pct: 0,
    });
  });
  afterAll(async () => {
    await f.service.from('documents').delete().eq('id', sentInvoiceId);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('reviseInvoice mutates row, increments revision_number, appends log', async () => {
    const result = await reviseInvoice({
      documentId: sentInvoiceId,
      lineItems: [{ description: 'Survey', quantity: 1, unitPrice: 750 }],
      reason: 'Additional surveying day required',
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    expect(result.data.revisionNumber).toBe(1);
    expect(result.data.fieldsChanged).toContain('lineItems');

    const { data } = await f.service
      .from('documents')
      .select('total, revision_number, revision_log_payload')
      .eq('id', sentInvoiceId)
      .single();
    expect(Number(data?.total)).toBe(750);
    expect(data?.revision_number).toBe(1);
    const log = data?.revision_log_payload as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0].rev).toBe(1);
    expect(Number(log[0].previous_amount)).toBe(500);
    expect(Number(log[0].new_amount)).toBe(750);
    expect(log[0].reason).toBe('Additional surveying day required');
    expect(log[0].fields_changed).toContain('lineItems');
  });

  test('reviseInvoice no-op resave → conflict no_changes', async () => {
    // Current state of the row from the previous test: 750 total, line item
    // is {Survey, 1, 750}, discount 0, vat off, subtype initial.
    const result = await reviseInvoice({
      documentId: sentInvoiceId,
      lineItems: [{ description: 'Survey', quantity: 1, unitPrice: 750 }],
      reason: 'no-op',
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'no_changes' });
  });

  test('reviseInvoice on a draft → conflict not_sent', async () => {
    const draftId = uuidv7();
    await f.service.from('documents').insert({
      id: draftId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      invoice_subtype: 'initial',
      status: 'draft',
      document_number: `${f.extras.orgAProject.projectNumber}-I-draft-rev`,
      sequence: 51,
      created_by: f.userA.userId,
    });
    const result = await reviseInvoice({
      documentId: draftId,
      discountPct: 5,
      reason: 'why',
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_sent' });
    await f.service.from('documents').delete().eq('id', draftId);
  });

  test('reviseInvoice missing reason → validation_error', async () => {
    const result = await reviseInvoice({
      documentId: sentInvoiceId,
      discountPct: 5,
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('reviseInvoice INTO final without accepted quote → conflict no_accepted_quote', async () => {
    // sentInvoiceId starts at subtype=initial. Revising into final on a
    // project with no accepted quote rejects.
    const result = await reviseInvoice({
      documentId: sentInvoiceId,
      subtype: 'final',
      reason: 'Upgrade to final',
    });
    expect(result).toMatchObject({
      error: 'conflict',
      reason: 'no_accepted_quote',
    });
  });
});
