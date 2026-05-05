import 'server-only';
import { Webhook } from 'svix';
import { env } from '@/env';

// Per ARCHITECTURE-saas.md §15. Stripe/Twilio land in Phase 6 / 4+; we keep
// the union here so the route's switch is exhaustive at compile time.
export type WebhookSource = 'resend' | 'stripe' | 'twilio';

// Returns true iff the request body and headers verify against the source's
// signing secret. Returns false on any verification failure (missing headers,
// bad signature, expired timestamp). Never throws.
export async function verifyWebhookSignature(
  source: WebhookSource,
  rawBody: string,
  headers: Record<string, string>,
): Promise<boolean> {
  if (source === 'resend') {
    try {
      const wh = new Webhook(env.RESEND_WEBHOOK_SECRET);
      // svix.verify throws on failure; returns the parsed payload on success.
      // We discard the parsed result — the route re-parses the raw body for
      // its own use.
      wh.verify(rawBody, {
        'svix-id': headers['svix-id'] ?? '',
        'svix-timestamp': headers['svix-timestamp'] ?? '',
        'svix-signature': headers['svix-signature'] ?? '',
      });
      return true;
    } catch {
      return false;
    }
  }
  // stripe/twilio land in later phases
  return false;
}
