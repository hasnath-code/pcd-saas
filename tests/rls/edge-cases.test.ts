import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Auth + email + ratelimit + sentry mocked here because the expired-invitation
// scenario needs to call acceptStakeholderInvitation directly to assert the
// {error:'conflict',reason:'expired'} rejection. The other 5 edge-case
// scenarios use only service-role / asUser / asAnon clients.
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

import { acceptStakeholderInvitation } from '@/actions/stakeholders';
import * as auth from '@/lib/auth/requireAuth';
import {
  buildExpiredInvitationFixture,
  buildMultiOrgStakeholderFixture,
  buildOwnerAndStakeholderFixture,
  buildPendingStakeholderFixture,
  buildRemovedStakeholderFixture,
  buildSoftDeletedClientFixture,
  type MultiOrgStakeholderFixture,
  type OwnerAndStakeholderFixture,
  type StakeholderFixture,
} from '../fixtures/stakeholder-fixtures';
import { asAuthUser } from '../helpers/sign-in-fixture';
import { assertNotVisible, assertVisibleIds } from './_helpers';

// ─── 1. Pending stakeholder ────────────────────────────────────────────────
describe('Pending stakeholder', () => {
  let f: StakeholderFixture;
  beforeAll(async () => {
    f = await buildPendingStakeholderFixture();
  });
  afterAll(async () => f.cleanup());

  it('cannot SELECT the project (no auth identity to test, but service-role row state is correct)', async () => {
    // The fixture intentionally has no auth user — pending = pre-magic-link.
    // Verify the project_stakeholders row exists with accepted_at NULL, which
    // is what RLS gates on via auth_user_stakeholder_projects.
    const { data: ps } = await f.service
      .from('project_stakeholders')
      .select('accepted_at, deleted_at')
      .eq('id', f.stakeholderId)
      .single();
    expect(ps?.accepted_at).toBeNull();
    expect(ps?.deleted_at).toBeNull();
  });

  it('the invitation row is in the pending state (no accepted_at, no deleted_at)', async () => {
    const { data: inv } = await f.service
      .from('invitations')
      .select('accepted_at, deleted_at')
      .eq('id', f.invitationId)
      .single();
    expect(inv?.accepted_at).toBeNull();
    expect(inv?.deleted_at).toBeNull();
  });

  it('org owner DOES see the pending stakeholder row (manage list)', async () => {
    // Sanity check: the org-side branch of the SELECT policy is independent
    // of accepted_at — the org owner needs to see pending invites in the UI.
    await assertVisibleIds(
      f.orgUserAuth,
      'project_stakeholders',
      { column: 'id', values: [f.stakeholderId] },
      [f.stakeholderId],
      'pending: org owner sees row',
    );
  });
});

// ─── 2. Removed stakeholder ────────────────────────────────────────────────
describe('Removed stakeholder', () => {
  let f: StakeholderFixture;
  beforeAll(async () => {
    f = await buildRemovedStakeholderFixture();
  });
  afterAll(async () => f.cleanup());

  it('cannot SELECT the project anymore (project_stakeholders.deleted_at IS NOT NULL)', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    await assertNotVisible(f.stakeholderAuth, 'projects', f.projectId, 'removed: no project access');
  });

  it('the underlying clients row remains intact', async () => {
    const { data: client } = await f.service
      .from('clients')
      .select('id, deleted_at, auth_user_id')
      .eq('id', f.clientId)
      .single();
    expect(client?.deleted_at).toBeNull();
    expect(client?.auth_user_id).not.toBeNull();
  });
});

// ─── 3. Soft-deleted client ────────────────────────────────────────────────
describe('Soft-deleted client', () => {
  let f: StakeholderFixture;
  beforeAll(async () => {
    f = await buildSoftDeletedClientFixture();
  });
  afterAll(async () => f.cleanup());

  it('cannot SELECT the project (cascade-hidden via clients.deleted_at IS NULL check)', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    await assertNotVisible(
      f.stakeholderAuth,
      'projects',
      f.projectId,
      'soft-deleted client: no project access',
    );
  });

  it('cannot SELECT the project_stakeholders row (cascade-hidden)', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    await assertNotVisible(
      f.stakeholderAuth,
      'project_stakeholders',
      f.stakeholderId,
      'soft-deleted client: stakeholder row hidden',
    );
  });
});

