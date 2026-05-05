import { processResendEvent } from './resend';
import type { WebhookSource } from './verify';

// Single source of truth for which webhook sources we accept. Adding a new
// source means: (1) include it here, (2) add a verify branch in verify.ts,
// (3) add an extract branch in extract.ts, (4) add a process branch below.
const KNOWN_SOURCES: ReadonlySet<WebhookSource> = new Set(['resend']);

export function isKnownSource(s: string): s is WebhookSource {
  return KNOWN_SOURCES.has(s as WebhookSource);
}

// Returns the resolved org_id (or null) so the route handler can attach it to
// Sentry tags. Throws on processing errors — the route handler catches and
// records the error message in webhook_events.processing_error.
export async function processWebhook(
  source: WebhookSource,
  webhookEventId: string,
  payload: unknown,
): Promise<string | null> {
  if (source === 'resend') {
    return processResendEvent(webhookEventId, payload);
  }
  throw new Error(`No processor registered for webhook source: ${source}`);
}

export type { WebhookSource };
