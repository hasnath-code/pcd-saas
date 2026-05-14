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
import * as auth from '@/lib/auth/requireAuth';
import * as Sentry from '@sentry/nextjs';
import * as dispatchMod from '@/lib/notifications/dispatch';

async function paymentIdsForProjects(f: WorkflowProjectFixture): Promise<string[]> {
  const { data } = await f.service
    .from('payments')
    .select('id')
    .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
  return (data ?? []).map((r) => r.id as string);
}

describe('actions/payments — recordPayment', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    // Add a financial-visible stakeholder so dispatch fan-out has something
    // to fan out to.
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
      .from('payments')
      .delete()
      .in('id', await paymentIdsForProjects(f));
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
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(dispatchMod.dispatchNotification).mockClear();
  });

  test('recordPayment happy path inserts a row', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 250.0,
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;

    const { data } = await f.service
      .from('payments')
      .select('amount, project_id, recorded_by, correction_log_payload')
      .eq('id', result.data.paymentId)
      .single();
    expect(Number(data?.amount)).toBe(250);
    expect(data?.project_id).toBe(f.extras.orgAProject.id);
    expect(data?.recorded_by).toBe(f.userA.userId);
    expect(data?.correction_log_payload).toEqual([]);
  });

  test('recordPayment dispatches payment.recorded to org members + financial stakeholders', async () => {
    await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 100.0,
    });

    const recordedDispatches = vi
      .mocked(dispatchMod.dispatchNotification)
      .mock.calls.filter((c) => c[0].eventType === 'payment.recorded');
    expect(recordedDispatches.length).toBeGreaterThan(0);

    // Must include at least one user recipient (the org owner) and at least
    // one client recipient (the financial-visible stakeholder).
    const userTypes = recordedDispatches.map((c) => c[0].recipientType);
    expect(userTypes).toContain('user');
    expect(userTypes).toContain('client');
  });

  test('recordPayment running total reflects multiple inserts', async () => {
    // Use a fresh project to isolate from earlier tests' payments.
    const isolatedProjectId = f.extras.orgAProject.id;

    // Sum existing payments first.
    const { data: existingRows } = await f.service
      .from('payments')
      .select('amount')
      .eq('project_id', isolatedProjectId)
      .is('deleted_at', null);
    const baseline = (existingRows ?? []).reduce(
      (acc, r) => acc + Number(r.amount ?? 0),
      0,
    );

    await recordPayment({ projectId: isolatedProjectId, amount: 50.0 });
    await recordPayment({ projectId: isolatedProjectId, amount: 75.5 });
    await recordPayment({ projectId: isolatedProjectId, amount: 100.25 });

    const { data: afterRows } = await f.service
      .from('payments')
      .select('amount')
      .eq('project_id', isolatedProjectId)
      .is('deleted_at', null);
    const total = (afterRows ?? []).reduce(
      (acc, r) => acc + Number(r.amount ?? 0),
      0,
    );
    expect(total - baseline).toBeCloseTo(225.75, 2);
  });

  test('recordPayment cross-org project → not_found', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgBProject.id,
      amount: 1.0,
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'project' });
  });

  test('recordPayment amount <= 0 → validation_error', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 0,
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('recordPayment amount not 2dp → validation_error', async () => {
    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 1.234,
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('recordPayment isolates dispatch failure to Sentry; domain row still committed', async () => {
    vi.mocked(dispatchMod.dispatchNotification).mockRejectedValueOnce(
      new Error('dispatch hiccup'),
    );

    const result = await recordPayment({
      projectId: f.extras.orgAProject.id,
      amount: 12.34,
    });
    expect(result).toMatchObject({ success: true });
    if (!('data' in result)) return;

    const { data } = await f.service
      .from('payments')
      .select('amount')
      .eq('id', result.data.paymentId)
      .single();
    expect(Number(data?.amount)).toBe(12.34);

    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });
});

describe('actions/payments — correctPayment', () => {
  let f: WorkflowProjectFixture;
  let paymentId: string;

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

    paymentId = uuidv7();
    await f.service.from('payments').insert({
      id: paymentId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      amount: 500.0,
      recorded_by: f.userA.userId,
    });
  });
  afterAll(async () => {
    await f.service.from('payments').delete().eq('id', paymentId);
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
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(dispatchMod.dispatchNotification).mockClear();
  });

  test('correctPayment mutates amount and appends correction_log_payload', async () => {
    const result = await correctPayment({
      paymentId,
      newAmount: 525.0,
      reason: 'Bank fee adjustment',
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('payments')
      .select('amount, correction_log_payload')
      .eq('id', paymentId)
      .single();
    expect(Number(data?.amount)).toBe(525.0);
    const log = data?.correction_log_payload as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(Number(log[0].previous_amount)).toBe(500.0);
    expect(Number(log[0].new_amount)).toBe(525.0);
    expect(log[0].reason).toBe('Bank fee adjustment');
    expect(log[0].corrected_by).toBe(f.userA.userId);
  });

  test('correctPayment no-op → conflict no_change', async () => {
    // After previous test, amount is 525.0.
    const result = await correctPayment({
      paymentId,
      newAmount: 525.0,
      reason: 'noop',
    });
    expect(result).toMatchObject({ error: 'conflict', reason: 'no_change' });
  });

  test('correctPayment dispatches payment.corrected to ORG MEMBERS ONLY', async () => {
    await correctPayment({
      paymentId,
      newAmount: 600.0,
      reason: 'Updated invoice value',
    });

    const correctedDispatches = vi
      .mocked(dispatchMod.dispatchNotification)
      .mock.calls.filter((c) => c[0].eventType === 'payment.corrected');
    expect(correctedDispatches.length).toBeGreaterThan(0);

    // Must NOT include any client recipients (Q2 decision).
    const recipientTypes = correctedDispatches.map((c) => c[0].recipientType);
    expect(recipientTypes).not.toContain('client');
    expect(recipientTypes).toContain('user');
  });

  test('correctPayment with empty reason → validation_error', async () => {
    const result = await correctPayment({
      paymentId,
      newAmount: 700.0,
      reason: '   ',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('correctPayment on non-existent payment → not_found', async () => {
    const result = await correctPayment({
      paymentId: uuidv7(),
      newAmount: 100.0,
      reason: 'why',
    });
    expect(result).toMatchObject({ error: 'not_found', reason: 'payment' });
  });
});
