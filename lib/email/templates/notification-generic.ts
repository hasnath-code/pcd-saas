// Generic notification email template. Phase 1c Session 11 §17 +
// Hard Rule 9. Subject and body strings originate from
// lib/notifications/subjects.ts (Hard Rule 8); this template handles
// HTML scaffolding only.
//
// Plain HTML string template, matching the team-invitation + stakeholder-
// invitation pattern (no React Email until Phase 5 polish — DEBT for Phase
// 1a deferred).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function notificationGenericEmail(input: {
  /** Subject line — from NOTIFICATION_CONTENT[eventType].subject. */
  subject: string;
  /** Plain-text body — from NOTIFICATION_CONTENT[eventType].bodyText. */
  bodyText: string;
  /** Full CTA URL — caller composes getAppUrl() + recipient-rewritten path. */
  ctaUrl: string;
  /** Visible CTA button label. */
  ctaLabel: string;
  /** Event type for the footer copy ("you're receiving this because..."). */
  eventType: string;
  /** Absolute URL to the preferences page (org or portal side). */
  preferencesUrl: string;
}): { subject: string; html: string } {
  const body = escapeHtml(input.bodyText);
  const url = escapeHtml(input.ctaUrl);
  const label = escapeHtml(input.ctaLabel);
  const event = escapeHtml(input.eventType);
  const prefs = escapeHtml(input.preferencesUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>Hi,</p>
    <p>${body}</p>
    <p style="margin: 24px 0;">
      <a href="${url}" style="background: #111; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">${label}</a>
    </p>
    <p style="font-size: 14px; color: #555;">Or open this link in your browser:</p>
    <p style="font-size: 14px; color: #555; word-break: break-all;"><a href="${url}">${url}</a></p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
    <p style="font-size: 12px; color: #888;">
      You're receiving this because <code>${event}</code> email notifications are enabled.
      Manage preferences at <a href="${prefs}">${prefs}</a>.
    </p>
  </body>
</html>`;
  return { subject: input.subject, html };
}
