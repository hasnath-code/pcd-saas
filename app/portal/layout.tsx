import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import { totalUnreadForStakeholder } from '@/db/queries/conversations';
import { Badge } from '@/components/ui/badge';

// Stakeholder portal shell. All /portal/* routes require an auth user with a
// matching public.clients row (auth_user_id linked). Org users without a
// stakeholder identity get redirected to /login (with a hint) — they should
// be in /dashboard, not /portal.
//
// No OrgSwitcher: stakeholders aren't scoped to a single org — they see all
// projects across orgs they've accepted into. The header is intentionally
// minimal so the per-project page header carries the project context.
export default async function PortalLayout({ children }: { children: ReactNode }) {
  let stakeholderCtx;
  try {
    stakeholderCtx = await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === 'not_authenticated') {
        redirect('/login?next=/portal/projects');
      }
      // not_authorized / no_stakeholder_identity: signed in as a different
      // identity (e.g. an org user). Send to /dashboard rather than /login.
      redirect('/dashboard');
    }
    throw e;
  }

  const unreadCount = await totalUnreadForStakeholder({
    clientId: stakeholderCtx.clientId,
  });

  return (
    <>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-8 py-3">
          <div className="flex items-center gap-4">
            <Link href="/portal/projects" className="font-semibold">
              PCD
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <Link
                href="/portal/projects"
                className="text-muted-foreground hover:text-foreground"
              >
                My projects
              </Link>
              <Link
                href="/portal/conversations"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                Conversations
                {unreadCount > 0 ? (
                  <Badge className="rounded-full bg-primary px-1.5 text-primary-foreground">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                ) : null}
              </Link>
            </nav>
          </div>
          <span className="text-xs text-muted-foreground">Client portal</span>
        </div>
      </header>
      {children}
    </>
  );
}
