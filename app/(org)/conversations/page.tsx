import { redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import {
  listConversationsForOrgUser,
  listOrgPickableParticipants,
} from '@/db/queries/conversations';
import { listProjectsForOrg } from '@/db/queries/projects';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { ConversationsInbox } from '@/components/conversations/ConversationsInbox';
import { NewConversationDialog } from '@/components/conversations/NewConversationDialog';

export default async function ConversationsInboxPage() {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const [conversations, callerRows, pickable, projectsList] = await Promise.all([
    listConversationsForOrgUser({ orgId: ctx.orgId, userId: ctx.userId }),
    db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).limit(1),
    listOrgPickableParticipants(ctx.orgId),
    listProjectsForOrg(ctx.orgId),
  ]);

  const callerName = callerRows[0]?.name ?? 'You';
  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl">Conversations</h1>
          <p className="text-sm text-muted-foreground">
            Direct, group, and general threads for your org.
          </p>
        </div>
        {isAdmin ? (
          <NewConversationDialog
            users={pickable.users}
            clients={pickable.clients}
            projects={projectsList.map((p) => ({
              id: p.id,
              projectNumber: p.projectNumber,
              siteAddress: p.siteAddress,
            }))}
          />
        ) : null}
      </div>

      <ConversationsInbox
        basePath="/conversations"
        conversations={conversations}
        callerName={callerName}
        emptyMessage="No conversations yet. New direct and general threads appear automatically when stakeholders accept invitations."
      />
    </main>
  );
}
