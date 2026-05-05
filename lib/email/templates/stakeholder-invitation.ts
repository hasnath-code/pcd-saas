// Stakeholder invitation email body. Mirrors team-invitation.ts shape.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stakeholderInvitationEmail(input: {
  inviterName: string;
  orgName: string;
  projectNumber: string;
  role: 'primary_client' | 'collaborator' | 'observer' | 'billing_contact';
  acceptUrl: string;
}): { subject: string; html: string } {
  const inviter = escapeHtml(input.inviterName);
  const org = escapeHtml(input.orgName);
  const projectNumber = escapeHtml(input.projectNumber);
  const url = escapeHtml(input.acceptUrl);
  // Friendlier role label for end users (homeowners shouldn't see snake_case).
  const roleLabel = (
    {
      primary_client: 'the primary client',
      collaborator: 'a collaborator',
      observer: 'an observer',
      billing_contact: 'the billing contact',
    } as const
  )[input.role];

  const subject = `You've been invited to project ${input.projectNumber} on PCD`;
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>Hi,</p>
    <p>${inviter} from <strong>${org}</strong> has invited you to follow project <strong>${projectNumber}</strong> as ${roleLabel}. You'll be able to see project progress, schedules, drawings, and message the team — based on the access level chosen for you.</p>
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
