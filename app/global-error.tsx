'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Catches React rendering errors in the App Router root. Sentry recommends a global-error
// boundary so client-side render crashes are reported.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main className="flex min-h-screen items-center justify-center p-8">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The error was reported. Please try again.
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
