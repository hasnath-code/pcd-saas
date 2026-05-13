import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import { db, type DbOrTx } from '@/db';
import { clients, notificationPreferences, notifications, users } from '@/db/schema';
import { sendEmail } from '@/lib/email/send';
import { getAppUrl } from '@/lib/get-app-url';
import { notificationGenericEmail } from '@/lib/email/templates/notification-generic';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel,
  type NotificationEventType,
} from './events';
import {
  NOTIFICATION_CONTENT,
  rewriteCtaForRecipient,
  type NotificationPayload,
} from './subjects';

// Phase 1c §17 — best-effort synchronous dispatcher. Reads
// notification_preferences for the (recipient, event_type) triple, inserts
// one notifications row per enabled channel, then calls deliverPending() to
// drive email sends (Resend). in_app rows need no extra work — the
// supabase_realtime publication broadcasts on INSERT (added in 0021).
//
// Hard rules locked in by Session 11 plan:
//   - Hard Rule 4 (synchronous in Phase 1c): no queue (Inngest/Trigger.dev).
//   - Hard Rule 5 (Realtime via insert): no separate broadcast call.
//   - Hard Rule 26 / ADR-032: all outgoing URLs through getAppUrl().
//   - Hard Rule 8: subject/body strings live in lib/notifications/subjects.ts.
//   - Kickoff scope: push + sms inserted but immediately failed
//     (channel_not_implemented). Schema supports them; dispatcher doesn't.
//
// Caller pattern: action server function calls dispatchNotification(...) for
// each recipient. Per Decision 3 from the kickoff plan, no grouping — 5
// uploads in 10 seconds dispatch 5 separate notifications.

const EVENT_TYPE_SET: ReadonlySet<NotificationEventType> = new Set(
  NOTIFICATION_EVENT_TYPES,
);

export interface DispatchOptions {
  recipientType: 'user' | 'client';
  recipientId: string;
  eventType: NotificationEventType;
  payload: NotificationPayload;
  /** Optional outer transaction. Defaults to top-level `db`. */
  tx?: DbOrTx;
}

export interface DispatchResult {
  inserted: number;
  emailDelivered: number;
  emailFailed: number;
  pushSmsSkipped: number;
  unknownEventType?: true;
}

export class UnknownEventTypeError extends Error {
  constructor(eventType: string) {
    super(`unknown notification event_type: ${eventType}`);
    this.name = 'UnknownEventTypeError';
  }
}

export async function dispatchNotification(
  opts: DispatchOptions,
): Promise<DispatchResult> {
  if (!EVENT_TYPE_SET.has(opts.eventType)) {
    throw new UnknownEventTypeError(opts.eventType);
  }
  const tx = opts.tx ?? db;

  const ownerColumn =
    opts.recipientType === 'user'
      ? notificationPreferences.userId
      : notificationPreferences.clientId;

  const prefs = await tx
    .select({
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(ownerColumn, opts.recipientId),
        eq(notificationPreferences.eventType, opts.eventType),
      ),
    );

  const enabledChannels = prefs
    .filter((p) => p.enabled === true)
    .map((p) => p.channel as NotificationChannel)
    .filter((c): c is NotificationChannel =>
      (NOTIFICATION_CHANNELS as readonly string[]).includes(c),
    );

  if (enabledChannels.length === 0) {
    return { inserted: 0, emailDelivered: 0, emailFailed: 0, pushSmsSkipped: 0 };
  }

  // Insert one row per enabled channel. Each row gets its own UUID and a
  // shared payload snapshot — the dispatcher is not idempotent on
  // (recipient, event, channel); two dispatches for the same logical event
  // produce two rows per channel by design.
  const rowsToInsert = enabledChannels.map((channel) => ({
    id: uuidv7(),
    recipientType: opts.recipientType,
    recipientId: opts.recipientId,
    channel,
    eventType: opts.eventType,
    payload: opts.payload,
  }));
  const inserted = await tx
    .insert(notifications)
    .values(rowsToInsert)
    .returning({
      id: notifications.id,
      channel: notifications.channel,
    });

  // Drive delivery. in_app needs nothing — the supabase_realtime publication
  // broadcasts on INSERT. push/sms get a failure stamp. email gets a real
  // send attempt.
  const result = await deliverPending(tx, inserted, {
    recipientType: opts.recipientType,
    recipientId: opts.recipientId,
    eventType: opts.eventType,
    payload: opts.payload,
  });

  return { inserted: inserted.length, ...result };
}

