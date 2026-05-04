import type { ReactNode } from 'react';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';

// All routes in (org) — dashboard, projects, settings, team — require an authenticated
// session. Middleware also redirects unauthed users on these paths to /login,
// but this layout adds a server-side check so RSCs below can rely on having a user
// without re-checking. Phase 1a Session 1: the user is just an auth.users row.
// Session 2 onwards: requireOrgUser() will resolve the active organization context.
export default async function OrgLayout({ children }: { children: ReactNode }) {
  await requireAuthOrRedirect();
  return <>{children}</>;
}
