import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { listMyMemberships } from '@/db/queries/orgs';
import { OrgSwitcher } from '@/components/org/OrgSwitcher';

// All routes in (org) — dashboard, projects, settings, team — require an
// authenticated session. Middleware also redirects unauthed users; this layout
// adds a server-side check so RSCs below can rely on having a user without
// re-checking.
//
// Session 5: renders a top-bar OrgSwitcher when the user has any memberships.
// For users mid-onboarding (no memberships yet), the bar is hidden and pages
// handle the empty state (e.g. dashboard redirects to /onboarding).
export default async function OrgLayout({ children }: { children: ReactNode }) {
  const authUser = await requireAuthOrRedirect();
  const memberships = await listMyMemberships(authUser.id);

  // Resolve the active org via the same precedence as requireOrgUser:
  // single → that one; multiple + cookie match → that one; else → first.
  let active = memberships[0] ?? null;
  if (memberships.length > 1) {
    const cookieStore = await cookies();
    const activeOrgId = cookieStore.get('active_org_id')?.value;
    if (activeOrgId) {
      const match = memberships.find((m) => m.orgId === activeOrgId);
      if (match) active = match;
    }
  }

  const others = active
    ? memberships.filter((m) => m.orgId !== active.orgId)
    : [];

  return (
    <>
      {active && (
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-8 py-3">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="font-semibold">
                PCD
              </Link>
              <nav className="flex items-center gap-2 text-sm">
                <Link
                  href="/dashboard/projects"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Projects
                </Link>
                <Link
                  href="/settings/team"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Team
                </Link>
                <Link
                  href="/settings"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Settings
                </Link>
              </nav>
            </div>
            <OrgSwitcher
              current={{
                orgId: active.orgId,
                orgName: active.orgName,
                role: active.role,
              }}
              others={others.map((o) => ({
                orgId: o.orgId,
                orgName: o.orgName,
                role: o.role,
              }))}
            />
          </div>
        </header>
      )}
      {children}
    </>
  );
}
