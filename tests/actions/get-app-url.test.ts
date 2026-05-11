// Note: placed under tests/actions/ (not tests/utils/) so the existing
// `npm run test:actions` CI step picks it up without script changes.
// The helper itself lives in lib/, not actions/ — naming is by CI convenience.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getAppUrl } from '@/lib/get-app-url';

describe('getAppUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('VERCEL_BRANCH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('local dev: NEXT_PUBLIC_APP_URL only → returns it', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  test('preview: VERCEL_URL set → returns https://VERCEL_URL even if NEXT_PUBLIC_APP_URL leaks localhost', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'pcd-saas-git-foo-bar.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    expect(getAppUrl()).toBe('https://pcd-saas-git-foo-bar.vercel.app');
  });

  test('production default: VERCEL_URL set, NEXT_PUBLIC_APP_URL unset → returns https://VERCEL_URL', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_URL', 'pcd-saas.vercel.app');
    expect(getAppUrl()).toBe('https://pcd-saas.vercel.app');
  });

  test('production override: NEXT_PUBLIC_APP_URL custom domain wins over VERCEL_URL', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_URL', 'pcd-saas.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.pcdportal.com');
    expect(getAppUrl()).toBe('https://app.pcdportal.com');
  });

  test('defensive default: nothing set → returns http://localhost:3000', () => {
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  // DEBT-043: VERCEL_URL is the per-deploy hostname (cookie domain mismatch on
  // magic-link round-trips); VERCEL_BRANCH_URL is the stable branch alias the
  // PKCE cookie is actually set on. Prefer the branch URL on preview/dev so
  // the magic-link callback lands on the same hostname as the form submit.
  test('preview: VERCEL_BRANCH_URL + VERCEL_URL both set → branch URL wins', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_BRANCH_URL', 'pcd-saas-git-foo-bar.vercel.app');
    vi.stubEnv('VERCEL_URL', 'pcd-saas-abc123-bar.vercel.app');
    expect(getAppUrl()).toBe('https://pcd-saas-git-foo-bar.vercel.app');
  });
});
