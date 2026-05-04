import * as Sentry from '@sentry/nextjs';

// Edge runtime (middleware, edge route handlers). Loaded via instrumentation.ts.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
});
