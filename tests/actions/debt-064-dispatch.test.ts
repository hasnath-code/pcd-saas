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

// DEBT-064: Session 12 introduced quote.sent / quote.accepted as activity
// event types but deferred notification dispatch. Session 13 wires the
// dispatch fan-out. These tests assert the fan-out happens with the right
// event type + recipient mix (org members + accepted financial-visible
// stakeholders).

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

import { acceptQuote, createQuote, sendQuote } from '@/actions/documents';
import * as auth from '@/lib/auth/requireAuth';
import * as emailMod from '@/lib/email/send';
import * as dispatchMod from '@/lib/notifications/dispatch';

async function documentIdsForProjects(f: WorkflowProjectFixture): Promise<string[]> {
  const { data } = await f.service
    .from('documents')
    .select('id')
    .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
  return (data ?? []).map((r) => r.id as string);
}

describe('DEBT-064 — sendQuote dispatches quote.sent post-commit', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Financial-visible stakeholder so the fan-out has both a user + a client
    // recipient to dispatch to.
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
    vi.mocked(dispatchMod.dispatchNotification).mockClear();
    vi.mocked(emailMod.sendEmail).mockResolvedValue({
      messageId: 'msg_test',
      emailEventId: null,
    });
  });

  test('sendQuote dispatches quote.sent to org members + financial-visible stakeholders', async () => {
    const created = await createQuote({
      projectId: f.extras.orgAProject.id,
      lineItems: [{ description: 'Survey', quantity: 1, unitPrice: 500 }],
    });
    if (!('data' in created)) throw new Error('createQuote failed');

    const result = await sendQuote({ documentId: created.data.documentId });
    expect(result).toMatchObject({ success: true });

    const sentDispatches = vi
      .mocked(dispatchMod.dispatchNotification)
      .mock.calls.filter((c) => c[0].eventType === 'quote.sent');
    expect(sentDispatches.length).toBeGreaterThan(0);

    const recipientTypes = sentDispatches.map((c) => c[0].recipientType);
    expect(recipientTypes).toContain('user');
    expect(recipientTypes).toContain('client');
  });
});

describe('DEBT-064 — acceptQuote dispatches quote.accepted post-commit', () => {
  let f: WorkflowProjectFixture;
  let sentDocId: string;
  let sentToken: string;

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

    sentDocId = uuidv7();
    await f.service.from('documents').insert({
      id: sentDocId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'quote',
      status: 'sent',
      document_number: `${f.extras.orgAProject.projectNumber}-Q-acc-1`,
      sequence: 200,
      created_by: f.userA.userId,
    });
    const { data: tokens } = await f.service
      .from('document_tokens')
      .insert({ id: uuidv7(), document_id: sentDocId, document_type: 'quote' })
      .select('token');
    sentToken = (tokens ?? [])[0].token;
  });
  afterAll(async () => {
    await f.service.from('document_tokens').delete().eq('document_id', sentDocId);
    await f.service.from('documents').delete().eq('id', sentDocId);
    await f.service
      .from('project_stakeholders')
      .delete()
      .eq('project_id', f.extras.orgAProject.id);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(dispatchMod.dispatchNotification).mockClear();
  });

  test('acceptQuote dispatches quote.accepted to org members + financial-visible stakeholders', async () => {
    const result = await acceptQuote({
      token: sentToken,
      acceptedByName: 'Jane Doe',
    });
    expect(result).toMatchObject({ success: true });

    const acceptedDispatches = vi
      .mocked(dispatchMod.dispatchNotification)
      .mock.calls.filter((c) => c[0].eventType === 'quote.accepted');
    expect(acceptedDispatches.length).toBeGreaterThan(0);

    const recipientTypes = acceptedDispatches.map((c) => c[0].recipientType);
    expect(recipientTypes).toContain('user');
    expect(recipientTypes).toContain('client');
  });
});
