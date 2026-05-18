import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import {
  getConversationDetail,
  listMessagesForConversation,
  listOrgPickableParticipants,
} from '@/db/queries/conversations';
import { ConversationDetailClient } from '@/components/conversations/ConversationDetailClient';
import { ParticipantsManager } from '@/components/conversations/ParticipantsManager';
import { Card, CardContent } from '@/components/ui/card';

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { conversationId } = await params;
  // DEBT-060/061: the query enforces the org-visibility gate (the pooler
  // bypasses RLS). A conversation outside ctx.orgId resolves to null → 404.
  const detail = await getConversationDetail(conversationId, {
    kind: 'org',
    orgId: ctx.orgId,
  });
  if (!detail) notFound();

  const [initialMessages, pickable] = await Promise.all([
    listMessagesForConversation(conversationId, { kind: 'org', orgId: ctx.orgId }),
    listOrgPickableParticipants(detail.orgId),
  ]);

  const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
  const titleFallback =
    detail.type === 'general'
      ? 'General thread'
      : detail.type === 'one_to_one'
        ? 'Direct'
        : 'Group';

  return (
    <main className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-3">
        <Link
          href="/conversations"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← All conversations
        </Link>
      </div>
      <Card className="mb-4">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-heading text-xl">
              {detail.name ?? titleFallback}
            </h1>
            {detail.projectNumber ? (
              <Link
                href={`/dashboard/projects/${detail.projectId}`}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {detail.projectNumber} — {detail.projectSiteAddress}
              </Link>
            ) : null}
          </div>
          <ParticipantsManager
            conversationId={detail.id}
            participants={detail.participants}
            pickableUsers={pickable.users.map((u) => ({
              participantType: 'user' as const,
              participantId: u.id,
              displayName: u.name ?? 'Unnamed',
              subline: u.role,
            }))}
            pickableClients={pickable.clients.map((c) => ({
              participantType: 'client' as const,
              participantId: c.id,
              displayName: c.name ?? 'Unnamed',
              subline: c.email,
            }))}
            canManage={isAdmin}
          />
        </CardContent>
      </Card>

      <ConversationDetailClient
        conversationId={detail.id}
        caller={{ kind: 'user', userId: ctx.userId }}
        initialMessages={initialMessages.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          senderType: m.senderType,
          senderId: m.senderId,
          body: m.body,
          displayBody: m.displayBody,
          createdAt: m.createdAt.toISOString(),
          deletedAt: m.deletedAt?.toISOString() ?? null,
          editedAt: m.editedAt?.toISOString() ?? null,
        }))}
        participantNames={detail.participants}
      />
    </main>
  );
}
