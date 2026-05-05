import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { asOrgAdminContext } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgAdmin: vi.fn(),
    requireOrgUser: vi.fn(),
  };
});

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));

import { removeUserFromOrg } from '@/actions/users';
import * as auth from '@/lib/auth/requireAuth';
import { AuthError } from '@/lib/auth/requireAuth';

describe('removeUserFromOrg', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(asOrgAdminContext(f.userA, f.orgA.id, 'owner'));
  });

  // Helper: insert a member of orgA and return their userId.
  async function seedMember(role: 'member' | 'admin' | 'owner' = 'member'): Promise<string> {
    const userId = uuidv7();
    const email = `member-${userId}@test.local`;
    const { data: au, error: aerr } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${userId}`,
      email_confirm: true,
    });
    if (aerr || !au.user) throw new Error(`seedMember: ${aerr?.message}`);
    await f.service.from('users').insert({
      id: userId,
      auth_user_id: au.user.id,
      org_id: f.orgA.id,
      email,
      name: `Member ${userId.slice(0, 6)}`,
      role,
    });
    return userId;
  }

  test('happy path → { success: true }', async () => {
    const targetId = await seedMember('member');
    const result = await removeUserFromOrg({ userId: targetId });
    expect(result).toEqual({ success: true });
  });

  test('not authorized → { error: not_authorized }', async () => {
    vi.mocked(auth.requireOrgAdmin).mockRejectedValueOnce(
      new AuthError('not_authorized', 'org_admin_required'),
    );
    const result = await removeUserFromOrg({ userId: uuidv7() });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('target not found → { error: not_found, reason: user }', async () => {
    const result = await removeUserFromOrg({ userId: uuidv7() });
    expect(result).toEqual({ error: 'not_found', reason: 'user' });
  });

  test('cross-org target → { error: not_found, reason: user }', async () => {
    // userB is owner of orgB. Admin of orgA tries to remove them.
    const result = await removeUserFromOrg({ userId: f.userB.userId });
    expect(result).toEqual({ error: 'not_found', reason: 'user' });
  });

  // Hotfix: BLOCKER 2. Self-removal is blocked regardless of role. The
  // server check fires BEFORE the last-owner check; UI also hides the
  // Remove kebab on the caller's own row (defense in depth).
  test('self-remove → { error: not_authorized, reason: cannot_remove_self }', async () => {
    // userA (owner) tries to remove themselves. Previously returned
    // last_owner_cannot_be_removed; now returns cannot_remove_self because
    // the self-check is more specific and fires first.
    const result = await removeUserFromOrg({ userId: f.userA.userId });
    expect(result).toEqual({ error: 'not_authorized', reason: 'cannot_remove_self' });
  });

  test('admin self-remove → { error: not_authorized, reason: cannot_remove_self }', async () => {
    // Even admins (not just owners) can't self-remove via this action.
    const adminId = await seedMember('admin');
    // Switch the auth context to that admin.
    vi.mocked(auth.requireOrgAdmin).mockResolvedValueOnce(
      asOrgAdminContext(
        { authUserId: f.userA.authUserId, userId: adminId, email: '', password: '' },
        f.orgA.id,
        'admin',
      ),
    );
    const result = await removeUserFromOrg({ userId: adminId });
    expect(result).toEqual({ error: 'not_authorized', reason: 'cannot_remove_self' });
  });

  test('non-self last-owner removal still blocked → conflict / last_owner_cannot_be_removed', async () => {
    // Seed an admin in orgA (not the owner). Admin tries to remove the sole
    // owner (userA). The cannot_remove_self check doesn't fire (different
    // user); the existing last_owner_cannot_be_removed guard kicks in.
    const adminId = await seedMember('admin');
    vi.mocked(auth.requireOrgAdmin).mockResolvedValueOnce(
      asOrgAdminContext(
        { authUserId: f.userA.authUserId, userId: adminId, email: '', password: '' },
        f.orgA.id,
        'admin',
      ),
    );
    const result = await removeUserFromOrg({ userId: f.userA.userId });
    expect(result).toEqual({ error: 'conflict', reason: 'last_owner_cannot_be_removed' });
  });
});
