import type { NotificationEventType } from '@/lib/notifications/events';

// Phase 1c §17 + Phase 9: timeline-UI labels per event_type. Separate from
// lib/notifications/subjects.ts because the timeline is one-line + structural
// (no greeting / CTA / link), while subjects.ts builds full email bodies.
//
// Labels intentionally do NOT include subject identity ("X moved …") —
// the timeline renders the actor's name in its own column. The label is
// the verb-phrase only.

const LABELS: Record<NotificationEventType, string> = {
  'auth.password_changed': 'changed their password',
  'team.invited': 'invited a teammate',
  'team.invitation_accepted': 'joined the team',
  'project.created': 'created the project',
  'project.stage_changed': 'moved the project to a new stage',
  'project.completed': 'completed the project',
  'stakeholder.invited': 'invited a stakeholder',
  'stakeholder.added_to_project': 'added a stakeholder',
  'message.new': 'sent a message',
  'file.uploaded': 'uploaded a file',
  'milestone.scheduled': 'scheduled a milestone',
  'milestone.completed': 'completed a milestone',
  'quote.sent': 'sent a quote',
  'quote.accepted': 'accepted a quote',
};

export function activityLabel(eventType: NotificationEventType): string {
  return LABELS[eventType] ?? eventType;
}

// Rich one-liner summary that includes payload-derived context (filename,
// stage names, etc.) — used as the second line under the verb phrase.
// Returns null when the event has no extra context worth surfacing.
export function activitySummary(
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): string | null {
  const s = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  switch (eventType) {
    case 'project.stage_changed': {
      const from = s(payload.fromStageName);
      const to = s(payload.toStageName);
      if (from && to) return `${from} → ${to}`;
      if (to) return `Now in ${to}`;
      return null;
    }
    case 'file.uploaded': {
      const filename = s(payload.filename);
      if (!filename) return null;
      const size =
        typeof payload.sizeBytes === 'number'
          ? formatBytes(payload.sizeBytes)
          : null;
      return size ? `${filename} (${size})` : filename;
    }
    case 'milestone.scheduled':
    case 'milestone.completed': {
      const label = s(payload.label);
      if (!label) return null;
      const when = s(payload.scheduledAt);
      if (!when) return label;
      try {
        return `${label} — ${new Date(when).toLocaleDateString('en-GB')}`;
      } catch {
        return label;
      }
    }
    case 'stakeholder.added_to_project': {
      const name = s(payload.stakeholderName);
      const role = s(payload.role);
      if (name && role) return `${name} as ${role}`;
      return name ?? null;
    }
    case 'message.new': {
      const snippet = s(payload.snippet);
      const sender = s(payload.senderName);
      if (snippet && sender) return `${sender}: "${snippet}"`;
      return snippet ?? null;
    }
    default:
      return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
