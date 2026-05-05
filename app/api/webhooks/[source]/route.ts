import { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { v7 as uuidv7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { webhookEvents } from '@/db/schema';
import { rateLimit } from '@/lib/ratelimit';
import { verifyWebhookSignature } from '@/lib/webhooks/verify';
import { extractEventId, extractEventType } from '@/lib/webhooks/extract';
import { processWebhook, isKnownSource, type WebhookSource } from '@/lib/webhooks';

// Generic webhook ingestion endpoint per ARCHITECTURE-saas.md §15.
// Flow: rate-limit → read raw body → verify signature → idempotent insert
// (UNIQUE on source, external_event_id) → reject unverified AFTER recording
// (forensic trail) → dispatch to source-specific processor → mark
// processed/error.
//
// Source-specific behavior lives in lib/webhooks/{verify,extract,resend,...}.ts.
// Adding a new source: see lib/webhooks/index.ts.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params;
  if (!isKnownSource(source)) {
    return new Response('Unknown source', { status: 404 });
  }

  // Rate limit per source+IP. Same limiter (`webhook`) for all sources.
  const ip = (req.headers.get('x-forwarded-for') ?? '0.0.0.0').split(',')[0]?.trim() ?? '0.0.0.0';
  const { limited, retryAfterSec } = await rateLimit('webhook', `${source}:${ip}`);
  if (limited) {
    return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: retryAfterSec }), {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSec), 'Content-Type': 'application/json' },
    });
  }

  // Read raw body once for signature verification AND parse.
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  // Verify first, but don't reject yet — we want a forensic row regardless.
  const verified = await verifyWebhookSignature(source as WebhookSource, rawBody, headers);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const externalEventId = extractEventId(source as WebhookSource, payload);
  const eventType = extractEventType(source as WebhookSource, payload);
  if (!externalEventId || !eventType) {
    return new Response('Unparseable event', { status: 400 });
  }

  // Idempotent insert. UNIQUE constraint (source, external_event_id) from
  // migration 0001 makes this a single-statement upsert; ON CONFLICT DO
  // NOTHING returns no rows when the event was already recorded.
  const id = uuidv7();
  const inserted = await db
    .insert(webhookEvents)
    .values({
      id,
      source,
      eventType,
      externalEventId,
      payload: payload as Record<string, unknown>,
      signatureVerified: verified,
    })
    .onConflictDoNothing({
      target: [webhookEvents.source, webhookEvents.externalEventId],
    })
    .returning({ id: webhookEvents.id });

  if (inserted.length === 0) {
    // At-least-once delivery is normal for Resend; duplicates aren't an error.
    return new Response('OK (duplicate)', { status: 200 });
  }
  const insertedId = inserted[0].id;

  // Reject AFTER recording so the row exists for forensic review.
  if (!verified) {
    await db
      .update(webhookEvents)
      .set({ processingError: 'Signature verification failed', processedAt: new Date() })
      .where(eq(webhookEvents.id, insertedId));
    return new Response('Invalid signature', { status: 401 });
  }

  Sentry.setTag('webhook.source', source);
  Sentry.setTag('webhook.external_event_id', externalEventId);
  try {
    const orgId = await processWebhook(source as WebhookSource, insertedId, payload);
    if (orgId) Sentry.setTag('org_id', orgId);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, insertedId));
    return new Response('OK', { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(webhookEvents)
      .set({ processingError: message, processedAt: new Date() })
      .where(eq(webhookEvents.id, insertedId));
    Sentry.captureException(error);
    // 500 → triggers source-side retry (Svix/Resend will redeliver).
    return new Response('Processing error', { status: 500 });
  }
}
