import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx } from '@/db';
import { notificationPreferences } from '@/db/schema';
import {
  DEFAULT_ENABLED_CHANNELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
} from './events';

// Phase 1c §17 — seed default notification preferences for a fresh identity.
//
// Writes 12 events × 4 channels = 48 rows per identity. In-app + email start
// enabled; push + sms start disabled (schema-supported, dispatcher-rejected
// in Phase 1c). Idempotent via ON CONFLICT DO NOTHING on the per-identity
// UNIQUE constraint — safe to call when prefs may already exist (e.g.
// findOrCreateClientTx reuses a globally-known clients row whose prefs were
// seeded by another org's prior invite).
//
// Caller passes EXACTLY ONE of userId / clientId. The notification_preferences
// XOR CHECK enforces this at the DB layer; passing both throws a Postgres
// error and rolls back the surrounding transaction.
//
// Returns the number of rows that were actually inserted (0 means the
// identity was already fully seeded).
export async function seedNotificationDefaultsTx(
  tx: DbOrTx,
  ownership: { userId: string } | { clientId: string },
): Promise<{ inserted: number }> {
  const userId = 'userId' in ownership ? ownership.userId : null;
  const clientId = 'clientId' in ownership ? ownership.clientId : null;

  if ((userId === null) === (clientId === null)) {
    // Same XOR error the DB CHECK would raise — surface it earlier with a
    // clearer message before we generate 48 rows worth of values.
    throw new Error(
      'seedNotificationDefaultsTx: pass exactly one of userId / clientId',
    );
  }

  const rows = NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      id: uuidv7(),
      userId,
      clientId,
      channel,
      eventType,
      enabled: DEFAULT_ENABLED_CHANNELS.has(channel),
    })),
  );

  // Two UNIQUEs cover both ownership branches:
  //   (user_id, channel, event_type) — onConflictDoNothing scoped here when userId set
  //   (client_id, channel, event_type) — scoped here when clientId set
  // Drizzle's onConflictDoNothing without `target` uses any conflict, which
  // is exactly what we want — either UNIQUE collides depending on which
  // identity is set.
  const result = await tx
    .insert(notificationPreferences)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notificationPreferences.id });

  return { inserted: result.length };
}
