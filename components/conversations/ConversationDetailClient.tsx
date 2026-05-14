'use client';

import { useEffect, useMemo, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  useConversationMessages,
  type ConversationMessage,
} from '@/hooks/use-conversation-messages';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { markConversationRead } from '@/actions/conversations';

export type CallerIdentity =
  | { kind: 'user'; userId: string }
  | { kind: 'client'; clientId: string };

export type ParticipantNameEntry = {
  participantType: 'user' | 'client';
  participantId: string;
  displayName: string;
};

export function ConversationDetailClient({
  conversationId,
  caller,
  initialMessages,
  participantNames,
  composerDisabled,
  composerPlaceholder,
}: {
  conversationId: string;
  caller: CallerIdentity;
  initialMessages?: ConversationMessage[];
  participantNames: ParticipantNameEntry[];
  composerDisabled?: boolean;
  composerPlaceholder?: string;
}) {
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of participantNames) {
      m.set(`${p.participantType}:${p.participantId}`, p.displayName);
    }
    return m;
  }, [participantNames]);

  function resolveSenderName(
    type: 'user' | 'client' | 'system',
    id: string | null,
  ): string | null {
    if (type === 'system' || id === null) return null;
    return nameMap.get(`${type}:${id}`) ?? (type === 'user' ? 'Team member' : 'Stakeholder');
  }

  const router = useRouter();
  const { messages: liveMessages, loading, error } =
    useConversationMessages(conversationId);
  const [, startMarkRead] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastReadFireKey = useRef<string | null>(null);

  // Merge initial SSR-fetched messages with live updates. The hook will
  // overwrite by id once its initial fetch completes, so the SSR list
  // primarily prevents the empty-flash before the hook hydrates.
  const messages = useMemo(() => {
    if (loading && initialMessages) return initialMessages;
    return liveMessages;
  }, [loading, initialMessages, liveMessages]);

  // Auto-scroll to the bottom when new messages arrive (or on first paint).
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  // Mark-read on mount and whenever the message tail changes (i.e., new
  // messages observed). One fire per (conversationId, latest-message-id) so
  // we don't hammer the action with every re-render.
  useEffect(() => {
    if (loading) return;
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    const fireKey = `${conversationId}:${latest.id}`;
    if (lastReadFireKey.current === fireKey) return;
    lastReadFireKey.current = fireKey;
    startMarkRead(async () => {
      await markConversationRead({ conversationId });
      // Refresh the inbox unread badge in the parent layout (cheap).
      router.refresh();
    });
  }, [conversationId, loading, messages, router]);

  function isOwnMessage(m: ConversationMessage): boolean {
    if (caller.kind === 'user') {
      return m.senderType === 'user' && m.senderId === caller.userId;
    }
    return m.senderType === 'client' && m.senderId === caller.clientId;
  }

  // Compact layout for empty threads: no messages to fill space, so keep the
  // empty-state copy and composer visually together instead of letting flex-1
  // push the composer to the viewport bottom.
  if (!loading && !error && messages.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          No messages yet. Send the first one below.
        </p>
        <MessageComposer
          conversationId={conversationId}
          disabled={composerDisabled}
          placeholder={composerPlaceholder}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col rounded-lg border bg-card">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
        data-slot="message-scroll"
      >
        {error ? (
          <div className="text-sm text-destructive">
            Couldn&apos;t load messages: {error.message}
          </div>
        ) : null}
        {loading && messages.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={{
              id: m.id,
              senderType: m.senderType,
              senderId: m.senderId,
              senderName: resolveSenderName(m.senderType, m.senderId),
              body: m.body,
              displayBody: m.displayBody,
              createdAt: m.createdAt,
              editedAt: m.editedAt,
              deletedAt: m.deletedAt,
            }}
            isOwnMessage={isOwnMessage(m)}
          />
        ))}
      </div>
      <MessageComposer
        conversationId={conversationId}
        disabled={composerDisabled}
        placeholder={composerPlaceholder}
      />
    </div>
  );
}
