import { redirect } from 'next/navigation';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import { listConversationsForStakeholder } from '@/db/queries/conversations';
import { db } from '@/db';
import { clients } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { ConversationsInbox } from '@/components/conversations/ConversationsInbox';

export default async function PortalConversationsPage() {
  let ctx;
  try {
    ctx = await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) redirect('/login?next=/portal/conversations');
    throw e;
  }

  const [conversations, callerRows] = await Promise.all([
    listConversationsForStakeholder({ clientId: ctx.clientId }),
    db.select({ name: clients.name }).from(clients).where(eq(clients.id, ctx.clientId)).limit(1),
  ]);

  const callerName = callerRows[0]?.name ?? 'You';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="font-heading text-2xl">Conversations</h1>
        <p className="text-sm text-muted-foreground">
          Direct, group, and general threads with your project teams.
        </p>
      </div>

      <ConversationsInbox
        basePath="/portal/conversations"
        conversations={conversations}
        callerName={callerName}
        emptyMessage="No conversations yet. They appear automatically when you accept a project invitation."
      />
    </main>
  );
}
