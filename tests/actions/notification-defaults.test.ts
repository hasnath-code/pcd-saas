import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { asOrgUserContext } from '../helpers/sign-in-fixture';
import {
  DEFAULT_ENABLED_CHANNELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
} from '@/lib/notifications/events';

// Phase 1c Session 11 §17: every identity-creating entry point seeds default
// notification preferences. 12 event types × 4 channels = 48 rows per identity.
// in_app + email default on; push + sms default off (schema-supported,
// dispatcher-rejected in Phase 1c).

const EXPECTED_ROWS = NOTIFICATION_EVENT_TYPES.length * NOTIFICATION_CHANNELS.length;

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgUser: vi.fn(),
    requireOrgAdmin: vi.fn(),
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

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-msg', emailEventId: null }),
}));

import { createOrganization } from '@/actions/orgs';
import { acceptInvitation } from '@/actions/users';
import { findOrCreateClient } from '@/actions/clients';
import { seedNotificationDefaultsTx } from '@/lib/notifications/seed-defaults';
import { db } from '@/db';
import * as auth from '@/lib/auth/requireAuth';

// Service-role re-fetch of prefs for an identity. Returns the rows sorted
// for stable assertions.
async function fetchPrefs(
  service: TwoOrgFixture['service'],
  ownership: { userId: string } | { clientId: string },
): Promise<{ channel: string; event_type: string; enabled: boolean }[]> {
  const column = 'userId' in ownership ? 'user_id' : 'client_id';
  const value = 'userId' in ownership ? ownership.userId : ownership.clientId;
  const { data, error } = await service
    .from('notification_preferences')
    .select('channel, event_type, enabled')
    .eq(column, value);
  if (error) throw new Error(`fetchPrefs: ${error.message}`);
  return (data ?? []).slice().sort((a, b) => {
    const k = (r: typeof a) => `${r.event_type}|${r.channel}`;
    return k(a).localeCompare(k(b));
  });
}

