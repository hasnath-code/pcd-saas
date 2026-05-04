import * as Sentry from '@sentry/nextjs';

// Server runtime: Node.js. Loaded via instrumentation.ts.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
});
