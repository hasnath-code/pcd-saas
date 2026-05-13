import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireAuth: vi.fn() };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/actions/notifications';
import * as auth from '@/lib/auth/requireAuth';

describe('markNotificationRead + markAllNotificationsRead', () => {
  let f: TwoOrgFixture;
  let notifAId: string;
  let notifAId2: string;
  let notifBId: string;

  beforeAll(async () => {
    f = await createTwoOrgFixture();

    notifAId = uuidv7();
    notifAId2 = uuidv7();
    notifBId = uuidv7();
    await f.service.from('notifications').insert([
      {
        id: notifAId,
        recipient_type: 'user',
        recipient_id: f.userA.userId,
        channel: 'in_app',
        event_type: 'message.new',
        payload: { snippet: 'hi A' },
      },
      {
        id: notifAId2,
        recipient_type: 'user',
        recipient_id: f.userA.userId,
        channel: 'in_app',
        event_type: 'file.uploaded',
        payload: { filename: 'a.pdf' },
      },
      {
        id: notifBId,
        recipient_type: 'user',
        recipient_id: f.userB.userId,
        channel: 'in_app',
        event_type: 'message.new',
        payload: { snippet: 'hi B' },
      },
    ]);
  });

  afterAll(async () => {
    await f.service
      .from('notifications')
      .delete()
      .in('recipient_id', [f.userA.userId, f.userB.userId]);
    await f.cleanup();
  });

  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockReset();
  });

  test('markNotificationRead happy path: own row → read_at set', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await markNotificationRead({ notificationId: notifAId });
    expect(result).toEqual({ success: true });

    const { data } = await f.service
      .from('notifications')
      .select('read_at')
      .eq('id', notifAId)
      .single();
    expect(data?.read_at).not.toBeNull();

    // Reset for the next test.
    await f.service
      .from('notifications')
      .update({ read_at: null })
      .eq('id', notifAId);
  });

  test('markNotificationRead cross-recipient → not_found (no leak; no UPDATE)', async () => {
    // userA logged in, tries to mark userB's row read.
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await markNotificationRead({ notificationId: notifBId });
    expect(result).toEqual({ error: 'not_found', reason: 'notification' });

    // userB row untouched.
    const { data } = await f.service
      .from('notifications')
      .select('read_at')
      .eq('id', notifBId)
      .single();
    expect(data?.read_at).toBeNull();
  });

  test('markNotificationRead unknown id → not_found', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await markNotificationRead({ notificationId: uuidv7() });
    expect(result).toEqual({ error: 'not_found', reason: 'notification' });
  });

  test('markAllNotificationsRead updates all unread rows for the caller', async () => {
    // Ensure userA has 2 unread rows.
    await f.service
      .from('notifications')
      .update({ read_at: null })
      .eq('recipient_id', f.userA.userId);

    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await markAllNotificationsRead();
    expect(result).toEqual({ success: true });

    const { data } = await f.service
      .from('notifications')
      .select('id, read_at')
      .eq('recipient_id', f.userA.userId);
    expect(data?.every((r) => r.read_at !== null)).toBe(true);
  });

  test('markAllNotificationsRead leaves OTHER recipient rows untouched', async () => {
    // Reset all unread state first.
    await f.service
      .from('notifications')
      .update({ read_at: null })
      .in('recipient_id', [f.userA.userId, f.userB.userId]);

    // userA marks all read.
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
    await markAllNotificationsRead();

    // userB row still unread.
    const { data } = await f.service
      .from('notifications')
      .select('read_at')
      .eq('id', notifBId)
      .single();
    expect(data?.read_at).toBeNull();
  });

  test('markAllNotificationsRead returns success when no unread rows exist (no-op)', async () => {
    // All rows for userA already read from the previous test.
    vi.mocked(auth.requireAuth).mockResolvedValue({
      id: f.userA.authUserId,
      email: f.userA.email,
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const result = await markAllNotificationsRead();
    expect(result).toEqual({ success: true });
  });
});
