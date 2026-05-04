import * as Sentry from '@sentry/nextjs';

// Browser-side Sentry. Reads NEXT_PUBLIC_SENTRY_DSN. Phase 1a Session 1 ships
// without that public DSN — server-only SENTRY_DSN means this init no-ops in
// the browser bundle. Tracking on the open question for Session 12 handover.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Tracing OFF in Phase 1 (cost). Re-enable in Phase 6 with sampled tracing on hot paths.
  tracesSampleRate: 0,
  debug: false,
});

// Required by @sentry/nextjs to track App Router soft navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
