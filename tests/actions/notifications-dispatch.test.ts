import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENT_TYPES } from '@/lib/notifications/events';

// Module-level mock for the email send call — tests assert call shape + can
// force failure on specific tests. The dispatcher catches send errors and
// records failed_at + failure_reason on the row.
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-msg-id', emailEventId: null }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

import {
  dispatchNotification,
  UnknownEventTypeError,
} from '@/lib/notifications/dispatch';
import * as emailMod from '@/lib/email/send';

// Helper: fetch all notifications for (recipientType, recipientId, eventType).
async function fetchNotifs(
  service: TwoOrgFixture['service'],
  recipientType: 'user' | 'client',
  recipientId: string,
  eventType: string,
) {
  const { data, error } = await service
    .from('notifications')
    .select('id, channel, sent_at, failed_at, failure_reason, payload')
    .eq('recipient_type', recipientType)
    .eq('recipient_id', recipientId)
    .eq('event_type', eventType)
    .order('channel');
  if (error) throw new Error(`fetchNotifs: ${error.message}`);
  return data ?? [];
}

// Helper: bulk-toggle prefs for (identityColumn, identityId, eventType) to a
// specific enabled set. Channels not in the set are forced off.
async function setEnabledChannels(
  service: TwoOrgFixture['service'],
  identityColumn: 'user_id' | 'client_id',
  identityId: string,
  eventType: string,
  enabledSet: Set<string>,
) {
  for (const channel of NOTIFICATION_CHANNELS) {
    await service
      .from('notification_preferences')
      .update({ enabled: enabledSet.has(channel) })
      .eq(identityColumn, identityId)
      .eq('channel', channel)
      .eq('event_type', eventType);
  }
}

