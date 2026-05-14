import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'drizzle-orm';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { db } from '@/db';

// Phase 2 Session 13 — DEBT-064 backfill migration (0027).
//
// The migration is one-shot at deploy time; the test re-executes the same
// INSERT … SELECT logic to verify:
//   1. Existing identities WITHOUT prefs for the new event types get them
//      after the backfill runs.
//   2. The defaults match DEFAULT_ENABLED_CHANNELS (in_app + email on,
//      push + sms off).
//   3. Re-running the backfill is a no-op (idempotent via ON CONFLICT
//      DO NOTHING on the two notification_preferences UNIQUEs).

const NEW_EVENT_TYPES = [
  'quote.sent',
  'quote.accepted',
  'invoice.sent',
  'invoice.revised',
  'payment.recorded',
  'payment.corrected',
] as const;

const CHANNELS = ['in_app', 'email', 'push', 'sms'] as const;
const DEFAULT_ON = new Set(['in_app', 'email']);

// Re-execution of migration 0027's INSERT … SELECT pattern. Kept identical
// to the migration body except parameterized by org_id to avoid touching
// other test fixtures' identities (the migration backfills everyone; the
// test scopes to a single org's identities).
async function runBackfillForOrg(orgId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.notification_preferences (id, user_id, client_id, channel, event_type, enabled)
    SELECT
      gen_random_uuid(),
      u.id,
      NULL,
      ch.channel,
      et.event_type,
      ch.channel IN ('in_app', 'email')
    FROM public.users u
    CROSS JOIN (VALUES ('in_app'), ('email'), ('push'), ('sms')) AS ch(channel)
    CROSS JOIN (
      VALUES
        ('quote.sent'),
        ('quote.accepted'),
        ('invoice.sent'),
        ('invoice.revised'),
        ('payment.recorded'),
        ('payment.corrected')
    ) AS et(event_type)
    WHERE u.deleted_at IS NULL
      AND u.org_id = ${orgId}::uuid
    ON CONFLICT DO NOTHING;
  `);

  await db.execute(sql`
    INSERT INTO public.notification_preferences (id, user_id, client_id, channel, event_type, enabled)
    SELECT
      gen_random_uuid(),
      NULL,
      c.id,
      ch.channel,
      et.event_type,
      ch.channel IN ('in_app', 'email')
    FROM public.clients c
    JOIN public.client_org_memberships m ON m.client_id = c.id
    CROSS JOIN (VALUES ('in_app'), ('email'), ('push'), ('sms')) AS ch(channel)
    CROSS JOIN (
      VALUES
        ('quote.sent'),
        ('quote.accepted'),
        ('invoice.sent'),
        ('invoice.revised'),
        ('payment.recorded'),
        ('payment.corrected')
    ) AS et(event_type)
    WHERE c.deleted_at IS NULL
      AND m.org_id = ${orgId}::uuid
    ON CONFLICT DO NOTHING;
  `);
}

async function fetchPrefsFor(
  service: TwoOrgFixture['service'],
  identityColumn: 'user_id' | 'client_id',
  identityId: string,
) {
  const { data, error } = await service
    .from('notification_preferences')
    .select('channel, event_type, enabled')
    .eq(identityColumn, identityId)
    .in('event_type', NEW_EVENT_TYPES as readonly string[]);
  if (error) throw new Error(`fetchPrefsFor: ${error.message}`);
  return data ?? [];
}

describe('DEBT-064 backfill — seeds existing identities for new event types', () => {
  let f: TwoOrgFixture;
  let freshClientId: string;

  beforeAll(async () => {
    f = await createTwoOrgFixture();

    // Insert a fresh client (no membership-via-invite path → no auto-seed of
    // notification_preferences). Attached to orgA so the scoped backfill
    // picks it up.
    freshClientId = uuidv7();
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    await f.service.from('clients').insert({
      id: freshClientId,
      auth_user_id: null,
      email: `debt064-fresh-${ts}-${rnd}@test.local`,
      name: 'DEBT-064 Fresh Client',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: freshClientId,
      org_id: f.orgA.id,
    });

    // Clear any pre-existing prefs for these identities (just the new event
    // types) so we can assert the backfill actually inserts them. Fixture
    // users don't auto-seed prefs, but other tests in the same DB session
    // may have run the seed path; this keeps the assertion clean.
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('user_id', f.userA.userId)
      .in('event_type', NEW_EVENT_TYPES as readonly string[]);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('client_id', freshClientId)
      .in('event_type', NEW_EVENT_TYPES as readonly string[]);
  });

  afterAll(async () => {
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('user_id', f.userA.userId)
      .in('event_type', NEW_EVENT_TYPES as readonly string[]);
    await f.service
      .from('notification_preferences')
      .delete()
      .eq('client_id', freshClientId)
      .in('event_type', NEW_EVENT_TYPES as readonly string[]);
    await f.service
      .from('client_org_memberships')
      .delete()
      .eq('client_id', freshClientId);
    await f.service.from('clients').delete().eq('id', freshClientId);
    await f.cleanup();
  });

  test('precondition: identities have no prefs for the new event types', async () => {
    const userPrefs = await fetchPrefsFor(f.service, 'user_id', f.userA.userId);
    const clientPrefs = await fetchPrefsFor(f.service, 'client_id', freshClientId);
    expect(userPrefs).toEqual([]);
    expect(clientPrefs).toEqual([]);
  });

  test('after backfill, each identity has 24 rows (6 events × 4 channels) with correct defaults', async () => {
    await runBackfillForOrg(f.orgA.id);

    const userPrefs = await fetchPrefsFor(f.service, 'user_id', f.userA.userId);
    const clientPrefs = await fetchPrefsFor(f.service, 'client_id', freshClientId);

    expect(userPrefs).toHaveLength(NEW_EVENT_TYPES.length * CHANNELS.length);
    expect(clientPrefs).toHaveLength(NEW_EVENT_TYPES.length * CHANNELS.length);

    for (const row of userPrefs) {
      const expected = DEFAULT_ON.has(row.channel);
      expect(row.enabled).toBe(expected);
    }
    for (const row of clientPrefs) {
      const expected = DEFAULT_ON.has(row.channel);
      expect(row.enabled).toBe(expected);
    }
  });

  test('re-running the backfill is idempotent (no new rows on second run)', async () => {
    const beforeUser = await fetchPrefsFor(f.service, 'user_id', f.userA.userId);
    const beforeClient = await fetchPrefsFor(f.service, 'client_id', freshClientId);

    await runBackfillForOrg(f.orgA.id);

    const afterUser = await fetchPrefsFor(f.service, 'user_id', f.userA.userId);
    const afterClient = await fetchPrefsFor(f.service, 'client_id', freshClientId);

    expect(afterUser.length).toBe(beforeUser.length);
    expect(afterClient.length).toBe(beforeClient.length);
  });
});
