-- =============================================================================
-- Phase 2 Session 13 — DEBT-064 backfill.
--
-- Session 11 wired per-identity seed-on-create logic (seedNotificationDefaultsTx
-- in lib/notifications/seed-defaults.ts), called from the 4 identity-creating
-- entry points (createOrganization / acceptInvitation / findOrCreateClientTx /
-- acceptStakeholderInvitation). New identities get 12 events × 4 channels = 48
-- prefs rows on creation.
--
-- Phase 2 Session 12 introduced `quote.sent` + `quote.accepted` event types
-- but deferred dispatch wiring — so existing identities didn't get rows for
-- the new types. Session 13 wires dispatch + introduces 4 more event types
-- (`invoice.sent`, `invoice.revised`, `payment.recorded`, `payment.corrected`).
-- Without this backfill, existing identities would silently never receive
-- notifications for these types (the dispatcher's preference lookup would
-- return 0 enabled-channels and skip every recipient).
--
-- Strategy: INSERT ... SELECT cross-joins each existing identity with the
-- 6 new event types × 4 channels, with `enabled` defaulted to mirror
-- DEFAULT_ENABLED_CHANNELS (in_app + email on, push + sms off).
-- `ON CONFLICT DO NOTHING` uses either of the two UNIQUE constraints on
-- notification_preferences:
--   (user_id, channel, event_type) — when user_id is set
--   (client_id, channel, event_type) — when client_id is set
-- Drizzle's onConflictDoNothing without a target clause hits both — which is
-- exactly the semantics we want here: re-running the migration is a no-op.
--
-- Soft-deleted identities (deleted_at IS NOT NULL) are excluded — they don't
-- need prefs since they can't sign in. If they later get restored, the seed
-- runs through findOrCreateClient / re-invite paths and lands the same rows.
--
-- Why the migration uses gen_random_uuid() rather than the uuid_v7 generator:
-- notification_preferences id values are not index-locality sensitive (the
-- hot indexes are the two UNIQUE constraints on identity + channel + event).
-- Matches migration 0009's seed pattern.
-- =============================================================================

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
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO public.notification_preferences (id, user_id, client_id, channel, event_type, enabled)
SELECT
  gen_random_uuid(),
  NULL,
  c.id,
  ch.channel,
  et.event_type,
  ch.channel IN ('in_app', 'email')
FROM public.clients c
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
ON CONFLICT DO NOTHING;
