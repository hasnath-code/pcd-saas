// Plain HTML team-invitation email body. Phase 1a uses string templates per
// SESSION-1-HANDOVER conventions (no React Email yet).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function teamInvitationEmail(input: {
  inviterName: string;
  orgName: string;
  role: 'admin' | 'member';
  acceptUrl: string;
}): { subject: string; html: string } {
  const inviter = escapeHtml(input.inviterName);
  const org = escapeHtml(input.orgName);
  const role = input.role; // 'admin' | 'member', no escaping needed
  const url = escapeHtml(input.acceptUrl);

  const subject = `You've been invited to ${input.orgName} on PCD`;
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>Hi,</p>
    <p>${inviter} has invited you to join <strong>${org}</strong> on PCD as a <strong>${role}</strong>. PCD is the platform Plan Craft Daily uses to manage projects, quotes, and invoices.</p>
    <p style="margin: 24px 0;">
      <a href="${url}" style="background: #111; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">Accept invitation</a>
    </p>
    <p style="font-size: 14px; color: #555;">Or open this link in your browser:</p>
    <p style="font-size: 14px; color: #555; word-break: break-all;"><a href="${url}">${url}</a></p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
    <p style="font-size: 12px; color: #888;">If you weren't expecting this invitation, you can ignore this email.</p>
  </body>
</html>`;
  return { subject, html };
}
