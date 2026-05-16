// Phase 1c §17 — locked Session 11 event-type vocabulary.
//
// Adding a new event_type is additive: append to NOTIFICATION_EVENT_TYPES,
// then in the next user/client seed run the new entries will land via the
// idempotent ON CONFLICT path. The DB schema does NOT use an enum for
// event_type (plain text per ADR-008 + spec §17 "extensible"), so no
// migration is required to add an entry.
//
// Channels stay frozen at four: in_app and email are wired in Phase 1c;
// push and sms are scaffolded (seeded, schema-supported) but the dispatcher
// rejects them as not-yet-implemented until Phase 4+.

export const NOTIFICATION_EVENT_TYPES = [
  'auth.password_changed',
  'team.invited',
  'team.invitation_accepted',
  'project.created',
  'project.stage_changed',
  'project.completed',
  'stakeholder.invited',
  'stakeholder.added_to_project',
  'message.new',
  'file.uploaded',
  'milestone.scheduled',
  'milestone.completed',
  // Phase 2 Session 12: quote lifecycle. Used as activity-row event types
  // (logActivityTx requires NotificationEventType). Session 13 wired
  // dispatchNotification fan-out for both (org members + can_view_financials
  // stakeholders) and shipped migration 0027 to backfill existing identities'
  // notification_preferences rows — see DEBT-064 resolution.
  'quote.sent',
  'quote.accepted',
  // Phase 2 Session 13: invoice lifecycle + payment lifecycle. Dispatch is
  // wired for invoice.sent (org + financial-visible stakeholders, plus a
  // direct client email) and payment.recorded (org + financial-visible
  // stakeholders). invoice.revised + payment.corrected are activity-only
  // by design — kept in the exhaustive maps so future UI / preferences
  // matrix work doesn't grow drift.
  //
  //   payment.corrected dispatch recipient resolution: ORG MEMBERS ONLY
  //   (no stakeholders, no client email). Corrections are administrative.
  //
  // Existing identities got rows for these via migration 0027; new identities
  // get them via the seedNotificationDefaultsTx path on identity creation.
  'invoice.sent',
  'invoice.revised',
  'payment.recorded',
  'payment.corrected',
  // Phase 2 Session 14: receipt lifecycle. receipt.generated fires from
  // recordPayment in the same tx as payment.recorded — the receipt is a
  // distinct first-class artifact in the timeline, but no separate
  // dispatchNotification fan-out (recipients + payload are the same as
  // payment.recorded; a second fan-out would be notification spam).
  // receipt.revised fires from reviseReceipt — activity-only, mirroring
  // invoice.revised's no-dispatch policy.
  'receipt.generated',
  'receipt.revised',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

// Phase 2 financial event types — quote / invoice / payment / receipt
// lifecycle. These carry financial detail (amounts, document numbers) into the
// project_activity timeline. A stakeholder without can_view_financials must not
// see them even though they are logged visible_to_stakeholders=true (correct
// for a financial stakeholder): listProjectActivity filters them at read time
// for non-financial stakeholders (DEBT-066). Maintained as an explicit list —
// not a 'quote.*'-style prefix match — so a future non-financial event in one
// of these namespaces isn't silently hidden.
export const FINANCIAL_EVENT_TYPES = [
  'quote.sent',
  'quote.accepted',
  'invoice.sent',
  'invoice.revised',
  'payment.recorded',
  'payment.corrected',
  'receipt.generated',
  'receipt.revised',
] as const satisfies readonly NotificationEventType[];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'sms'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Default-on channels per §17. The seed writes ALL channel × event rows so
// the preferences matrix has a complete row set; non-default channels start
// at enabled=false.
export const DEFAULT_ENABLED_CHANNELS: ReadonlySet<NotificationChannel> = new Set([
  'in_app',
  'email',
]);
