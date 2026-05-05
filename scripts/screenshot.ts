// One-off Playwright screenshot script. Saves a full-page PNG of any route at
// a chosen viewport. Optional `--auth=<email>` signs the user in via the real
// /login form (email + password) before navigating to the target route.
//
// USAGE:
//   npm run screenshot -- <route> <filename> [--viewport=mobile|tablet|desktop] [--auth=<email>] [--password=<pw>]
//
// EXAMPLES:
//   npm run screenshot -- /login login-desktop
//   npm run screenshot -- /onboarding onboarding-mobile --viewport=mobile
//   npm run screenshot -- /dashboard dash-owner --auth=owner@example.com
//
// PRECONDITIONS:
//   - `npm run dev` running on port 3000 (or set SCREENSHOT_BASE_URL)
//   - For --auth: the user must exist in auth.users with the given password
//     (default: SCREENSHOT_DEFAULT_PASSWORD env var, else 'testpass1234')
//
// OUTPUT: screenshots/<filename>.png (gitignored).
import { chromium, type Page } from '@playwright/test';
import * as path from 'node:path';

const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        flags[arg.slice(2)] = 'true';
      } else {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const route = positional[0];
  const filename = positional[1];
  const viewportName = (flags.viewport ?? 'desktop') as ViewportName;
  const authEmail = flags.auth;

  if (!route || !filename) {
    console.error(
      'Usage: npm run screenshot -- <route> <filename> [--viewport=mobile|tablet|desktop] [--auth=<email>]',
    );
    process.exit(1);
  }
  if (!(viewportName in VIEWPORTS)) {
    console.error(
      `screenshot: unknown viewport '${viewportName}'. Use mobile / tablet / desktop.`,
    );
    process.exit(1);
  }

  const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
  const viewport = VIEWPORTS[viewportName];
  const outPath = path.join('screenshots', `${filename}.png`);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });

    if (authEmail) {
      const password =
        flags.password ?? process.env.SCREENSHOT_DEFAULT_PASSWORD ?? 'testpass1234';
      // Warm up the dev server's /login compilation in a throwaway page so
      // the real sign-in below doesn't race React hydration. Without this
      // warmup, the click can fire before onSubmit is wired and the form
      // submits as a default GET to /login?email=...&password=...
      const warmup = await context.newPage();
      await warmup.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
      await warmup.close();

      const loginPage = await context.newPage();
      await signInViaForm(loginPage, baseUrl, authEmail, password);
      await loginPage.close();
    }

    const page = await context.newPage();
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outPath, fullPage: true });

    console.log(
      `✓ saved ${outPath} (${viewportName}: ${viewport.width}×${viewport.height})`,
    );
  } finally {
    await browser.close();
  }
}

// Helper: sign in via the real /login form, with hydration-race retry.
// First click may fall through to default GET (form posts to /login?email=...).
// If that happens, we re-navigate and retry once with a longer settling wait.
async function signInViaForm(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
) {
  const fillAndClick = async (settleMs: number) => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    await page.getByRole('textbox', { name: /password/i }).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
  };

  for (const settle of [400, 1500, 2500]) {
    await fillAndClick(settle);
    try {
      await page.waitForURL(
        (url) => !url.pathname.startsWith('/login'),
        { timeout: 4_000 },
      );
      return;
    } catch {
      // hydration race — retry with a longer settle.
      if (process.env.SCREENSHOT_DEBUG) {
        console.log(
          `[debug] sign-in retry, settled URL=${page.url()} (settle=${settle}ms)`,
        );
      }
    }
  }
  throw new Error(
    `screenshot --auth: login form did not navigate after retries (last URL: ${page.url()})`,
  );
}

main().catch((err) => {
  console.error('[screenshot] failed:', err);
  process.exit(1);
});
