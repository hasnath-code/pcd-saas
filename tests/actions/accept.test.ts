import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { asAuthUser } from '../helpers/sign-in-fixture';

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

import { acceptInvitation } from '@/actions/users';
import * as auth from '@/lib/auth/requireAuth';
import { AuthError } from '@/lib/auth/requireAuth';

describe('acceptInvitation', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    // Reset to "no auth" by default; per-test override.
    vi.mocked(auth.requireAuth).mockReset();
  });

  // Helper: insert an invitation as orgA, return its token.
  async function seedInvitation(opts: {
    email: string;
    expiresAt?: Date;
    acceptedAt?: Date | null;
  }): Promise<string> {
    const token = uuidv7();
    await f.service.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgA.id,
      email: opts.email,
      invitation_type: 'team_member',
      role: 'member',
      token,
      expires_at: (opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)).toISOString(),
      accepted_at: opts.acceptedAt ? opts.acceptedAt.toISOString() : null,
      invited_by: f.userA.userId,
    });
    return token;
  }

  // Helper: create a fresh auth user (not in any org) and return a User-shape.
  async function createInviteeAuthUser(email: string) {
    const { data, error } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${uuidv7()}`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createInviteeAuthUser: ${error?.message}`);
    return data.user;
  }

  test('happy path → { success: true }', async () => {
    const inviteeEmail = `invitee-${uuidv7()}@test.local`;
    const token = await seedInvitation({ email: inviteeEmail });
    const authUser = await createInviteeAuthUser(inviteeEmail);
    vi.mocked(auth.requireAuth).mockResolvedValue(authUser);

    const result = await acceptInvitation({ token });
    expect(result).toEqual({ success: true });

    // Cleanup created auth user (fixture won't know about this one).
    await f.service.auth.admin.deleteUser(authUser.id);
  });

  test('not authenticated → { error: not_authenticated }', async () => {
    vi.mocked(auth.requireAuth).mockRejectedValueOnce(new AuthError('not_authenticated'));
    const result = await acceptInvitation({ token: uuidv7() });
    expect(result).toMatchObject({ error: 'not_authenticated' });
  });

  test('token not found → { error: not_found, reason: invalid }', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    const result = await acceptInvitation({ token: uuidv7() }); // never inserted
    expect(result).toEqual({ error: 'not_found', reason: 'invalid' });
  });

  test('already accepted → { error: conflict, reason: already_accepted }', async () => {
    const email = `already-${uuidv7()}@test.local`;
    const token = await seedInvitation({ email, acceptedAt: new Date() });
    const authUser = await createInviteeAuthUser(email);
    vi.mocked(auth.requireAuth).mockResolvedValue(authUser);

    const result = await acceptInvitation({ token });
    expect(result).toEqual({ error: 'conflict', reason: 'already_accepted' });

    await f.service.auth.admin.deleteUser(authUser.id);
  });

  test('expired → { error: conflict, reason: expired }', async () => {
    const email = `expired-${uuidv7()}@test.local`;
    const token = await seedInvitation({
      email,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const authUser = await createInviteeAuthUser(email);
    vi.mocked(auth.requireAuth).mockResolvedValue(authUser);

    const result = await acceptInvitation({ token });
    expect(result).toEqual({ error: 'conflict', reason: 'expired' });

    await f.service.auth.admin.deleteUser(authUser.id);
  });

  test('email mismatch → { error: not_authorized, reason: email_mismatch }', async () => {
    const inviteeEmail = `target-${uuidv7()}@test.local`;
    const wrongEmail = `wrong-${uuidv7()}@test.local`;
    const token = await seedInvitation({ email: inviteeEmail });
    const authUser = await createInviteeAuthUser(wrongEmail);
    vi.mocked(auth.requireAuth).mockResolvedValue(authUser);

    const result = await acceptInvitation({ token });
    expect(result).toEqual({ error: 'not_authorized', reason: 'email_mismatch' });

    await f.service.auth.admin.deleteUser(authUser.id);
  });

  test('multi-org auth user → { error: multi_org_not_yet_supported }', async () => {
    // userA is already a member of orgA. Send them an invitation to orgB
    // (different org), then attempt accept while signed in as userA.
    const token = uuidv7();
    await f.service.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgB.id,
      email: f.userA.email,
      invitation_type: 'team_member',
      role: 'member',
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invited_by: f.userB.userId,
    });
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));

    const result = await acceptInvitation({ token });
    expect(result).toMatchObject({ error: 'multi_org_not_yet_supported' });
  });
});
