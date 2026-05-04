// Used during Phase 1a Session 1 setup to confirm Sentry is wired end-to-end.
// Hit GET /api/sentry-test on the production deploy → verify event arrives in Sentry.
// Public route (middleware excludes it). Safe to remove once verified, but cheap to keep.
export async function GET() {
  throw new Error('Sentry test error from /api/sentry-test');
}
