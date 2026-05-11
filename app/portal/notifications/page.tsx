import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import { listInboxNotifications } from '@/db/queries/notifications';
import { InboxList } from '@/components/notifications/InboxList';

export default async function PortalNotificationsPage() {
  let ctx;
  try {
    ctx = await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) redirect('/login');
    throw e;
  }

  const initialRows = await listInboxNotifications({
    recipientType: 'client',
    recipientId: ctx.clientId,
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link
            href="/portal/projects"
            className="text-muted-foreground hover:underline"
          >
            ← Back to projects
          </Link>
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-3xl font-semibold">Notifications</h1>
          <Link
            href="/portal/settings/notifications"
            className="text-sm text-muted-foreground hover:underline"
          >
            Manage preferences →
          </Link>
        </div>
      </div>

      <InboxList
        recipientType="client"
        recipientId={ctx.clientId}
        initialRows={initialRows.map((r) => ({
          id: r.id,
          recipientType: 'client',
          recipientId: ctx.clientId,
          channel: r.channel,
          eventType: r.eventType,
          payload: r.payload,
          readAt: r.readAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
