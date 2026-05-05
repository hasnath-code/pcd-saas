import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { asOrgAdminContext } from '../helpers/sign-in-fixture';

// vi.mock is hoisted above imports. The auth + email + ratelimit modules are
// stubbed; the rest of the action body runs against local Supabase via @/db.
vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgAdmin: vi.fn(),
    requireOrgUser: vi.fn(),
  };
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

import { inviteTeamMember } from '@/actions/users';
import * as auth from '@/lib/auth/requireAuth';
import * as ratelimit from '@/lib/ratelimit';
import * as email from '@/lib/email/send';
import * as Sentry from '@sentry/nextjs';
import { AuthError } from '@/lib/auth/requireAuth';

describe('inviteTeamMember', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    // Default: admin auth ctx for orgA owner, no rate limit.
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(asOrgAdminContext(f.userA, f.orgA.id, 'owner'));
    vi.mocked(ratelimit.rateLimit).mockResolvedValue({ limited: false, retryAfterSec: 0 });
  });

  test('happy path → { success: true }', async () => {
    const email = `newcomer-${uuidv7()}@test.local`;
    const result = await inviteTeamMember({ email, role: 'member' });
    expect(result).toEqual({ success: true });
  });

  test('not authenticated → { error: not_authenticated }', async () => {
    vi.mocked(auth.requireOrgAdmin).mockRejectedValueOnce(new AuthError('not_authenticated'));
    const result = await inviteTeamMember({ email: `x-${uuidv7()}@test.local`, role: 'member' });
    expect(result).toMatchObject({ error: 'not_authenticated' });
  });

  test('not authorized (requireOrgAdmin throws) → { error: not_authorized }', async () => {
    vi.mocked(auth.requireOrgAdmin).mockRejectedValueOnce(
      new AuthError('not_authorized', 'org_admin_required'),
    );
    const result = await inviteTeamMember({ email: `x-${uuidv7()}@test.local`, role: 'member' });
    expect(result).toMatchObject({ error: 'not_authorized', reason: 'org_admin_required' });
  });

  test('already a member → { error: conflict, reason: already_a_member }', async () => {
    // userA is already an owner of orgA in the fixture.
    const result = await inviteTeamMember({ email: f.userA.email, role: 'member' });
    expect(result).toEqual({ error: 'conflict', reason: 'already_a_member' });
  });

  test('already pending invitation → { error: conflict, reason: invitation_already_pending }', async () => {
    const email = `pending-${uuidv7()}@test.local`;
    // Pre-seed an active, non-expired, non-accepted invitation for the same email.
    await f.service.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgA.id,
      email,
      invitation_type: 'team_member',
      role: 'member',
      token: uuidv7(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invited_by: f.userA.userId,
    });
    const result = await inviteTeamMember({ email, role: 'member' });
    expect(result).toEqual({ error: 'conflict', reason: 'invitation_already_pending' });
  });

  test('validation (bad email) → { error: validation_error }', async () => {
    const result = await inviteTeamMember({ email: 'not-an-email', role: 'member' });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('rate-limited → { error: rate_limited, reason: retry_after_<n>s }', async () => {
    vi.mocked(ratelimit.rateLimit).mockResolvedValueOnce({ limited: true, retryAfterSec: 42 });
    const result = await inviteTeamMember({ email: `x-${uuidv7()}@test.local`, role: 'member' });
    expect(result).toEqual({ error: 'rate_limited', reason: 'retry_after_42s' });
  });

  // Hotfix: BLOCKER 1. Resend rejects sends to non-verified addresses in
  // testing mode (production before pcdportal.com is verified). Before the
  // fix this threw out of the action and crashed the RSC render with a 500.
  // After the fix, the invitation row is still inserted, Sentry captures
  // the exception, and the action returns success with deliveryWarning.
  test('sendEmail throws → { success: true, deliveryWarning: email_send_failed } (no 500)', async () => {
    const email_addr = `qa-test-${uuidv7()}@example.com`;
    vi.mocked(email.sendEmail).mockRejectedValueOnce(
      new Error(
        'resend.emails.send failed: You can only send testing emails to your own email address',
      ),
    );

    const result = await inviteTeamMember({ email: email_addr, role: 'member' });
    expect(result).toEqual({ success: true, deliveryWarning: 'email_send_failed' });

    // Sentry was notified.
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);

    // Invitation row still persisted (the DB insert happens BEFORE sendEmail).
    const { data: row } = await f.service
      .from('invitations')
      .select('id, email, deleted_at, accepted_at')
      .eq('email', email_addr)
      .single();
    expect(row).not.toBeNull();
    expect(row?.deleted_at).toBeNull();
    expect(row?.accepted_at).toBeNull();
  });
});
