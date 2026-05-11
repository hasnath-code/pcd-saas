'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/actions/notifications';
import { useNotifications, type InboxRow } from '@/hooks/use-notifications';
import type { NotificationEventType } from '@/lib/notifications/events';

// Phase 1c §17 + Phase 8 plan. Inbox list with Realtime + polling fallback.
// Single component used by both /notifications (org side) and
// /portal/notifications (stakeholder side); the calling page resolves
// identityType and passes through.

const EVENT_LABELS: Record<NotificationEventType, string> = {
  'auth.password_changed': 'Password changed',
  'team.invited': 'Team invitation sent',
  'team.invitation_accepted': 'Team invitation accepted',
  'project.created': 'New project',
  'project.stage_changed': 'Project stage moved',
  'project.completed': 'Project completed',
  'stakeholder.invited': 'Stakeholder invited',
  'stakeholder.added_to_project': 'Stakeholder joined',
  'message.new': 'New message',
  'file.uploaded': 'File uploaded',
  'milestone.scheduled': 'Milestone scheduled',
  'milestone.completed': 'Milestone completed',
};

function renderSummary(
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): string {
  const s = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.length > 0 ? v : fallback;
  switch (eventType) {
    case 'message.new':
      return `${s(payload.senderName, 'Someone')} in ${s(payload.conversationName, 'a conversation')}: "${s(payload.snippet, '...')}"`;
    case 'project.stage_changed':
      return `${s(payload.projectNumber, 'A project')} moved from ${s(payload.fromStageName, 'a stage')} to ${s(payload.toStageName, 'a new stage')}`;
    case 'file.uploaded':
      return `${s(payload.uploaderName, 'Someone')} uploaded ${s(payload.filename, 'a file')} to ${s(payload.projectNumber, 'a project')}`;
    case 'stakeholder.added_to_project':
      return `${s(payload.stakeholderName, 'A stakeholder')} (${s(payload.stakeholderEmail, 'unknown email')}) joined ${s(payload.projectNumber, 'a project')}`;
    case 'milestone.scheduled':
      return `Milestone "${s(payload.label, 'a milestone')}" scheduled on ${s(payload.projectNumber, 'a project')}`;
    default:
      return EVENT_LABELS[eventType];
  }
}

function formatRelative(when: Date | string): string {
  const d = new Date(when);
  const ms = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < min) return 'just now';
  if (ms < hr) return `${Math.floor(ms / min)}m ago`;
  if (ms < day) return `${Math.floor(ms / hr)}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return d.toLocaleDateString();
}

function deepLinkPath(
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
  side: 'org' | 'portal',
): string | null {
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : null;
  const conversationId =
    typeof payload.conversationId === 'string' ? payload.conversationId : null;
  if (eventType === 'message.new' && conversationId) {
    return side === 'org'
      ? `/conversations/${conversationId}`
      : `/portal/conversations/${conversationId}`;
  }
  if (projectId) {
    return side === 'org'
      ? `/dashboard/projects/${projectId}`
      : `/portal/projects/${projectId}`;
  }
  return null;
}

export function InboxList({
  recipientType,
  recipientId,
  initialRows,
}: {
  recipientType: 'user' | 'client';
  recipientId: string;
  initialRows: InboxRow[];
}) {
  const { rows, markReadLocally, markAllReadLocally } = useNotifications({
    recipientType,
    recipientId,
    initialRows,
  });
  const [isPending, startTransition] = useTransition();

  const side: 'org' | 'portal' = recipientType === 'client' ? 'portal' : 'org';
  const unreadCount = rows.filter((r) => r.readAt === null).length;

  function handleRowClick(row: InboxRow, event: React.MouseEvent) {
    // Only mark-read if currently unread.
    if (row.readAt === null) {
      markReadLocally(row.id);
      startTransition(async () => {
        const result = await markNotificationRead({ notificationId: row.id });
        if ('error' in result) {
          toast.error(`Couldn't mark as read: ${result.reason ?? result.error}`);
        }
      });
    }
    // Allow the default Link navigation. If the row has no deep-link, the
    // wrapping div absorbs the click (no navigation).
    void event;
  }

  function handleMarkAll() {
    if (unreadCount === 0) return;
    markAllReadLocally();
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if ('error' in result) {
        toast.error(`Couldn't mark all read: ${result.reason ?? result.error}`);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
        No notifications yet. We&apos;ll let you know when something happens.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {unreadCount > 0
            ? `${unreadCount} unread of ${rows.length}`
            : `${rows.length} notification${rows.length === 1 ? '' : 's'}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || isPending}
          onClick={handleMarkAll}
        >
          Mark all read
        </Button>
      </div>
      <ul className="divide-y rounded-md border">
        {rows.map((row) => {
          const path = deepLinkPath(row.eventType, row.payload, side);
          const unread = row.readAt === null;
          const summary = renderSummary(row.eventType, row.payload);
          const inner = (
            <div className="flex items-start gap-3 p-3">
              <div
                aria-hidden
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  unread ? 'bg-primary' : 'bg-transparent'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium">
                    {EVENT_LABELS[row.eventType]}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelative(row.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
                {unread && (
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    New
                  </Badge>
                )}
              </div>
            </div>
          );
          if (path) {
            return (
              <li key={row.id}>
                <a
                  href={path}
                  onClick={(e) => handleRowClick(row, e)}
                  className="block hover:bg-muted/50"
                >
                  {inner}
                </a>
              </li>
            );
          }
          return (
            <li
              key={row.id}
              onClick={(e) => handleRowClick(row, e)}
              className="cursor-pointer hover:bg-muted/50"
            >
              {inner}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