describe('notification defaults seeding — entry points', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockReset();
    vi.mocked(auth.requireOrgUser).mockReset();
  });

  test('createOrganization seeds 48 default prefs for the new owner user', async () => {
    const email = `seed-owner-${uuidv7()}@test.local`;
    const { data: authData, error: authErr } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${uuidv7()}`,
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`createUser: ${authErr?.message}`);
    vi.mocked(auth.requireAuth).mockResolvedValue(authData.user);

    const result = await createOrganization({
      intent: 'wizard_signup',
      orgTypeSlug: 'surveyor',
      name: `Seed Org ${uuidv7()}`,
      ownerName: 'Seed Owner',
    });
    expect(result).toEqual({ success: true });

    const { data: userRows } = await f.service
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', authData.user.id);
    expect(userRows).toHaveLength(1);
    const newUserId = userRows![0].id;
    const newOrgId = userRows![0].org_id;

    const prefs = await fetchPrefs(f.service, { userId: newUserId });
    expect(prefs.length).toBe(EXPECTED_ROWS);

    // Spot-check enabled distribution: every in_app + email row enabled;
    // every push + sms row disabled.
    for (const row of prefs) {
      const shouldBeEnabled = DEFAULT_ENABLED_CHANNELS.has(
        row.channel as 'in_app' | 'email' | 'push' | 'sms',
      );
      expect(row.enabled, `${row.event_type}/${row.channel}`).toBe(shouldBeEnabled);
    }

    // Cleanup.
    await f.service.from('notification_preferences').delete().eq('user_id', newUserId);
    await f.service.from('users').delete().eq('id', newUserId);
    await f.service.from('organizations').delete().eq('id', newOrgId);
    await f.service.auth.admin.deleteUser(authData.user.id);
  });

  test('acceptInvitation seeds 48 default prefs for the new team member', async () => {
    // Seed an invitation in orgA.
    const inviteeEmail = `seed-invitee-${uuidv7()}@test.local`;
    const token = uuidv7();
    await f.service.from('invitations').insert({
      id: uuidv7(),
      org_id: f.orgA.id,
      email: inviteeEmail,
      invitation_type: 'team_member',
      role: 'member',
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invited_by: f.userA.userId,
    });

    const { data: authData, error: authErr } = await f.service.auth.admin.createUser({
      email: inviteeEmail,
      password: `pw-${uuidv7()}`,
      email_confirm: true,
    });
    if (authErr || !authData.user) throw new Error(`createUser: ${authErr?.message}`);
    vi.mocked(auth.requireAuth).mockResolvedValue(authData.user);

    const result = await acceptInvitation({ token });
    expect(result).toEqual({ success: true });

    const { data: userRows } = await f.service
      .from('users')
      .select('id')
      .eq('auth_user_id', authData.user.id);
    expect(userRows).toHaveLength(1);
    const newUserId = userRows![0].id;

    const prefs = await fetchPrefs(f.service, { userId: newUserId });
    expect(prefs.length).toBe(EXPECTED_ROWS);

    // Cleanup.
    await f.service.from('notification_preferences').delete().eq('user_id', newUserId);
    await f.service.from('users').delete().eq('id', newUserId);
    await f.service.from('invitations').delete().eq('token', token);
    await f.service.auth.admin.deleteUser(authData.user.id);
  });
});

describe('notification defaults seeding — client path', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('findOrCreateClient seeds 48 default prefs for a new client', async () => {
    const email = `seed-client-${uuidv7()}@test.local`;
    const result = await findOrCreateClient({
      email,
      name: 'Seed Client',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.data.created).toBe(true);
    const clientId = result.data.clientId;

    const prefs = await fetchPrefs(f.service, { clientId });
    expect(prefs.length).toBe(EXPECTED_ROWS);

    // Cleanup. NOTE: prefs CASCADE with the client; deleting the client
    // also removes the rows, so the explicit prefs delete is belt-and-braces.
    await f.service.from('notification_preferences').delete().eq('client_id', clientId);
    await f.service.from('client_org_memberships').delete().eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
  });

  test('findOrCreateClient re-call on same email is idempotent (no duplicate prefs)', async () => {
    const email = `seed-idempotent-${uuidv7()}@test.local`;
    const first = await findOrCreateClient({ email, name: 'First' });
    if ('error' in first) throw new Error('first call failed');
    const clientId = first.data.clientId;

    // Second call — same org, same email. findOrCreateClientTx returns
    // existing-in-org and DOES NOT re-execute the membership insert, but
    // the prefs are still already seeded; idempotency is what we're
    // proving here.
    const second = await findOrCreateClient({ email, name: 'Second' });
    if ('error' in second) throw new Error('second call failed');
    expect(second.data.created).toBe(false);
    expect(second.data.clientId).toBe(clientId);

    const prefs = await fetchPrefs(f.service, { clientId });
    expect(prefs.length).toBe(EXPECTED_ROWS); // still 48, not 96

    // Cleanup.
    await f.service.from('notification_preferences').delete().eq('client_id', clientId);
    await f.service.from('client_org_memberships').delete().eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
  });
});

describe('seedNotificationDefaultsTx — helper-level contract', () => {
  test('throws when neither userId nor clientId supplied', async () => {
    await expect(
      // @ts-expect-error — testing runtime guard for the empty-input case
      seedNotificationDefaultsTx(db, {}),
    ).rejects.toThrow(/exactly one of userId/);
  });

  test('throws when BOTH userId AND clientId supplied', async () => {
    // TypeScript structurally accepts an object with both props as the union
    // type — the runtime XOR guard is the defense. This test exercises that
    // guard, which mirrors the DB-level CHECK that would otherwise fire
    // inside the transaction and roll back.
    await expect(
      seedNotificationDefaultsTx(db, {
        userId: uuidv7(),
        clientId: uuidv7(),
      } as unknown as { userId: string }),
    ).rejects.toThrow(/exactly one of userId/);
  });
});
