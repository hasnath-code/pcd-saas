'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { sendMessage } from '@/actions/messages';

const MAX_LEN = 10000;

export function MessageComposer({
  conversationId,
  disabled,
  placeholder = 'Type a message…',
}: {
  conversationId: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();

  const trimmedLen = body.trim().length;
  const tooLong = body.length > MAX_LEN;
  const canSubmit = !disabled && !isPending && trimmedLen > 0 && !tooLong;

  function submit() {
    if (!canSubmit) return;
    const payload = { conversationId, body };
    startTransition(async () => {
      const result = await sendMessage(payload);
      if ('error' in result) {
        toast.error(`Couldn't send: ${result.reason ?? result.error}`);
        return;
      }
      setBody('');
    });
  }

  return (
    <div className="flex flex-col gap-1 border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          rows={2}
          disabled={disabled || isPending}
          maxLength={MAX_LEN + 100}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className="resize-none"
        />
        <Button
          size="icon-lg"
          onClick={submit}
          disabled={!canSubmit}
          aria-label="Send message"
        >
          <Send />
        </Button>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Markdown supported: **bold**, _italic_, `code`, [link](url). Press
          ⌘/Ctrl+Enter to send.
        </span>
        <span className={tooLong ? 'text-destructive' : ''}>
          {body.length}/{MAX_LEN}
        </span>
      </div>
    </div>
  );
}
