import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { getMyOrg } from '@/db/queries/orgs';
import { authEmailHasClient } from '@/db/queries/clients';
import { signOut } from '@/actions/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default async function DashboardPage() {
  const authUser = await requireAuthOrRedirect();
  const myOrg = await getMyOrg(authUser.id);
  if (!myOrg) {
    // DEBT-037: a stakeholder who manually URL-types /dashboard (or follows a
    // stale link) gets routed to /portal/projects instead of being pushed
    // into the org-creation wizard.
    if (await authEmailHasClient(authUser.email ?? '')) redirect('/portal/projects');
    redirect('/onboarding');
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Welcome, {myOrg.userName}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/dashboard/projects" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>
                Your firm&apos;s active projects. Create, edit, and track stages.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Open projects →
            </CardContent>
          </Card>
        </Link>
        <Link href="/settings" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>
                Company details, bank info, and document defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Open settings →
            </CardContent>
          </Card>
        </Link>
        <Link href="/settings/team" className="block">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Invite teammates and manage roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Manage team →
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
        <span>
          Signed in as {authUser.email} · {myOrg.role}
        </span>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