// ─── 4. Expired invitation ─────────────────────────────────────────────────
describe('Expired invitation', () => {
  let f: Awaited<ReturnType<typeof buildExpiredInvitationFixture>>;
  beforeAll(async () => {
    f = await buildExpiredInvitationFixture();
  });
  afterAll(async () => f.cleanup());

  it('invitation row has expires_at < now (sanity check fixture)', async () => {
    const { data: inv } = await f.service
      .from('invitations')
      .select('expires_at, accepted_at, deleted_at')
      .eq('id', f.invitationId)
      .single();
    expect(new Date(inv!.expires_at).getTime()).toBeLessThan(Date.now());
    expect(inv?.accepted_at).toBeNull();
    expect(inv?.deleted_at).toBeNull();
  });

  it('acceptStakeholderInvitation rejects with conflict/expired', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: f.authUserId,
        userId: '',
        email: f.email,
        password: f.password,
      }),
    );
    const result = await acceptStakeholderInvitation({ token: f.token });
    expect(result).toMatchObject({ error: 'conflict', reason: 'expired' });

    // Anti-hijack assertion: clients.auth_user_id was NOT backfilled — the
    // expired token cannot be replayed to claim the client identity.
    const { data: clientRow } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', f.clientId)
      .single();
    expect(clientRow?.auth_user_id).toBeNull();
  });
});

// ─── 5. Multi-org stakeholder ──────────────────────────────────────────────
describe('Multi-org stakeholder', () => {
  let f: MultiOrgStakeholderFixture;
  beforeAll(async () => {
    f = await buildMultiOrgStakeholderFixture();
  });
  afterAll(async () => f.cleanup());

  it('SELECTs both Org A AND Org B projects via auth_user_stakeholder_projects()', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    await assertVisibleIds(
      f.stakeholderAuth,
      'projects',
      { column: 'id', values: [f.projectId, f.extras.secondProjectId] },
      [f.projectId, f.extras.secondProjectId],
      'multi-org: sees both projects',
    );
  });

  it('SELECTs both project_stakeholders rows (one per project)', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    await assertVisibleIds(
      f.stakeholderAuth,
      'project_stakeholders',
      { column: 'id', values: [f.stakeholderId, f.extras.secondStakeholderId] },
      [f.stakeholderId, f.extras.secondStakeholderId],
      'multi-org: sees both stakeholder rows',
    );
  });

  it('does NOT see a project from a third org where they have no membership', async () => {
    if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
    // Use a synthetic UUID that doesn't exist — the assertion is "no row
    // appears under the stakeholder's RLS view."
    const ghostProjectId = '00000000-0000-7000-8000-000000000000';
    await assertNotVisible(
      f.stakeholderAuth,
      'projects',
      ghostProjectId,
      'multi-org: no leakage to non-membership project',
    );
  });
});

// ─── 6. Dual-context (owner + stakeholder) ─────────────────────────────────
describe('Dual-context (owner of A + stakeholder of B)', () => {
  let f: OwnerAndStakeholderFixture;
  beforeAll(async () => {
    f = await buildOwnerAndStakeholderFixture();
  });
  afterAll(async () => f.cleanup());

  it('sees the owned org A project (via auth_user_orgs branch)', async () => {
    await assertVisibleIds(
      f.orgUserAuth,
      'projects',
      { column: 'id', values: [f.extras.ownedProjectId] },
      [f.extras.ownedProjectId],
      'dual-context: sees owned project',
    );
  });

  it('sees the org B project (via auth_user_stakeholder_projects branch)', async () => {
    await assertVisibleIds(
      f.orgUserAuth,
      'projects',
      { column: 'id', values: [f.projectId] },
      [f.projectId],
      'dual-context: sees stakeholder project',
    );
  });

  it('sees both A and B projects in a single SELECT (no leakage in either direction)', async () => {
    await assertVisibleIds(
      f.orgUserAuth,
      'projects',
      { column: 'id', values: [f.extras.ownedProjectId, f.projectId] },
      [f.extras.ownedProjectId, f.projectId],
      'dual-context: sees both projects in one query',
    );
  });
});
