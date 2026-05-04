import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// Validates required env vars at startup. Throws on missing/malformed before any build runs.
import './env';

const nextConfig: NextConfig = {
  /* config options here */
};

// Source map upload + RSC error capture. SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT
// must be set as Vercel build-time env vars for source maps to ship; absent locally is fine.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
