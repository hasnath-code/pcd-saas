'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Phase 1c §12.3 + §19. Subscribes to INSERT / UPDATE / DELETE events on the
// `messages` table filtered by conversation_id. RLS on messages applies at
// subscription layer per Supabase Realtime — non-participants never receive
// the events for conversations they can't see.
//
// Body-blanking for soft-deleted rows happens here in TS (Q6 — preferred
// over a SQL CASE WHEN for separation): the raw `body` is preserved on the
// row but the public-facing `displayBody` collapses to '[deleted]' when
// deletedAt is set. Components should render `displayBody`, not `body`.
//
// sendMessage is intentionally NOT wired into this hook — it lives in
// actions/messages.ts and is invoked via useTransition in the consumer
// component. The hook only listens; the consumer drives writes.

export type ConversationMessage = {
  id: string;
  conversationId: string;
  senderType: 'user' | 'client' | 'system';
  senderId: string | null;
  body: string;
  displayBody: string;
  createdAt: string;
  deletedAt: string | null;
  editedAt: string | null;
};

type RawMessageRow = {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'client' | 'system';
  sender_id: string | null;
  body: string;
  attachments: unknown;
  created_at: string;
  deleted_at: string | null;
  edited_at: string | null;
};

const DELETED_PLACEHOLDER = '[deleted]';

function projectRow(row: RawMessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    body: row.body,
    displayBody: row.deleted_at !== null ? DELETED_PLACEHOLDER : row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    editedAt: row.edited_at,
  };
}

export function useConversationMessages(conversationId: string): {
  messages: ConversationMessage[];
  loading: boolean;
  error: Error | null;
} {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  // Stable upsert: replace existing row by id, else append, then sort by
  // created_at ascending. Used for both INSERT and UPDATE events.
  const upsertMessage = useCallback((next: ConversationMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === next.id);
      const merged = idx >= 0 ? [...prev.slice(0, idx), next, ...prev.slice(idx + 1)] : [...prev, next];
      merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return merged;
    });
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    const supabase = supabaseRef.current;

    let cancelled = false;

    async function loadInitial() {
      setLoading(true);
      setError(null);
      const { data, error: selectError } = await supabase
        .from('messages')
        .select(
          'id, conversation_id, sender_type, sender_id, body, attachments, created_at, deleted_at, edited_at',
        )
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      if (selectError) {
        setError(new Error(selectError.message));
        setLoading(false);
        return;
      }
      setMessages((data ?? []).map((row) => projectRow(row as RawMessageRow)));
      setLoading(false);
    }

    void loadInitial();

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          upsertMessage(projectRow(payload.new as RawMessageRow));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          upsertMessage(projectRow(payload.new as RawMessageRow));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // payload.old has only the PK on REPLICA IDENTITY DEFAULT.
          const oldRow = payload.old as { id?: string };
          if (oldRow?.id) removeMessage(oldRow.id);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, upsertMessage, removeMessage]);

  return { messages, loading, error };
}
