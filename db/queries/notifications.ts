import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { notifications } from '@/db/schema';
import type { NotificationEventType } from '@/lib/notifications/events';

// Phase 1c §17. Server-side query helpers for the in-app inbox.
// Filters by recipientType + recipientId so the same query works for users
// or clients. Results are sorted DESC by created_at — most-recent first.

export interface InboxNotification {
  id: string;
  channel: 'email' | 'in_app' | 'push' | 'sms';
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

const DEFAULT_LIMIT = 50;

// List the caller's in_app notifications, most-recent first. Filters to
// channel='in_app' since the inbox doesn't surface email-only rows
// (those are delivered via Resend and don't need a UI counterpart).
export async function listInboxNotifications(opts: {
  recipientType: 'user' | 'client';
  recipientId: string;
  limit?: number;
}): Promise<InboxNotification[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await db
    .select({
      id: notifications.id,
      channel: notifications.channel,
      eventType: notifications.eventType,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientType, opts.recipientType),
        eq(notifications.recipientId, opts.recipientId),
        eq(notifications.channel, 'in_app'),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel as InboxNotification['channel'],
    eventType: r.eventType as NotificationEventType,
    payload: r.payload as Record<string, unknown>,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }));
}

// Lightweight unread count for the bell badge in the nav layouts. Uses the
// idx_notifications_recipient_unread partial index (WHERE read_at IS NULL).
export async function unreadInAppCount(opts: {
  recipientType: 'user' | 'client';
  recipientId: string;
}): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientType, opts.recipientType),
        eq(notifications.recipientId, opts.recipientId),
        eq(notifications.channel, 'in_app'),
        isNull(notifications.readAt),
      ),
    );
  return rows.length;
}
