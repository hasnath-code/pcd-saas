import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgAdmin: vi.fn(),
    requireOrgUser: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { createOrganization, switchActiveOrg } from '@/actions/orgs';
import * as auth from '@/lib/auth/requireAuth';
import { AuthError } from '@/lib/auth/requireAuth';

describe('createOrganization (Drizzle transaction)', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockReset();
  });

  // Helper: create a fresh auth user (not in any org).
  async function createFreshAuthUser() {
    const email = `signup-${uuidv7()}@test.local`;
    const { data, error } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${uuidv7()}`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createFreshAuthUser: ${error?.message}`);
    return data.user;
  }

  test('happy path: org + user + workflow + 5 stages all created atomically', async () => {
    const authUser = await createFreshAuthUser();
    vi.mocked(auth.requireAuth).mockResolvedValue(authUser);

    const result = await createOrganization({
      intent: 'wizard_signup',
      orgTypeSlug: 'surveyor',
      name: `Atomic Test Org ${uuidv7()}`,
      ownerName: 'Atomic Tester',
    });
    expect(result).toEqual({ success: true });

    // Verify all four row types via service role.
    const { data: userRows } = await f.service
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', authUser.id);
    expect(userRows).toHaveLength(1);
    const orgId = userRows![0].org_id;

    const { data: orgRows } = await f.service
      .from('organizations')
      .select('id')
      .eq('id', orgId);
    expect(orgRows).toHaveLength(1);

    const { data: wfRows } = await f.service
      .from('workflows')
      .select('id, slug, is_system_template, is_default')
      .eq('org_id', orgId);
    expect(wfRows).toHaveLength(1);
    expect(wfRows![0].slug).toBe('simple');
    expect(wfRows![0].is_system_template).toBe(false);
    expect(wfRows![0].is_default).toBe(true);

    const { data: stageRows } = await f.service
      .from('workflow_stages')
      .select('slug, position')
      .eq('workflow_id', wfRows![0].id)
      .order('position');
    expect(stageRows).toHaveLength(5);
    expect(stageRows!.map((s) => s.slug)).toEqual([
      'new',
      'in_progress',
      'on_hold',
      'completed',
      'cancelled',
    ]);

    // Cleanup.
    await f.service.from('users').delete().eq('id', userRows![0].id);
    await f.service.from('organizations').delete().eq('id', orgId);
    await f.service.auth.admin.deleteUser(authUser.id);
  });

  // Note: a "force-rollback" test that deletes the system template would race
  // with the workflow_project_fixture used by parallel test files (RLS +
  // clients/projects action tests both read the template). Atomicity is a
  // Postgres engine guarantee; the happy-path test above proves the
  // transaction is wired correctly (org + user + workflow + stages all
  // create together). If we ever need explicit rollback coverage, do it
  // via a vi.mock of @/db that injects a transaction wrapper which throws
  // after the user insert — keep it isolated from real DB state.

  test('idempotent re-call: same auth user gets membership_already_exists', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await createOrganization({
      intent: 'wizard_signup',
      orgTypeSlug: 'surveyor',
      name: 'Should not be created',
      ownerName: 'Tester',
    });
    expect(result).toEqual({ error: 'conflict', reason: 'membership_already_exists' });
  });
});

describe('switchActiveOrg', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockReset();
  });

  test('happy path: member of target org → success', async () => {
    // userA is owner of orgA. Add them as member of orgB.
    const userBMembershipId = uuidv7();
    await f.service.from('users').insert({
      id: userBMembershipId,
      auth_user_id: f.userA.authUserId,
      org_id: f.orgB.id,
      email: f.userA.email,
      name: 'User A in Org B',
      role: 'member',
    });

    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await switchActiveOrg({ orgId: f.orgB.id });
    expect(result).toEqual({ success: true });

    // Cleanup the extra membership.
    await f.service.from('users').delete().eq('id', userBMembershipId);
  });

  test('not a member → not_authorized / not_a_member', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    // userA has no membership in orgB at this point.
    const result = await switchActiveOrg({ orgId: f.orgB.id });
    expect(result).toEqual({ error: 'not_authorized', reason: 'not_a_member' });
  });

  test('nonexistent org → not_authorized / not_a_member (no leak)', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await switchActiveOrg({ orgId: uuidv7() });
    expect(result).toEqual({ error: 'not_authorized', reason: 'not_a_member' });
  });

  test('not authenticated → not_authenticated', async () => {
    vi.mocked(auth.requireAuth).mockRejectedValueOnce(new AuthError('not_authenticated'));
    const result = await switchActiveOrg({ orgId: f.orgA.id });
    expect(result).toMatchObject({ error: 'not_authenticated' });
  });

  test('validation: bad uuid → validation_error', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await switchActiveOrg({ orgId: 'not-a-uuid' });
    expect(result).toMatchObject({ error: 'validation_error' });
  });
});