describe('dispatchNotification', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
    // Seed prefs for userA (the fixture's owner). Defaults: in_app + email
    // enabled, push + sms disabled. Tests override per-case.
    const rows = NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        id: uuidv7(),
        user_id: f.userA.userId,
        client_id: null,
        channel,
        event_type: eventType,
        enabled: channel === 'in_app' || channel === 'email',
      })),
    );
    const { error } = await f.service.from('notification_preferences').insert(rows);
    if (error) throw new Error(`seed prefs: ${error.message}`);
  });

  afterAll(async () => {
    // Cleanup all notifications + prefs for this fixture's users.
    await f.service.from('notifications').delete().eq('recipient_id', f.userA.userId);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('user_id', f.userA.userId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(emailMod.sendEmail).mockReset();
    vi.mocked(emailMod.sendEmail).mockResolvedValue({
      messageId: 'mocked-msg-id',
      emailEventId: null,
    });
  });

  test('user with in_app + email enabled → 2 rows; only email triggers sendEmail', async () => {
    const result = await dispatchNotification({
      recipientType: 'user',
      recipientId: f.userA.userId,
      eventType: 'message.new',
      payload: {
        conversationId: uuidv7(),
        conversationName: 'Test thread',
        senderName: 'Jane',
        snippet: 'Hello there',
      },
    });
    expect(result.inserted).toBe(2);
    expect(result.emailDelivered).toBe(1);
    expect(result.emailFailed).toBe(0);
    expect(result.pushSmsSkipped).toBe(0);
    expect(vi.mocked(emailMod.sendEmail)).toHaveBeenCalledTimes(1);

    const notifs = await fetchNotifs(f.service, 'user', f.userA.userId, 'message.new');
    expect(notifs.length).toBe(2);

    const inApp = notifs.find((n) => n.channel === 'in_app');
    expect(inApp?.sent_at).toBeNull(); // in_app has no sent_at — Realtime broadcasts on INSERT.
    expect(inApp?.failed_at).toBeNull();

    const email = notifs.find((n) => n.channel === 'email');
    expect(email?.sent_at).not.toBeNull();
    expect(email?.failed_at).toBeNull();

    // Cleanup.
    await f.service.from('notifications').delete().eq('event_type', 'message.new');
  });

  test('user with all 4 channels enabled → 4 rows; push + sms stamped channel_not_implemented', async () => {
    await setEnabledChannels(
      f.service,
      'user_id',
      f.userA.userId,
      'project.stage_changed',
      new Set(['in_app', 'email', 'push', 'sms']),
    );

    const result = await dispatchNotification({
      recipientType: 'user',
      recipientId: f.userA.userId,
      eventType: 'project.stage_changed',
      payload: {
        projectId: uuidv7(),
        projectNumber: 'P-001',
        fromStageName: 'New',
        toStageName: 'In Progress',
      },
    });
    expect(result.inserted).toBe(4);
    expect(result.emailDelivered).toBe(1);
    expect(result.pushSmsSkipped).toBe(2);

    const notifs = await fetchNotifs(
      f.service,
      'user',
      f.userA.userId,
      'project.stage_changed',
    );
    expect(notifs.length).toBe(4);
    const push = notifs.find((n) => n.channel === 'push');
    const sms = notifs.find((n) => n.channel === 'sms');
    expect(push?.failed_at).not.toBeNull();
    expect(push?.failure_reason).toBe('channel_not_implemented');
    expect(sms?.failed_at).not.toBeNull();
    expect(sms?.failure_reason).toBe('channel_not_implemented');

    // Cleanup.
    await f.service
      .from('notifications')
      .delete()
      .eq('event_type', 'project.stage_changed');
    // Reset prefs back to defaults for the next test.
    await setEnabledChannels(
      f.service,
      'user_id',
      f.userA.userId,
      'project.stage_changed',
      new Set(['in_app', 'email']),
    );
  });

  test('user with all channels disabled → 0 rows + no sendEmail call', async () => {
    await setEnabledChannels(
      f.service,
      'user_id',
      f.userA.userId,
      'file.uploaded',
      new Set(),
    );

    const result = await dispatchNotification({
      recipientType: 'user',
      recipientId: f.userA.userId,
      eventType: 'file.uploaded',
      payload: { projectId: uuidv7(), filename: 'foo.pdf' },
    });
    expect(result.inserted).toBe(0);
    expect(vi.mocked(emailMod.sendEmail)).not.toHaveBeenCalled();

    const notifs = await fetchNotifs(f.service, 'user', f.userA.userId, 'file.uploaded');
    expect(notifs.length).toBe(0);

    // Restore defaults.
    await setEnabledChannels(
      f.service,
      'user_id',
      f.userA.userId,
      'file.uploaded',
      new Set(['in_app', 'email']),
    );
  });

  test('unknown event_type throws UnknownEventTypeError', async () => {
    await expect(
      dispatchNotification({
        recipientType: 'user',
        recipientId: f.userA.userId,
        // @ts-expect-error — testing runtime guard for an unknown event_type
        eventType: 'not.a.real.event',
        payload: {},
      }),
    ).rejects.toThrow(UnknownEventTypeError);
    expect(vi.mocked(emailMod.sendEmail)).not.toHaveBeenCalled();
  });

  test('email send failure → failed_at + failure_reason set; in_app row still sent', async () => {
    vi.mocked(emailMod.sendEmail).mockReset();
    vi.mocked(emailMod.sendEmail).mockRejectedValueOnce(
      new Error('resend.emails.send failed: forced'),
    );

    const result = await dispatchNotification({
      recipientType: 'user',
      recipientId: f.userA.userId,
      eventType: 'milestone.scheduled',
      payload: { projectId: uuidv7(), label: 'Site visit' },
    });
    expect(result.inserted).toBe(2); // in_app + email
    expect(result.emailDelivered).toBe(0);
    expect(result.emailFailed).toBe(1);

    const notifs = await fetchNotifs(
      f.service,
      'user',
      f.userA.userId,
      'milestone.scheduled',
    );
    const email = notifs.find((n) => n.channel === 'email');
    expect(email?.sent_at).toBeNull();
    expect(email?.failed_at).not.toBeNull();
    expect(email?.failure_reason).toMatch(/forced/);

    // in_app row should be untouched (no sent_at, no failed_at — Realtime
    // broadcasts on INSERT).
    const inApp = notifs.find((n) => n.channel === 'in_app');
    expect(inApp?.sent_at).toBeNull();
    expect(inApp?.failed_at).toBeNull();

    // Cleanup.
    await f.service
      .from('notifications')
      .delete()
      .eq('event_type', 'milestone.scheduled');
  });

  test('dispatching twice for the same recipient + event creates 2 separate sets (non-idempotent)', async () => {
    await dispatchNotification({
      recipientType: 'user',
      recipientId: f.userA.userId,
      eventType: 'milestone.completed',
      payload: { projectId: uuidv7(), label: 'Survey' },
    });
    await dispatchNotification({
      recipientType: 'user',
      recipientId: f.userA.userId,
      eventType: 'milestone.completed',
      payload: { projectId: uuidv7(), label: 'Survey' },
    });

    const notifs = await fetchNotifs(
      f.service,
      'user',
      f.userA.userId,
      'milestone.completed',
    );
    expect(notifs.length).toBe(4); // 2 dispatches × (in_app + email) = 4

    // Cleanup.
    await f.service
      .from('notifications')
      .delete()
      .eq('event_type', 'milestone.completed');
  });

  test('recipient has no prefs row (legacy identity) → 0 rows, no crash', async () => {
    // Insert a fresh users row that has NO prefs seeded — simulating an
    // identity created before Session 11 wired the seed in.
    const rnd = Math.random().toString(36).slice(2, 10);
    const orphanAuthEmail = `dispatch-orphan-${rnd}@test.local`;
    const { data: authData } = await f.service.auth.admin.createUser({
      email: orphanAuthEmail,
      password: `pw-${rnd}-x9X`,
      email_confirm: true,
    });
    if (!authData.user) throw new Error('no auth user');
    const orphanUserId = uuidv7();
    await f.service.from('users').insert({
      id: orphanUserId,
      auth_user_id: authData.user.id,
      org_id: f.orgA.id,
      email: orphanAuthEmail,
      name: 'Orphan',
      role: 'member',
    });

    const result = await dispatchNotification({
      recipientType: 'user',
      recipientId: orphanUserId,
      eventType: 'team.invited',
      payload: { orgName: 'Demo' },
    });
    expect(result.inserted).toBe(0);

    // Cleanup.
    await f.service.from('users').delete().eq('id', orphanUserId);
    await f.service.auth.admin.deleteUser(authData.user.id);
  });
});

