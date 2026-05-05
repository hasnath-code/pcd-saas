import type { ReactNode } from 'react';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';

// Centered card shell for /onboarding pages. Auth-gated — middleware also
// protects the route, but requireAuthOrRedirect() here gives a clean redirect
// if the cookie was wiped between middleware and render.
export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAuthOrRedirect();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl">{children}</div>
    </main>
  );
}
