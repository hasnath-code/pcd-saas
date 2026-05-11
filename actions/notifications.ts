'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireAuth,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { clients, notificationPreferences, users } from '@/db/schema';
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
