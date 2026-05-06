import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireAuth: vi.fn(), requireOrgUser: vi.fn() };
});
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-msg', emailEventId: null }),
}));
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { inviteStakeholder, removeStakeholder } from '@/actions/stakeholders';
import * as auth from '@/lib/auth/requireAuth';
import {
  buildAcceptedStakeholderFixture,
  type StakeholderFixture,
} from '../fixtures/stakeholder-fixtures';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

// Reframed from "concurrency" to deterministic serial duplicate-detection per
// session 7 plan decision #8. The action layer enforces uniqueness via a
// read-then-write check; there is no DB-level partial unique index backing
// (org_id, email, project_id, invitation_type) WHERE deleted_at IS NULL, so
// truly concurrent calls are not deterministic. Serial calls are.

describe('Serial duplicate invite detection', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service
      .from('project_stakeholders')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.service
      .from('invitations')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('first invite succeeds; second invite for same (org, email, project) returns conflict/invitation_already_pending', async () => {
    const inviteEmail = `dupe-${uuidv7()}@test.local`;
    const args = {
      projectId: f.extras.orgAProject.id,
      email: inviteEmail,
      name: 'Duplicate Test',
      role: 'collaborator' as const,
      visibilityProfile: 'full' as const,
    };
    const first = await inviteStakeholder(args);
    expect(first).toMatchObject({ success: true });

    const second = await inviteStakeholder(args);
    // The action's pre-transaction check on `invitations` fires first when a
    // non-cancelled, non-accepted, non-expired stakeholder invitation exists
    // for (orgId, email, projectId).
    expect(second).toMatchObject({ error: 'conflict', reason: 'invitation_already_pending' });
  });
});

describe('Serial duplicate remove detection', () => {
  let f: WorkflowProjectFixture;
  let stakeholderId: string;
  let clientId: string;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
    clientId = uuidv7();
    await f.service.from('clients').insert({
      id: clientId,
      email: `remove-dupe-${uuidv7()}@test.local`,
      name: 'Remove Twice',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: clientId,
      org_id: f.orgA.id,
    });
    stakeholderId = uuidv7();
    await f.service.from('project_stakeholders').insert({
      id: stakeholderId,
      project_id: f.extras.orgAProject.id,
      client_id: clientId,
      role: 'collaborator',
      visibility_profile: 'full',
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
  });
  afterAll(async () => {
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    await f.service.from('client_org_memberships').delete().eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('first remove succeeds; second remove on same row returns conflict/already_removed', async () => {
    const first = await removeStakeholder({ stakeholderId });
    expect(first).toMatchObject({ success: true });

    const second = await removeStakeholder({ stakeholderId });
    expect(second).toMatchObject({ error: 'conflict', reason: 'already_removed' });
  });
});

describe('Soft-delete then portal request — RLS re-evaluation', () => {
  let f: StakeholderFixture;

  beforeAll(async () => {
    f = await buildAcceptedStakeholderFixture('full');
  });
  afterAll(async () => f.cleanup());
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.base.userA, f.base.orgA.id, 'owner'),
    );
  });

  test('after removeStakeholder, the stakeholder authed client sees an empty projects list', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    // Sanity: before remove, the stakeholder DOES see their project.
    const { data: before } = await f.stakeholderAuth
      .from('projects')
      .select('id')
      .eq('id', f.projectId);
    expect(before?.length).toBe(1);

    // Remove via the org-owner action. This commits the soft-delete + cascade
    // in a single transaction.
    const result = await removeStakeholder({ stakeholderId: f.stakeholderId });
    expect(result).toMatchObject({ success: true });

    // The stakeholder's next query is RLS-re-evaluated against the now
    // soft-deleted project_stakeholders row. auth_user_stakeholder_projects()
    // excludes deleted rows, so the project disappears from view.
    const { data: after } = await f.stakeholderAuth
      .from('projects')
      .select('id')
      .eq('id', f.projectId);
    expect(after ?? []).toEqual([]);
  });
});
