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
import { chromium } from '@playwright/test';
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
      const loginPage = await context.newPage();
      await loginPage.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
      await loginPage
        .getByRole('textbox', { name: /email/i })
        .fill(authEmail);
      await loginPage
        .getByRole('textbox', { name: /password/i })
        .fill(password);
      await Promise.all([
        loginPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
          timeout: 15_000,
        }),
        loginPage.getByRole('button', { name: /^sign in$/i }).click(),
      ]);
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

main().catch((err) => {
  console.error('[screenshot] failed:', err);
  process.exit(1);
});