describe('dispatchNotification — client recipient branch', () => {
  let f: TwoOrgFixture;
  let clientId: string;

  beforeAll(async () => {
    f = await createTwoOrgFixture();

    const rnd = Math.random().toString(36).slice(2, 10);
    clientId = uuidv7();
    await f.service.from('clients').insert({
      id: clientId,
      email: `dispatch-client-${rnd}@test.local`,
      name: 'Test Client',
    });
    // Seed client prefs: in_app + email enabled per default.
    const rows = NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        id: uuidv7(),
        user_id: null,
        client_id: clientId,
        channel,
        event_type: eventType,
        enabled: channel === 'in_app' || channel === 'email',
      })),
    );
    await f.service.from('notification_preferences').insert(rows);
  });

  afterAll(async () => {
    await f.service.from('notifications').delete().eq('recipient_id', clientId);
    await f.service.from('notification_preferences').delete().eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(emailMod.sendEmail).mockReset();
    vi.mocked(emailMod.sendEmail).mockResolvedValue({
      messageId: 'mocked-client-msg',
      emailEventId: null,
    });
  });

  test('client recipient → routes through client prefs; email rewrites to /portal/...', async () => {
    const result = await dispatchNotification({
      recipientType: 'client',
      recipientId: clientId,
      eventType: 'project.stage_changed',
      payload: {
        projectId: uuidv7(),
        projectNumber: 'P-007',
        fromStageName: 'New',
        toStageName: 'Drafting',
      },
    });
    expect(result.inserted).toBe(2);
    expect(result.emailDelivered).toBe(1);

    const notifs = await fetchNotifs(f.service, 'client', clientId, 'project.stage_changed');
    expect(notifs.length).toBe(2);

    // Verify sendEmail was called with a /portal/ URL in the rendered HTML
    // (CTA should rewrite from /dashboard/projects/<id> → /portal/projects/<id>).
    const call = vi.mocked(emailMod.sendEmail).mock.calls[0]?.[0];
    expect(call?.html).toContain('/portal/projects/');
    expect(call?.html).not.toContain('/dashboard/projects/');

    // Cleanup.
    await f.service
      .from('notifications')
      .delete()
      .eq('event_type', 'project.stage_changed')
      .eq('recipient_id', clientId);
  });
});
