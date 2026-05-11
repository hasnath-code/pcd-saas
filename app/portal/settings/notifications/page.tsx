import Link from 'next/link';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import { redirect } from 'next/navigation';
import { getMyNotificationPreferences } from '@/actions/notifications';
import { NotificationPreferencesMatrix } from '@/components/notifications/NotificationPreferencesMatrix';

export default async function PortalNotificationPreferencesPage() {
  try {
    await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) redirect('/login');
    throw e;
  }

  const result = await getMyNotificationPreferences('client');
  const prefs = 'data' in result ? result.data.prefs : [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/portal/projects" className="text-muted-foreground hover:underline">
            ← Back to projects
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Notifications</h1>
        <p className="text-muted-foreground">
          Choose how you want to be notified about activity on the projects
          you&apos;re part of.
        </p>
        {'error' in result && (
          <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Couldn&apos;t load preferences right now ({result.reason ?? result.error}).
            Toggling a row will create the missing rows on demand.
          </p>
        )}
      </div>

      <NotificationPreferencesMatrix identityType="client" initialPrefs={prefs} />
    </main>
  );
}
