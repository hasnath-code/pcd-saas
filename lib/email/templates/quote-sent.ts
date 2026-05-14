// Phase 2 — quote-sent client email. Plain HTML; React Email migration is
// Phase 5 polish (matches team-invitation.ts pattern). Subject + body are
// rendered via the email helper from actions/documents.ts on the post-commit
// path per ADR-033 / Hard Rule 27.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GBP-only this session. multi-currency lands when documents.currency
// stops always being 'GBP' (Phase 5+). Intl.NumberFormat handles 2dp and
// negative-zero edge cases consistently.
function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function quoteSentEmail(input: {
  quoteNumber: string;
  total: number;
  viewUrl: string;
}): { subject: string; html: string } {
  const quoteNumber = escapeHtml(input.quoteNumber);
  const total = escapeHtml(formatGBP(input.total));
  const viewUrl = escapeHtml(input.viewUrl);

  const subject = `Quote ${input.quoteNumber}`;
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>Hi,</p>
    <p>Your quote <strong>${quoteNumber}</strong> is ready to view.</p>
    <p>Total: <strong>${total}</strong></p>
    <p style="margin: 24px 0;">
      <a href="${viewUrl}" style="background: #111; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; display: inline-block;">View quote</a>
    </p>
    <p style="font-size: 14px; color: #555;">Or open this link in your browser:</p>
    <p style="font-size: 14px; color: #555; word-break: break-all;"><a href="${viewUrl}">${viewUrl}</a></p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
    <p style="font-size: 12px; color: #888;">If you weren't expecting this email, you can ignore it.</p>
  </body>
</html>`;
  return { subject, html };
}
