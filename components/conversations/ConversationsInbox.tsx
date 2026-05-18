import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessagesSquare } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { ConversationListItem } from '@/db/queries/conversations';
import { deriveTitle } from './deriveTitle';

const TYPE_LABELS: Record<ConversationListItem['type'], string> = {
  one_to_one: 'Direct',
  group: 'Group',
  general: 'General',
};

const GROUPS = [
  { type: 'general', heading: 'General threads' },
  { type: 'one_to_one', heading: 'Project — direct' },
  { type: 'group', heading: 'Project — group' },
] as const;

function formatRelative(when: Date | string | null): string {
  if (!when) return '';
  const d = new Date(when);
  const ms = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < min) return 'just now';
  if (ms < hr) return `${Math.floor(ms / min)}m`;
  if (ms < day) return `${Math.floor(ms / hr)}h`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d`;
  return d.toLocaleDateString();
}

export function ConversationsInbox({
  basePath,
  conversations,
  callerName,
  emptyMessage = 'No conversations yet.',
}: {
  basePath: '/conversations' | '/portal/conversations';
  conversations: ConversationListItem[];
  callerName: string;
  emptyMessage?: string;
}) {
  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No conversations yet"
        description={emptyMessage}
      />
    );
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const items = conversations.filter((c) => c.type === g.type);
        if (items.length === 0) return null;
        return (
          <Card key={g.type}>
            <CardHeader>
              <CardTitle className="text-base">{g.heading}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {items.map((c) => {
                  const title = deriveTitle(c, callerName);
                  const unread = c.unreadCount > 0;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`${basePath}/${c.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'truncate text-sm',
                                unread ? 'font-semibold' : 'font-medium',
                              )}
                            >
                              {title}
                            </span>
                            <Badge variant="secondary" className="shrink-0">
                              {TYPE_LABELS[c.type]}
                            </Badge>
                            {c.projectNumber ? (
                              <span className="truncate text-xs text-muted-foreground">
                                · {c.projectNumber}
                              </span>
                            ) : null}
                          </div>
                          {c.lastMessagePreview ? (
                            <p
                              className={cn(
                                'mt-0.5 truncate text-xs text-muted-foreground',
                                unread && 'text-foreground',
                              )}
                            >
                              {c.lastMessagePreview}
                            </p>
                          ) : (
                            <p className="mt-0.5 truncate text-xs italic text-muted-foreground">
                              No messages yet
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-xs text-muted-foreground">
                            {formatRelative(c.lastMessageAt)}
                          </span>
                          {unread ? (
                            <Badge className="rounded-full bg-primary text-primary-foreground">
                              {c.unreadCount > 99 ? '99+' : c.unreadCount}
                            </Badge>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
