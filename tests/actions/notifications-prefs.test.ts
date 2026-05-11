import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
} from '@/lib/notifications/events';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

import {
  getMyNotificationPreferences,
  updateNotificationPreference,
} from '@/actions/notifications';
import * as auth from '@/lib/auth/requireAuth';

describe('updateNotificationPreference', () => {
  let f: TwoOrgFixture;
  let clientId: string;
  let clientAuthId: string;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
    // Seed all 48 prefs for userA so the UPDATE path is exercised.
    const userRows = NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        id: uuidv7(),
        user_id: f.userA.userId,
        client_id: null,
        channel,
        event_type: eventType,
        enabled: channel === 'in_app' || channel === 'email',
      })),
    );
    await f.service.from('notification_preferences').insert(userRows);

    // Create a separate clients row attached to userB's auth identity so we
    // can exercise the client branch without dual-context entanglement.
    const rnd = Math.random().toString(36).slice(2, 10);
    const email = `prefs-client-${rnd}@test.local`;
    const { data: authData } = await f.service.auth.admin.createUser({
      email,
      password: `pw-${rnd}-x9X`,
      email_confirm: true,
    });
    if (!authData.user) throw new Error('no client auth');
    clientAuthId = authData.user.id;
    clientId = uuidv7();
    await f.service.from('clients').insert({
      id: clientId,
      auth_user_id: authData.user.id,
      email,
      name: 'Pref Client',
    });
    const clientRows = NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        id: uuidv7(),
        user_id: null,
        client_id: clientId,
        channel,
        event_type: eventType,
        enabled: channel === 'in_app' || channel === 'email',
      })),
    );
    await f.service.from('notification_preferences').insert(clientRows);
  });

  afterAll(async () => {
    await f.service
      .from('notification_preferences')
      .delete()
      .in('user_id', [f.userA.userId]);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
    await f.service.auth.admin.deleteUser(clientAuthId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockReset();
  });

  test('user side: toggle off persists; getMyNotificationPreferences reflects the change', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await updateNotificationPreference({
      identityType: 'user',
      channel: 'email',
      eventType: 'message.new',
      enabled: false,
    });
    expect(result).toEqual({ success: true });

    const fetched = await getMyNotificationPreferences('user');
    expect('data' in fetched).toBe(true);
    if ('data' in fetched) {
      const row = fetched.data.prefs.find(
        (p) => p.eventType === 'message.new' && p.channel === 'email',
      );
      expect(row?.enabled).toBe(false);
    }
  });

  test('client side: toggle on persists for stakeholder identity', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: clientAuthId,
      email: 'irrelevant',
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await updateNotificationPreference({
      identityType: 'client',
      channel: 'push',
      eventType: 'file.uploaded',
      enabled: true,
    });
    expect(result).toEqual({ success: true });

    const fetched = await getMyNotificationPreferences('client');
    if ('data' in fetched) {
      const row = fetched.data.prefs.find(
        (p) => p.eventType === 'file.uploaded' && p.channel === 'push',
      );
      expect(row?.enabled).toBe(true);
    }
  });

  test('rejects when caller has no identity of the requested type', async () => {
    // userA is an org user but has no clients row. Asking to update a client
    // pref must fail with no_client_identity.
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await updateNotificationPreference({
      identityType: 'client',
      channel: 'email',
      eventType: 'message.new',
      enabled: false,
    });
    expect(result).toEqual({ error: 'not_authorized', reason: 'no_client_identity' });
  });

  test('validation: bad channel rejected', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await updateNotificationPreference({
      identityType: 'user',
      channel: 'carrier_pigeon',
      eventType: 'message.new',
      enabled: true,
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });
});
