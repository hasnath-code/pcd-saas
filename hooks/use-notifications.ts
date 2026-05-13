'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { NotificationEventType } from '@/lib/notifications/events';

// Phase 1c §17 + §19. In-app inbox subscription for the current recipient.
// Mirrors the use-conversation-messages.ts shape and uses the same
// supabase_realtime publication (added to `public.notifications` in 0021).
//
// Belt-and-braces delivery model per Phase 8 plan (DEBT-029 budget cap):
//   - Primary: Supabase Realtime postgres_changes INSERT events. RLS on
//     notifications applies at subscription so a malformed filter can't
//     leak other recipients' rows.
//   - Fallback: 30-second polling refresh whenever the tab is visible
//     (document.visibilityState === 'visible'). Polling is cheap (a
//     single SELECT on a partial index) and silently fills any gap
//     left by a Realtime miss without paging the user.
//
// Updates are merged with id-keyed dedupe so a row arriving via both
// channels lands exactly once. Read-state changes are NOT auto-pulled —
// the markNotificationRead server action revalidates the page path,
// which forces the parent server component to re-render with fresh
// initial data on next navigation. Within a single mount, the local
// `markReadLocally` action is the source of truth for UI state.

export type InboxRow = {
  id: string;
  recipientType: 'user' | 'client';
  recipientId: string;
  channel: 'email' | 'in_app' | 'push' | 'sms';
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type RawNotificationRow = {
  id: string;
  recipient_type: 'user' | 'client';
  recipient_id: string;
  channel: 'email' | 'in_app' | 'push' | 'sms';
  event_type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

function projectRow(row: RawNotificationRow): InboxRow {
  return {
    id: row.id,
    recipientType: row.recipient_type,
    recipientId: row.recipient_id,
    channel: row.channel,
    eventType: row.event_type as NotificationEventType,
    payload: row.payload,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

const POLL_INTERVAL_MS = 30_000;

export function useNotifications(opts: {
  recipientType: 'user' | 'client';
  recipientId: string;
  /** Initial rows from server-render. Used as state seed. */
  initialRows: InboxRow[];
}): {
  rows: InboxRow[];
  loading: boolean;
  error: Error | null;
  markReadLocally: (id: string) => void;
  markAllReadLocally: () => void;
} {
  const { recipientType, recipientId, initialRows } = opts;
  const [rows, setRows] = useState<InboxRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  // Stable upsert by id. New rows land at the top (DESC by created_at);
  // updates replace in place.
  const upsertRow = useCallback((next: InboxRow) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === next.id);
      const merged = idx >= 0
        ? [...prev.slice(0, idx), next, ...prev.slice(idx + 1)]
        : [next, ...prev];
      merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return merged;
    });
  }, []);

  // Local read-state mutators — the parent calls these from the
  // mark-read action handler so the UI feels instant without waiting
  // for revalidatePath to round-trip.
  const markReadLocally = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id && r.readAt === null
          ? { ...r, readAt: new Date().toISOString() }
          : r,
      ),
    );
  }, []);

  const markAllReadLocally = useCallback(() => {
    const now = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => (r.readAt === null ? { ...r, readAt: now } : r)),
    );
  }, []);

  useEffect(() => {
    if (!recipientId) return;
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    const supabase = supabaseRef.current;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Polling fallback: re-fetch the latest 50 in_app rows for this
    // recipient. Cheap — uses the partial unread index for the typical
    // case and the (recipient_type, recipient_id) index path for the
    // full read. Runs only while the tab is visible.
    async function refresh() {
      const { data, error: selectError } = await supabase
        .from('notifications')
        .select(
          'id, recipient_type, recipient_id, channel, event_type, payload, read_at, created_at',
        )
        .eq('recipient_type', recipientType)
        .eq('recipient_id', recipientId)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: false })
        .limit(50);

      if (cancelled) return;
      if (selectError) {
        setError(new Error(selectError.message));
        return;
      }
      const fresh = (data ?? []).map((r) =>
        projectRow(r as RawNotificationRow),
      );
      setRows((prev) => {
        // Preserve any locally-applied read_at on rows the server hasn't
        // observed yet (race between local mark-read and the next refresh).
        const localById = new Map(prev.map((r) => [r.id, r] as const));
        return fresh.map((r) => {
          const local = localById.get(r.id);
          if (local && local.readAt && !r.readAt) return local;
          return r;
        });
      });
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refresh();
        startPolling();
      } else {
        stopPolling();
      }
    }

    // Realtime subscription. RLS gates row visibility; the filter is
    // belt-and-braces (saves bandwidth on rows the recipient couldn't
    // see anyway). Uses one channel per recipient — many recipients on
    // the same client (impossible in practice; we mount one hook per
    // page) would each get their own channel.
    const channel = supabase
      .channel(`notifications:${recipientType}:${recipientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${recipientId}`,
        },
        (payload) => {
          const row = payload.new as RawNotificationRow;
          if (row.recipient_type !== recipientType) return;
          if (row.channel !== 'in_app') return;
          upsertRow(projectRow(row));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${recipientId}`,
        },
        (payload) => {
          const row = payload.new as RawNotificationRow;
          if (row.recipient_type !== recipientType) return;
          if (row.channel !== 'in_app') return;
          upsertRow(projectRow(row));
        },
      )
      .subscribe();

    startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      void supabase.removeChannel(channel);
    };
  }, [recipientType, recipientId, upsertRow]);

  return { rows, loading, error, markReadLocally, markAllReadLocally };
}
