import * as Sentry from '@sentry/nextjs';

// Next.js 15 instrumentation hook. Loaded once per runtime — server bootstraps load
// sentry.server.config.ts; edge runtime loads sentry.edge.config.ts. Browser runtime
// is loaded directly from sentry.client.config.ts by the Sentry webpack plugin.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown from React Server Components (Next.js 15 native hook).
export const onRequestError = Sentry.captureRequestError;
