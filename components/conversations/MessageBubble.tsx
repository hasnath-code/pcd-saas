'use client';

import { useState, useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteMessage, editMessage } from '@/actions/messages';
import { cn } from '@/lib/utils';

// Allowlist for react-markdown / rehype-sanitize per Decision 9.4A:
// bold (strong/em), code (code/pre), links (a). NO tables, NO images, NO
// raw HTML. The sanitize schema also strips href schemes other than http(s)
// and mailto.
const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: ['p', 'strong', 'em', 'a', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'br'],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ['href', /^https?:|^mailto:/],
      'title',
    ],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
  },
};

export type MessageBubbleViewModel = {
  id: string;
  senderType: 'user' | 'client' | 'system';
  senderId: string | null;
  senderName: string | null;
  body: string;
  displayBody: string;
  createdAt: string | Date;
  editedAt: string | Date | null;
  deletedAt: string | Date | null;
};

function fmtTime(when: string | Date | null): string {
  if (!when) return '';
  const d = typeof when === 'string' ? new Date(when) : when;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({
  message,
  isOwnMessage,
}: {
  message: MessageBubbleViewModel;
  isOwnMessage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [isSaving, startSave] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const isSystem = message.senderType === 'system';
  const isDeleted = message.deletedAt !== null;
  const canMutate = isOwnMessage && !isSystem && !isDeleted;

  if (isSystem) {
    return (
      <div className="my-2 text-center">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.displayBody}
        </span>
      </div>
    );
  }

  function onSaveEdit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === message.body) {
      setEditing(false);
      return;
    }
    startSave(async () => {
      const result = await editMessage({ messageId: message.id, body: trimmed });
      if ('error' in result) {
        toast.error(`Couldn't edit: ${result.reason ?? result.error}`);
        return;
      }
      setEditing(false);
    });
  }

  function onConfirmDelete() {
    startDelete(async () => {
      const result = await deleteMessage({ messageId: message.id });
      if ('error' in result) {
        toast.error(`Couldn't delete: ${result.reason ?? result.error}`);
        setConfirmingDelete(false);
        return;
      }
      setConfirmingDelete(false);
    });
  }

  return (
    <div
      className={cn(
        'group/msg flex flex-col gap-1',
        isOwnMessage ? 'items-end' : 'items-start',
      )}
    >
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span>{message.senderName ?? (isOwnMessage ? 'You' : 'Unknown')}</span>
        <span>{fmtTime(message.createdAt)}</span>
        {message.editedAt && !isDeleted ? <span>(edited)</span> : null}
      </div>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
          isOwnMessage
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
          isDeleted && 'italic text-muted-foreground bg-muted/50',
        )}
      >
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={10000}
              rows={3}
              className="bg-background text-foreground"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(false);
                }}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={onSaveEdit} disabled={isSaving}>
                Save
              </Button>
            </div>
          </div>
        ) : isDeleted ? (
          <span>{message.displayBody}</span>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-0 [&_a]:underline">
            <ReactMarkdown rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}>
              {message.body}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {canMutate && !editing ? (
        <div className="flex gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Edit message"
            onClick={() => {
              setDraft(message.body);
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete message"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this message?"
        description="The message will be replaced with '[deleted]' for everyone in the conversation. This can't be undone."
        confirmText="Delete"
        variant="destructive"
        busy={isDeleting}
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}
