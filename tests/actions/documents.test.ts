import {
  afterAll,
  afterEach,
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
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'msg_test', emailEventId: null }),
}));

import {
  acceptQuote,
  createQuote,
  sendQuote,
  updateQuoteDraft,
} from '@/actions/documents';
import * as auth from '@/lib/auth/requireAuth';
import * as Sentry from '@sentry/nextjs';
import * as emailMod from '@/lib/email/send';

describe('actions/documents — createQuote', () => {
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
  });

  test('createQuote happy path inserts a draft with totals', async () => {
    const result = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [
        { description: 'Survey', quantity: 1, unitPrice: 500 },
        { description: 'Drawings', quantity: 2, unitPrice: 250 },
      ],
      discountPct: 10,
      vatApplicable: true,
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;
    const documentId = result.data.documentId;

    const { data } = await f.service
      .from('documents')
      .select(
        'status, type, document_number, sequence, subtotal, vat_amount, total, discount_pct, vat_applicable',
      )
      .eq('id', documentId)
      .single();
    expect(data?.status).toBe('draft');
    expect(data?.type).toBe('quote');
    expect(data?.document_number).toMatch(/-Q\d+$/);
    expect(Number(data?.subtotal)).toBe(1000);
    // subtotal 1000, discount 10% = 100, discounted = 900, VAT = 180, total = 1080
    expect(Number(data?.vat_amount)).toBe(180);
    expect(Number(data?.total)).toBe(1080);
    expect(Number(data?.discount_pct)).toBe(10);
    expect(data?.vat_applicable).toBe(true);
  });

  test('createQuote cross-org project → not_found', async () => {
    const result = await createQuote({
      projectId: f.extras.orgBProject.id,
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 1 }],
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'project' });
  });

  test('createQuote empty line items → validation_error', async () => {
    const result = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('createQuote sequential calls allocate distinct numbers', async () => {
    const a = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [{ description: 'A', quantity: 1, unitPrice: 100 }],
    });
    const b = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [{ description: 'B', quantity: 1, unitPrice: 100 }],
    });
    if (!('data' in a) || !('data' in b)) throw new Error('expected success');
    expect(a.data.documentNumber).not.toBe(b.data.documentNumber);
  });
});

