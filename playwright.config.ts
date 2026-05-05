import { defineConfig, devices } from '@playwright/test';

// Minimal config — Phase 1a only uses Playwright via scripts/screenshot.ts
// (chromium-only, headless). Future test files (e2e/) can extend this.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
