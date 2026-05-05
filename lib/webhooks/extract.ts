import type { WebhookSource } from './verify';

// Resend webhook envelope doesn't include a single stable event id at the top
// level (svix-id is a delivery id, not an event id). Synthesize a stable id
// from (type, email_id, created_at) so a duplicate Svix delivery for the same
// underlying Resend event hits the same idempotency key.
export function extractEventId(source: WebhookSource, payload: unknown): string | null {
  if (source === 'resend') {
    const p = payload as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
    const emailId = p?.data?.email_id;
    const type = p?.type;
    const createdAt = p?.created_at;
    if (typeof emailId === 'string' && typeof type === 'string' && typeof createdAt === 'string') {
      return `${type}:${emailId}:${createdAt}`;
    }
    return null;
  }
  return null;
}

export function extractEventType(source: WebhookSource, payload: unknown): string | null {
  if (source === 'resend') {
    const p = payload as { type?: unknown };
    return typeof p?.type === 'string' ? p.type : null;
  }
  return null;
}
