import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireStakeholder } from '@/lib/auth/requireAuth';
import {
  getConversationDetail,
  listMessagesForConversation,
} from '@/db/queries/conversations';
import { ConversationDetailClient } from '@/components/conversations/ConversationDetailClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function PortalConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireStakeholder();
  } catch (e) {
    if (e instanceof AuthError) redirect('/login?next=/portal/conversations');
    throw e;
  }

  const { conversationId } = await params;
  // DEBT-060/061: the query enforces the participation gate (the pooler
  // bypasses RLS) — a non-participant stakeholder resolves to null → 404.
  const detail = await getConversationDetail(conversationId, {
    kind: 'stakeholder',
    clientId: ctx.clientId,
  });
  if (!detail) notFound();

  const initialMessages = await listMessagesForConversation(conversationId, {
    kind: 'stakeholder',
    clientId: ctx.clientId,
  });

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
          href="/portal/conversations"
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
                href={`/portal/projects/${detail.projectId}`}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {detail.projectNumber}
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {detail.participants.map((p) => (
              <Badge
                key={`${p.participantType}:${p.participantId}`}
                variant="secondary"
                className="font-normal"
              >
                {p.displayName}
                <span className="ml-1 text-muted-foreground">
                  ({p.participantType === 'user' ? 'team' : 'stakeholder'})
                </span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <ConversationDetailClient
        conversationId={detail.id}
        caller={{ kind: 'client', clientId: ctx.clientId }}
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
