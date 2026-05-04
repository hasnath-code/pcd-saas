import type { ReactNode } from 'react';

// Centered card shell for all (auth) pages — login, signup, magic-link, forgot/reset password.
// Intentionally minimal: visual polish is Phase 1a Session 3 / Phase 5 work.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
