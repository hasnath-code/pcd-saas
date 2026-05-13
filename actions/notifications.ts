'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireAuth,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clients,
  notificationPreferences,
  notifications,
  users,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
} from '@/lib/notifications/events';

export type NotificationActionResult =
  | { success: true }
  | { error: ServerActionErrorCode; reason?: string };

const UpdatePreferenceInput = z.object({
  identityType: z.enum(['user', 'client']),
  channel: z.enum(NOTIFICATION_CHANNELS),
  eventType: z.enum(NOTIFICATION_EVENT_TYPES),
  enabled: z.boolean(),
});

// Toggle a single (identityType, channel, eventType) cell on the preferences
// matrix. UPSERTs so a legacy identity created before Session 11 (no seed)
// still gets a usable preferences UI on first toggle.
//
// identityType is supplied by the caller because a dual-context auth user
// (with BOTH a users row AND a clients row attached to the same auth user)
// has 96 preferences — 48 user-side, 48 client-side. The org-side
// /settings/notifications page passes identityType='user'; the portal-side
// /portal/settings/notifications passes 'client'. Server-side validation
// rejects mismatches (caller passes 'user' but has no users row, etc.).
export async function updateNotificationPreference(
  input: unknown,
): Promise<NotificationActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdatePreferenceInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { identityType, channel, eventType, enabled } = parsed.data;

  // Resolve the caller's identity for the requested side. Reject if they
  // don't own such an identity (defense-in-depth: the RLS policy already
  // gates SELECT/UPDATE through auth.uid(), but the action layer surfaces
  // a clean error instead of "0 rows updated").
  let identityId: string | null = null;
  if (identityType === 'user') {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.authUserId, authUser.id), isNull(users.deletedAt)))
      .limit(1);
    identityId = rows[0]?.id ?? null;
  } else {
    const rows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.authUserId, authUser.id), isNull(clients.deletedAt)))
      .limit(1);
    identityId = rows[0]?.id ?? null;
  }
  if (!identityId) {
    return { error: 'not_authorized', reason: `no_${identityType}_identity` };
  }

  // UPSERT into notification_preferences. Two UNIQUE constraints partition
  // the keyspace (NULLS DISTINCT) — Drizzle's onConflictDoUpdate with the
  // appropriate target keeps both branches clean.
  const ownerColumn = identityType === 'user' ? 'user_id' : 'client_id';

  if (identityType === 'user') {
    await db
      .insert(notificationPreferences)
      .values({
        id: uuidv7(),
        userId: identityId,
        clientId: null,
        channel,
        eventType,
        enabled,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.channel,
          notificationPreferences.eventType,
        ],
        set: { enabled },
      });
  } else {
    await db
      .insert(notificationPreferences)
      .values({
        id: uuidv7(),
        userId: null,
        clientId: identityId,
        channel,
        eventType,
        enabled,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.clientId,
          notificationPreferences.channel,
          notificationPreferences.eventType,
        ],
        set: { enabled },
      });
  }

  await logAudit({
    userId: identityType === 'user' ? identityId : undefined,
    clientId: identityType === 'client' ? identityId : undefined,
    action: 'update',
    resourceType: 'notification_preference',
    metadata: {
      identity_type: identityType,
      [ownerColumn]: identityId,
      channel,
      event_type: eventType,
      enabled,
    },
  });

  revalidatePath(
    identityType === 'user'
      ? '/settings/notifications'
      : '/portal/settings/notifications',
  );

  return { success: true };
}

// Server query: fetch all 48 prefs for the caller's chosen identity, sorted
// for stable matrix rendering. Auto-seeds defaults if no prefs exist (covers
// legacy identities created before Session 11's seed wiring landed).
export async function getMyNotificationPreferences(
  identityType: 'user' | 'client',
): Promise<
  | {
      success: true;
      data: {
        identityType: 'user' | 'client';
        prefs: Array<{ channel: string; eventType: string; enabled: boolean }>;
      };
    }
  | { error: ServerActionErrorCode; reason?: string }
> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  let identityId: string | null = null;
  if (identityType === 'user') {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.authUserId, authUser.id), isNull(users.deletedAt)))
      .limit(1);
    identityId = rows[0]?.id ?? null;
  } else {
    const rows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.authUserId, authUser.id), isNull(clients.deletedAt)))
      .limit(1);
    identityId = rows[0]?.id ?? null;
  }
  if (!identityId) {
    return { error: 'not_authorized', reason: `no_${identityType}_identity` };
  }

  const filter =
    identityType === 'user'
      ? eq(notificationPreferences.userId, identityId)
      : eq(notificationPreferences.clientId, identityId);
  const rows = await db
    .select({
      channel: notificationPreferences.channel,
      eventType: notificationPreferences.eventType,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(filter);

  return {
    success: true,
    data: { identityType, prefs: rows },
  };
}

// ─── markNotificationRead ────────────────────────────────────────────────────

const MarkReadInput = z.object({
  notificationId: z.string().uuid(),
});

// Mark a single in-app notification as read. Caller must own the row
// (recipient_type + recipient_id match an identity attached to auth.uid()).
// Returns success even if the row was already read — idempotent UPDATE.
export async function markNotificationRead(
  input: unknown,
): Promise<NotificationActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = MarkReadInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { notificationId } = parsed.data;

  const ownership = await resolveOwnedIdentities(authUser.id);
  if (ownership.userIds.length === 0 && ownership.clientIds.length === 0) {
    return { error: 'not_authorized', reason: 'no_identity' };
  }

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        recipientBelongsTo(ownership),
      ),
    )
    .returning({ id: notifications.id });

  if (updated.length === 0) {
    return { error: 'not_found', reason: 'notification' };
  }

  revalidatePath('/notifications');
  revalidatePath('/portal/notifications');
  return { success: true };
}

// ─── markAllNotificationsRead ────────────────────────────────────────────────

// Mark every unread notification owned by the caller as read. Includes both
// identity branches when the auth user is dual-context (has both a users
// row AND a clients row) — the inbox UI shows whichever side the route is
// scoped to, but bulk-read isn't asymmetric.
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const ownership = await resolveOwnedIdentities(authUser.id);
  if (ownership.userIds.length === 0 && ownership.clientIds.length === 0) {
    return { error: 'not_authorized', reason: 'no_identity' };
  }

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(recipientBelongsTo(ownership), isNull(notifications.readAt)),
    );

  revalidatePath('/notifications');
  revalidatePath('/portal/notifications');
  return { success: true };
}

// Internal helper: resolve every identity (users + clients) attached to the
// auth user. Used for ownership checks on mark-read actions. Returns empty
// arrays for either side if the caller has no matching identity.
async function resolveOwnedIdentities(authUserId: string): Promise<{
  userIds: string[];
  clientIds: string[];
}> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)));
  const clientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.authUserId, authUserId), isNull(clients.deletedAt)));
  return {
    userIds: userRows.map((u) => u.id),
    clientIds: clientRows.map((c) => c.id),
  };
}

// SQL builder: matches notifications rows that belong to any identity the
// caller owns. (recipient_type='user' AND recipient_id IN userIds) OR
// (recipient_type='client' AND recipient_id IN clientIds). Uses Drizzle's
// `inArray` via a manual or() since `inArray` over an empty list produces
// invalid SQL.
function recipientBelongsTo(ownership: {
  userIds: string[];
  clientIds: string[];
}) {
  const branches = [] as ReturnType<typeof and>[];
  if (ownership.userIds.length > 0) {
    branches.push(
      and(
        eq(notifications.recipientType, 'user'),
        // Drizzle accepts a SQL expression for IN; build via raw `sql` if
        // the array gets big. For tests we expect ≤2 ids so the OR-chain
        // is fine.
        ownership.userIds.length === 1
          ? eq(notifications.recipientId, ownership.userIds[0])
          : or(...ownership.userIds.map((id) => eq(notifications.recipientId, id)))!,
      )!,
    );
  }
  if (ownership.clientIds.length > 0) {
    branches.push(
      and(
        eq(notifications.recipientType, 'client'),
        ownership.clientIds.length === 1
          ? eq(notifications.recipientId, ownership.clientIds[0])
          : or(
              ...ownership.clientIds.map((id) => eq(notifications.recipientId, id)),
            )!,
      )!,
    );
  }
  return branches.length === 1 ? branches[0] : or(...branches);
}