describe('actions/documents — updateQuoteDraft', () => {
  let f: WorkflowProjectFixture;
  let draftId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    draftId = uuidv7();
    await f.service.from('documents').insert({
      id: draftId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'draft',
      document_number: `${f.extras.orgAProject.projectNumber}-Q1`,
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

  test('updateQuoteDraft happy path recomputes totals', async () => {
    const result = await updateQuoteDraft({
      documentId: draftId,
      lineItems: [{ description: 'new', quantity: 2, unitPrice: 300 }],
      discountPct: 0,
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

  test('updateQuoteDraft on a sent quote → conflict not_draft', async () => {
    const sentId = uuidv7();
    await f.service.from('documents').insert({
      id: sentId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-Q99`,
      sequence: 99,
      created_by: f.userA.userId,
    });
    const result = await updateQuoteDraft({
      documentId: sentId,
      discountPct: 5,
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_draft' });
    await f.service.from('documents').delete().eq('id', sentId);
  });

  test('updateQuoteDraft on non-existent doc → not_found', async () => {
    const result = await updateQuoteDraft({
      documentId: uuidv7(),
      discountPct: 5,
    });
    expect(result).toMatchObject({ error: 'not_found' });
  });
});

describe('actions/documents — sendQuote', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Need an accepted primary_client stakeholder to receive the email.
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
    vi.mocked(emailMod.sendEmail).mockResolvedValue({
      messageId: 'msg_test',
      emailEventId: null,
    });
  });

  test('sendQuote happy path flips status, mints token, sends email post-commit', async () => {
    const created = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [{ description: 'Survey', quantity: 1, unitPrice: 500 }],
    });
    if (!('data' in created)) throw new Error('createQuote failed');
    const documentId = created.data.documentId;

    const result = await sendQuote({ documentId });
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
    expect(token?.document_type).toBe('quote');

    expect(vi.mocked(emailMod.sendEmail)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(emailMod.sendEmail).mock.calls[0][0];
    expect(call.template).toBe('quote-sent');
    expect(call.subject).toMatch(/^Quote /);
  });

  test('sendQuote on non-draft → conflict', async () => {
    const sentId = uuidv7();
    await f.service.from('documents').insert({
      id: sentId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-Q97`,
      sequence: 97,
      created_by: f.userA.userId,
    });
    const result = await sendQuote({ documentId: sentId });
    expect(result).toMatchObject({ error: 'conflict', reason: 'not_draft' });
    await f.service.from('documents').delete().eq('id', sentId);
  });

  test('sendQuote isolates email failure to Sentry; document still flips to sent', async () => {
    vi.mocked(emailMod.sendEmail).mockRejectedValueOnce(
      new Error('resend rate limit'),
    );

    const created = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 1 }],
    });
    if (!('data' in created)) throw new Error('createQuote failed');
    const documentId = created.data.documentId;

    const result = await sendQuote({ documentId });
    // Domain mutation must still succeed (ADR-033).
    expect(result).toMatchObject({ success: true });

    const { data: doc } = await f.service
      .from('documents')
      .select('status')
      .eq('id', documentId)
      .single();
    expect(doc?.status).toBe('sent');

    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
  });
});

describe('actions/documents — acceptQuote (ADR-034 token-authorized public write)', () => {
  let f: WorkflowProjectFixture;
  let sentDocId: string;
  let sentToken: string;
  let draftDocId: string;
  let draftToken: string;
  let voidDocId: string;
  let voidToken: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    vi.mocked(emailMod.sendEmail).mockResolvedValue({
      messageId: 'msg_test',
      emailEventId: null,
    });

    // Seed three quotes — sent, draft, void — and a token for each.
    sentDocId = uuidv7();
    draftDocId = uuidv7();
    voidDocId = uuidv7();
    await f.service.from('documents').insert([
      {
        id: sentDocId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        type: 'quote',
        status: 'sent',
        document_number: `${f.extras.orgAProject.projectNumber}-Q-sent`,
        sequence: 101,
        created_by: f.userA.userId,
      },
      {
        id: draftDocId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        type: 'quote',
        status: 'draft',
        document_number: `${f.extras.orgAProject.projectNumber}-Q-draft`,
        sequence: 102,
        created_by: f.userA.userId,
      },
      {
        id: voidDocId,
        org_id: f.orgA.id,
        project_id: f.extras.orgAProject.id,
        type: 'quote',
        status: 'void',
        document_number: `${f.extras.orgAProject.projectNumber}-Q-void`,
        sequence: 103,
        created_by: f.userA.userId,
      },
    ]);

    // Insert tokens and read back the DB-generated values.
    const { data: tokens } = await f.service
      .from('document_tokens')
      .insert([
        { id: uuidv7(), document_id: sentDocId, document_type: 'quote' },
        { id: uuidv7(), document_id: draftDocId, document_type: 'quote' },
        { id: uuidv7(), document_id: voidDocId, document_type: 'quote' },
      ])
      .select('document_id, token');

    const map = new Map((tokens ?? []).map((t) => [t.document_id, t.token]));
    sentToken = map.get(sentDocId)!;
    draftToken = map.get(draftDocId)!;
    voidToken = map.get(voidDocId)!;
  });
  afterAll(async () => {
    await f.service
      .from('document_tokens')
      .delete()
      .in('document_id', [sentDocId, draftDocId, voidDocId]);
    await f.service
      .from('documents')
      .delete()
      .in('id', [sentDocId, draftDocId, voidDocId]);
    await f.cleanup();
  });

  test('acceptQuote on a sent quote flips accepted_at and accepted_by_name', async () => {
    const result = await acceptQuote({
      token: sentToken,
      acceptedByName: 'Jane Doe',
    });
    expect(result).toMatchObject({
      success: true,
      data: { documentId: sentDocId, alreadyAccepted: false },
    });

    const { data } = await f.service
      .from('documents')
      .select('accepted_at, accepted_by_name, status')
      .eq('id', sentDocId)
      .single();
    expect(data?.accepted_at).not.toBeNull();
    expect(data?.accepted_by_name).toBe('Jane Doe');
    // Status stays 'sent' — acceptance is a boolean flip, not a status value.
    expect(data?.status).toBe('sent');
  });

  test('acceptQuote replayed on the same quote is an idempotent no-op', async () => {
    const result = await acceptQuote({
      token: sentToken,
      acceptedByName: 'Different Name',
    });
    expect(result).toMatchObject({
      success: true,
      data: { alreadyAccepted: true },
    });

    // Name on the row is the FIRST accept's value — second call did not
    // overwrite (idempotent).
    const { data } = await f.service
      .from('documents')
      .select('accepted_by_name')
      .eq('id', sentDocId)
      .single();
    expect(data?.accepted_by_name).toBe('Jane Doe');
  });

  test('acceptQuote on a draft → conflict cannot_accept_draft', async () => {
    const result = await acceptQuote({
      token: draftToken,
      acceptedByName: 'Whoever',
    });
    expect(result).toMatchObject({
      error: 'conflict',
      reason: 'cannot_accept_draft',
    });
  });

  test('acceptQuote on a void quote → conflict cannot_accept_void', async () => {
    const result = await acceptQuote({
      token: voidToken,
      acceptedByName: 'Whoever',
    });
    expect(result).toMatchObject({
      error: 'conflict',
      reason: 'cannot_accept_void',
    });
  });

  test('acceptQuote with random non-existent token → not_found', async () => {
    const result = await acceptQuote({
      token: uuidv7(),
      acceptedByName: 'Whoever',
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'token' });
  });

  test('acceptQuote with non-UUID token → validation_error', async () => {
    const result = await acceptQuote({
      token: 'not-a-uuid',
      acceptedByName: 'Whoever',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('acceptQuote with empty acceptedByName → validation_error', async () => {
    const result = await acceptQuote({
      token: sentToken,
      acceptedByName: '   ',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });
});

// Helper: collect all document_ids attached to the fixture's projects (for
// teardown). Returns string[] | a single nil-UUID array if no docs (the .in()
// call needs a non-empty list).
async function documentIdsForProjects(
  f: WorkflowProjectFixture,
): Promise<string[]> {
  const { data } = await f.service
    .from('documents')
    .select('id')
    .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
  return (data ?? []).map((r) => r.id as string);
}
