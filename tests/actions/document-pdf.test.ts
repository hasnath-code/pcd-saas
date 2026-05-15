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

// Mock the PDF render to a fake buffer — keeps tests fast and isolates from
// @react-pdf/renderer's Node-stream behavior under vitest.
vi.mock('@/lib/pdf/render', () => ({
  renderDocumentPdf: vi.fn().mockResolvedValue({
    buffer: Buffer.from('%PDF-1.4 fake test pdf bytes'),
    sizeBytes: 30,
    mimeType: 'application/pdf' as const,
  }),
}));

import {
  generateDocumentPdf,
  generateDocumentPdfFromToken,
  invalidateDocumentPdfCache,
} from '@/actions/document-pdf';
import { recordPayment } from '@/actions/payments';
import { reviseReceipt } from '@/actions/documents';
import * as auth from '@/lib/auth/requireAuth';

describe('Session 14 — generateDocumentPdf (org-side)', () => {
  let f: WorkflowProjectFixture;
  let receiptId: string;
  let receiptToken: string;
  let invoiceId: string;
  const generatedFileIds: string[] = [];

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

    // Seed a receipt via the real recordPayment path (so we exercise the
    // tx + token mint paths too).
    const recorded = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 333.33,
    });
    if (!('data' in recorded)) throw new Error('record failed');
    receiptId = recorded.data.receiptId;
    const { data: tok } = await f.service
      .from('document_tokens')
      .select('token')
      .eq('document_id', receiptId)
      .single();
    receiptToken = tok!.token as string;

    // Seed a separate sent invoice for the invoice-PDF test.
    invoiceId = uuidv7();
    await f.service.from('documents').insert({
      id: invoiceId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'invoice',
      status: 'sent',
      document_number: 'TESTPRJ-I777',
      sequence: 777,
      line_items: [{ description: 'Test inv', quantity: 1, unitPrice: 100 }],
      total: 100,
      subtotal: 100,
      vat_amount: 0,
      created_by: f.userA.userId,
      invoice_subtype: 'initial',
      sent_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    // Clean up generated project_files rows + (best-effort) storage objects
    if (generatedFileIds.length > 0) {
      const { data: rows } = await f.service
        .from('project_files')
        .select('id, storage_path')
        .in('id', generatedFileIds);
      if (rows) {
        const paths = rows.map((r) => r.storage_path as string);
        if (paths.length > 0) {
          await f.service.storage.from('org-files').remove(paths);
        }
      }
      await f.service.from('project_files').delete().in('id', generatedFileIds);
    }
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

  test('generateDocumentPdf produces a project_files row with source=document_artifact', async () => {
    const result = await generateDocumentPdf({ documentId: invoiceId });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    expect(result.data.mimeType).toBe('application/pdf');
    expect(result.data.filename).toBe('TESTPRJ-I777.pdf');
    expect(result.data.downloadUrl).toMatch(/^https?:\/\//);

    const { data: rows } = await f.service
      .from('project_files')
      .select('id, source, source_document_id, original_filename, mime_type')
      .eq('source_document_id', invoiceId)
      .is('deleted_at', null);
    expect(rows).toHaveLength(1);
    expect(rows![0].source).toBe('document_artifact');
    expect(rows![0].source_document_id).toBe(invoiceId);
    expect(rows![0].mime_type).toBe('application/pdf');
    generatedFileIds.push(rows![0].id as string);
  });

  test('second call returns the same cached row (idempotent)', async () => {
    // Pre-condition: a row already exists from the previous test.
    const result = await generateDocumentPdf({ documentId: invoiceId });
    expect(result).toMatchObject({ success: true });

    const { data: rows } = await f.service
      .from('project_files')
      .select('id')
      .eq('source_document_id', invoiceId)
      .is('deleted_at', null);
    expect(rows).toHaveLength(1); // still only one cached row
  });

  test('cross-org documentId → not_found', async () => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userB, f.orgB.id, 'owner'),
    );
    const result = await generateDocumentPdf({ documentId: invoiceId });
    expect(result).toMatchObject({ error: 'not_found' });
  });

  test('generateDocumentPdfFromToken (public-side) finds-or-creates by token', async () => {
    const result = await generateDocumentPdfFromToken({ token: receiptToken });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    expect(result.data.mimeType).toBe('application/pdf');

    const { data: rows } = await f.service
      .from('project_files')
      .select('id')
      .eq('source_document_id', receiptId)
      .is('deleted_at', null);
    expect(rows!.length).toBeGreaterThanOrEqual(1);
    rows!.forEach((r) => generatedFileIds.push(r.id as string));
  });

  test('generateDocumentPdfFromToken malformed token → not_found', async () => {
    const result = await generateDocumentPdfFromToken({ token: uuidv7() });
    // uuid v7 is valid format but won't match any row → not_found
    expect(result).toMatchObject({ error: 'not_found' });
  });

  test('invalidateDocumentPdfCache soft-deletes existing rows; next call regenerates', async () => {
    // Cache should be present from earlier tests.
    const { data: pre } = await f.service
      .from('project_files')
      .select('id')
      .eq('source_document_id', invoiceId)
      .is('deleted_at', null);
    expect(pre!.length).toBeGreaterThanOrEqual(1);

    await invalidateDocumentPdfCache(invoiceId);

    const { data: post } = await f.service
      .from('project_files')
      .select('id, deleted_at')
      .eq('source_document_id', invoiceId);
    // No active rows for this document.
    const active = (post ?? []).filter((r) => r.deleted_at === null);
    expect(active).toHaveLength(0);

    // Generating again creates a fresh row.
    const fresh = await generateDocumentPdf({ documentId: invoiceId });
    expect(fresh).toMatchObject({ success: true });
    const { data: again } = await f.service
      .from('project_files')
      .select('id')
      .eq('source_document_id', invoiceId)
      .is('deleted_at', null);
    expect(again).toHaveLength(1);
    again!.forEach((r) => generatedFileIds.push(r.id as string));
  });

  test('reviseReceipt invalidates the cached PDF', async () => {
    // First make sure a cached PDF exists for our seeded receipt.
    await generateDocumentPdf({ documentId: receiptId });
    const { data: pre } = await f.service
      .from('project_files')
      .select('id')
      .eq('source_document_id', receiptId)
      .is('deleted_at', null);
    expect(pre!.length).toBeGreaterThanOrEqual(1);
    pre!.forEach((r) => generatedFileIds.push(r.id as string));

    // Revise it (recipient field). The post-commit invalidation should
    // soft-delete the cached row.
    const revised = await reviseReceipt({
      documentId: receiptId,
      recipientName: 'PDF-cache-invalidation Test Recipient',
      reason: 'pdf cache test',
    });
    expect(revised).toMatchObject({ success: true });

    const { data: post } = await f.service
      .from('project_files')
      .select('id, deleted_at')
      .eq('source_document_id', receiptId);
    const active = (post ?? []).filter((r) => r.deleted_at === null);
    expect(active).toHaveLength(0);
  });
});
