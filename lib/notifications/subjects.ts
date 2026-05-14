import type { NotificationEventType } from './events';

// Phase 1c Session 11 §17 + Hard Rule 8: every notification subject + body
// + CTA originates here. No scattered strings across actions, templates,
// or UI components. Adding a new event_type requires both:
//   1. Append to NOTIFICATION_EVENT_TYPES in ./events.ts
//   2. Add the matching content builder to NOTIFICATION_CONTENT below
// The exhaustive Record<NotificationEventType, ...> type enforces (2)
// at compile time.
//
// CTA URLs are relative paths. The email template prepends getAppUrl()
// per ADR-032 / Hard Rule 26 so origin resolution stays centralized.
//
// Payload shape is intentionally typed as Record<string, unknown> because
// the dispatcher is event-type-agnostic; each builder narrows the shape
// it cares about with defensive defaults so a missing field never
// crashes the email render.

export type NotificationPayload = Record<string, unknown>;

export interface NotificationContent {
  /** Email subject line. */
  subject: string;
  /** Plain-text email body (HTML template wraps + escapes). */
  bodyText: string;
  /** Visible CTA button text. */
  ctaLabel: string;
  /** Path component appended to getAppUrl() — must start with '/'. */
  ctaPath: string;
}

export type NotificationContentBuilder = (
  payload: NotificationPayload,
) => NotificationContent;

// Best-effort string coercion with a fallback so a missing payload key
// doesn't produce "undefined" in customer-visible copy.
function s(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value;
}

function projectPath(payload: NotificationPayload, side: 'org' | 'portal'): string {
  const projectId = s(payload.projectId, '');
  if (!projectId) return side === 'org' ? '/dashboard/projects' : '/portal/projects';
  return side === 'org'
    ? `/dashboard/projects/${projectId}`
    : `/portal/projects/${projectId}`;
}

// CTA path defaults to the org-side route; the dispatcher overrides on
// recipientType='client' by rewriting /dashboard/... → /portal/... at
// render time. Keeping the table org-side keeps the surface small.
export const NOTIFICATION_CONTENT: Record<
  NotificationEventType,
  NotificationContentBuilder
