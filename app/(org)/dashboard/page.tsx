import { requireAuth } from '@/lib/auth/requireAuth';
import { signOut } from '@/actions/auth';
import { Button } from '@/components/ui/button';

// Phase 1a Session 1 placeholder. Session 3 replaces this with the real org dashboard
// (org name, team list, settings link). For now the goal is just to confirm the
// auth + middleware path works end-to-end.
export default async function DashboardPage() {
  const user = await requireAuth();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Authenticated</h1>
      <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
      <p className="text-xs text-muted-foreground">auth.users.id: {user.id}</p>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
