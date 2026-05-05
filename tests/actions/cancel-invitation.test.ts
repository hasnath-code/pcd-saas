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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { cancelInvitation } from '@/actions/invitations';
import * as auth from '@/lib/auth/requireAuth';
import { AuthError } from '@/lib/auth/requireAuth';

describe('cancelInvitation', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(
      asOrgAdminContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  async function seedInvitation(opts?: { acceptedAt?: Date; deletedAt?: Date }) {
    const id = uuidv7();
    const email = `cancel-${uuidv7()}@test.local`;
    await f.service.from('invitations').insert({
      id,
      org_id: f.orgA.id,
      email,
      invitation_type: 'team_member',
      role: 'member',
      token: uuidv7(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      accepted_at: opts?.acceptedAt ? opts.acceptedAt.toISOString() : null,
      deleted_at: opts?.deletedAt ? opts.deletedAt.toISOString() : null,
      invited_by: f.userA.userId,
    });
    return id;
  }

  test('happy path: pending invitation → success + deleted_at set', async () => {
    const id = await seedInvitation();
    const result = await cancelInvitation({ invitationId: id });
    expect(result).toEqual({ success: true });

    const { data } = await f.service
      .from('invitations')
      .select('deleted_at')
      .eq('id', id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });

  test('member role → not_authorized', async () => {
    vi.mocked(auth.requireOrgAdmin).mockRejectedValueOnce(
      new AuthError('not_authorized', 'org_admin_required'),
    );
    const result = await cancelInvitation({ invitationId: uuidv7() });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('already accepted → conflict / already_accepted', async () => {
    const id = await seedInvitation({ acceptedAt: new Date() });
    const result = await cancelInvitation({ invitationId: id });
    expect(result).toEqual({ error: 'conflict', reason: 'already_accepted' });
  });

  test('already cancelled → conflict / already_cancelled', async () => {
    const id = await seedInvitation({ deletedAt: new Date() });
    const result = await cancelInvitation({ invitationId: id });
    expect(result).toEqual({ error: 'conflict', reason: 'already_cancelled' });
  });

  test('cross-org → not_found', async () => {
    // Seed an invitation in org B; admin of orgA tries to cancel.
    const id = uuidv7();
    await f.service.from('invitations').insert({
      id,
      org_id: f.orgB.id,
      email: `crossorg-${uuidv7()}@test.local`,
      invitation_type: 'team_member',
      role: 'member',
      token: uuidv7(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invited_by: f.userB.userId,
    });
    const result = await cancelInvitation({ invitationId: id });
    expect(result).toEqual({ error: 'not_found', reason: 'invitation' });
  });

  test('not found → not_found', async () => {
    const result = await cancelInvitation({ invitationId: uuidv7() });
    expect(result).toEqual({ error: 'not_found', reason: 'invitation' });
  });
});