> = {
  'auth.password_changed': () => ({
    subject: 'Your PCD password was changed',
    bodyText:
      'Your password was just changed. If this was you, no action is needed. If you did not request this change, please reset your password immediately.',
    ctaLabel: 'Open PCD',
    ctaPath: '/',
  }),
  'team.invited': (p) => ({
    subject: `You've been invited to ${s(p.orgName, 'an organization')} on PCD`,
    bodyText: `${s(p.inviterName, 'A teammate')} invited you to join ${s(p.orgName, 'their organization')} on PCD.`,
    ctaLabel: 'Accept invitation',
    ctaPath: s(p.acceptPath, '/invitations'),
  }),
  'team.invitation_accepted': (p) => ({
    subject: `${s(p.inviteeName, 'A new teammate')} joined ${s(p.orgName, 'your organization')}`,
    bodyText: `${s(p.inviteeName, 'A new teammate')} just accepted your invitation and joined ${s(p.orgName, 'your organization')} on PCD.`,
    ctaLabel: 'View team',
    ctaPath: '/settings/team',
  }),
  'project.created': (p) => ({
    subject: `New project: ${s(p.projectNumber, 'untitled')}`,
    bodyText: `A new project (${s(p.projectNumber, 'untitled')}) was created${p.siteAddress ? ` at ${s(p.siteAddress, '')}` : ''}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'project.stage_changed': (p) => ({
    subject: `${s(p.projectNumber, 'A project')} moved to ${s(p.toStageName, 'a new stage')}`,
    bodyText: `${s(p.projectNumber, 'A project')} was moved from ${s(p.fromStageName, 'its previous stage')} to ${s(p.toStageName, 'a new stage')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'project.completed': (p) => ({
    subject: `${s(p.projectNumber, 'A project')} is complete`,
    bodyText: `${s(p.projectNumber, 'A project')} reached its final stage and is marked complete.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'stakeholder.invited': (p) => ({
    subject: `Invitation to collaborate on ${s(p.projectNumber, 'a project')}`,
    bodyText: `${s(p.inviterName, 'A surveyor')} invited you to collaborate on ${s(p.projectNumber, 'a project')} on PCD.`,
    ctaLabel: 'Accept invitation',
    ctaPath: s(p.acceptPath, '/invitations'),
  }),
  'stakeholder.added_to_project': (p) => ({
    subject: `${s(p.stakeholderName, 'A stakeholder')} joined ${s(p.projectNumber, 'a project')}`,
    bodyText: `${s(p.stakeholderName, 'A new stakeholder')} (${s(p.stakeholderEmail, 'unknown email')}) was added to ${s(p.projectNumber, 'a project')} as ${s(p.role, 'a collaborator')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'message.new': (p) => ({
    subject: `New message in ${s(p.conversationName, 'a conversation')}`,
    bodyText: `${s(p.senderName, 'Someone')} posted in ${s(p.conversationName, 'a conversation')}: "${s(p.snippet, '...')}"`,
    ctaLabel: 'Open conversation',
    ctaPath: s(p.conversationId, '')
      ? `/conversations/${s(p.conversationId, '')}`
      : '/conversations',
  }),
  'file.uploaded': (p) => ({
    subject: `${s(p.filename, 'A file')} was uploaded to ${s(p.projectNumber, 'a project')}`,
    bodyText: `${s(p.uploaderName, 'Someone')} uploaded ${s(p.filename, 'a file')} to ${s(p.projectNumber, 'a project')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'milestone.scheduled': (p) => ({
    subject: `Milestone scheduled: ${s(p.label, 'a milestone')}`,
    bodyText: `A new milestone "${s(p.label, 'a milestone')}" was scheduled${p.scheduledAt ? ` for ${s(p.scheduledAt, '')}` : ''} on ${s(p.projectNumber, 'a project')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'milestone.completed': (p) => ({
    subject: `Milestone completed: ${s(p.label, 'a milestone')}`,
    bodyText: `The milestone "${s(p.label, 'a milestone')}" on ${s(p.projectNumber, 'a project')} was marked complete.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  // Phase 2 Session 12 stubs — used as activity event types only this
  // session; no dispatchNotification calls yet. Strings are written as if
  // they were dispatchable so Session 13/14 can wire dispatches without
  // editing copy. Recipient-side rewrite still applies to ctaPath.
  'quote.sent': (p) => ({
    subject: `Quote ${s(p.documentNumber, '')} sent`,
    bodyText: `Quote ${s(p.documentNumber, '')} on ${s(p.projectNumber, 'a project')} was sent to the client.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'quote.accepted': (p) => ({
    subject: `Quote ${s(p.documentNumber, '')} accepted`,
    bodyText: `Quote ${s(p.documentNumber, '')} on ${s(p.projectNumber, 'a project')} was accepted by ${s(p.acceptedByName, 'the client')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  // Phase 2 Session 13 — invoice + payment events.
  'invoice.sent': (p) => ({
    subject: `Invoice ${s(p.documentNumber, '')} sent`,
    bodyText: `Invoice ${s(p.documentNumber, '')} on ${s(p.projectNumber, 'a project')} was sent to the client.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'invoice.revised': (p) => ({
    subject: `Invoice ${s(p.documentNumber, '')} revised`,
    bodyText: `Invoice ${s(p.documentNumber, '')} on ${s(p.projectNumber, 'a project')} was revised (revision ${s(p.revisionNumber, '')}).`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'payment.recorded': (p) => ({
    subject: `Payment recorded on ${s(p.projectNumber, 'a project')}`,
    bodyText: `A payment of ${s(p.amountFormatted, '')} was recorded on ${s(p.projectNumber, 'a project')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
  'payment.corrected': (p) => ({
    subject: `Payment corrected on ${s(p.projectNumber, 'a project')}`,
    bodyText: `A recorded payment on ${s(p.projectNumber, 'a project')} was corrected from ${s(p.previousAmountFormatted, '')} to ${s(p.newAmountFormatted, '')}.`,
    ctaLabel: 'Open project',
    ctaPath: projectPath(p, 'org'),
  }),
};

// Thin facade for callers that only need the subject string (audit logs,
// admin dashboards, etc.). The full content builders stay the canonical
// authority via NOTIFICATION_CONTENT above.
export const EMAIL_SUBJECTS: Record<
  NotificationEventType,
  (payload: NotificationPayload) => string
> = Object.fromEntries(
  (Object.entries(NOTIFICATION_CONTENT) as [
    NotificationEventType,
    NotificationContentBuilder,
  ][]).map(([key, builder]) => [key, (p) => builder(p).subject]),
) as Record<NotificationEventType, (payload: NotificationPayload) => string>;

// Recipient-side CTA path rewrite: when the recipient is a stakeholder
// (recipient_type='client'), org-side routes don't apply. Rewrite
// /dashboard/... → /portal/... so the email's CTA lands in the portal.
// Paths that don't start with /dashboard/ are returned unchanged
// (auth-shared routes like /invitations/<token> live outside both groups).
export function rewriteCtaForRecipient(
  ctaPath: string,
  recipientType: 'user' | 'client',
): string {
  if (recipientType === 'client' && ctaPath.startsWith('/dashboard/')) {
    return ctaPath.replace(/^\/dashboard\//, '/portal/');
  }
  return ctaPath;
}
