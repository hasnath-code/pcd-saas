import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { getMyOrg } from '@/db/queries/orgs';
import { listInboxNotifications } from '@/db/queries/notifications';
import { InboxList } from '@/components/notifications/InboxList';

export default async function OrgNotificationsPage() {
  const authUser = await requireAuthOrRedirect();
  const myOrg = await getMyOrg(authUser.id);
  if (!myOrg) redirect('/onboarding');

  // Resolve the active org's users row for this auth user.
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.authUserId, authUser.id),
        eq(users.orgId, myOrg.orgId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (userRows.length === 0) redirect('/onboarding');
  const userId = userRows[0].id;

  const initialRows = await listInboxNotifications({
    recipientType: 'user',
    recipientId: userId,
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/dashboard" className="text-muted-foreground hover:underline">
            ← Back to dashboard
          </Link>
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-3xl font-semibold">Notifications</h1>
          <Link
            href="/settings/notifications"
            className="text-sm text-muted-foreground hover:underline"
          >
            Manage preferences →
          </Link>
        </div>
      </div>

      <InboxList
        recipientType="user"
        recipientId={userId}
        initialRows={initialRows.map((r) => ({
          id: r.id,
          recipientType: 'user',
          recipientId: userId,
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