// deliverPending acts on the specific rows just inserted by
// dispatchNotification. The naming follows the §17 spec literal; the
// implementation is row-targeted (not a table scan) because a scan would
// open us up to concurrent dispatchers double-sending the same email.
// Phase 4+ may revisit if a queue worker is introduced — at which point
// this function becomes the worker entry point.
async function deliverPending(
  tx: DbOrTx,
  rows: { id: string; channel: string }[],
  ctx: {
    recipientType: 'user' | 'client';
    recipientId: string;
    eventType: NotificationEventType;
    payload: NotificationPayload;
  },
): Promise<{ emailDelivered: number; emailFailed: number; pushSmsSkipped: number }> {
  let emailDelivered = 0;
  let emailFailed = 0;
  let pushSmsSkipped = 0;

  // Resolve recipient email + name lazily — only if we actually have an
  // email row to send. Two-row dispatch (in_app + email) costs one
  // recipient lookup; in_app-only dispatch costs zero.
  let recipientEmail: string | null = null;
  let recipientName: string | null = null;
  async function resolveRecipient() {
    if (recipientEmail !== null) return;
    if (ctx.recipientType === 'user') {
      const [row] = await tx
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(and(eq(users.id, ctx.recipientId), isNull(users.deletedAt)))
        .limit(1);
      recipientEmail = row?.email ?? '';
      recipientName = row?.name ?? null;
    } else {
      const [row] = await tx
        .select({ email: clients.email, name: clients.name })
        .from(clients)
        .where(and(eq(clients.id, ctx.recipientId), isNull(clients.deletedAt)))
        .limit(1);
      recipientEmail = row?.email ?? '';
      recipientName = row?.name ?? null;
    }
  }

  const now = () => new Date();

  for (const row of rows) {
    if (row.channel === 'in_app') {
      // Realtime publication broadcasts on INSERT — no action needed here.
      continue;
    }

    if (row.channel === 'push' || row.channel === 'sms') {
      pushSmsSkipped++;
      await tx
        .update(notifications)
        .set({
          failedAt: now(),
          failureReason: 'channel_not_implemented',
        })
        .where(eq(notifications.id, row.id));
      continue;
    }

    if (row.channel === 'email') {
      await resolveRecipient();
      if (!recipientEmail) {
        emailFailed++;
        await tx
          .update(notifications)
          .set({
            failedAt: now(),
            failureReason: 'recipient_email_not_found',
          })
          .where(eq(notifications.id, row.id));
        continue;
      }

      const content = NOTIFICATION_CONTENT[ctx.eventType](ctx.payload);
      const ctaPath = rewriteCtaForRecipient(content.ctaPath, ctx.recipientType);
      const origin = getAppUrl();
      const ctaUrl = `${origin}${ctaPath}`;
      const preferencesUrl = `${origin}${
        ctx.recipientType === 'client'
          ? '/portal/settings/notifications'
          : '/settings/notifications'
      }`;
      const rendered = notificationGenericEmail({
        subject: content.subject,
        bodyText: content.bodyText,
        ctaUrl,
        ctaLabel: content.ctaLabel,
        eventType: ctx.eventType,
        preferencesUrl,
      });

      try {
        await sendEmail({
          to: recipientEmail,
          subject: rendered.subject,
          html: rendered.html,
          template: `notification:${ctx.eventType}`,
        });
        emailDelivered++;
        await tx
          .update(notifications)
          .set({ sentAt: now() })
          .where(eq(notifications.id, row.id));
      } catch (e) {
        emailFailed++;
        const reason = e instanceof Error ? e.message : String(e);
        await tx
          .update(notifications)
          .set({
            failedAt: now(),
            failureReason: reason.slice(0, 500),
          })
          .where(eq(notifications.id, row.id));
        // Sentry breadcrumb for ops visibility — the row's failure_reason
        // is the durable record, this is just for triage on production.
        Sentry.captureException(e, {
          tags: {
            scope: 'notifications_dispatch',
            event_type: ctx.eventType,
            recipient_type: ctx.recipientType,
          },
        });
      }
      continue;
    }

    // Unknown channel (DB CHECK should prevent this, but defense-in-depth).
    await tx
      .update(notifications)
      .set({
        failedAt: now(),
        failureReason: `unknown_channel:${row.channel}`,
      })
      .where(eq(notifications.id, row.id));
  }

  return { emailDelivered, emailFailed, pushSmsSkipped };
}
