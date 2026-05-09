'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserPlus, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  addConversationParticipant,
  removeConversationParticipant,
} from '@/actions/conversations';

type Participant = {
  participantType: 'user' | 'client';
  participantId: string;
  displayName: string;
};

type Pickable = {
  participantType: 'user' | 'client';
  participantId: string;
  displayName: string;
  subline?: string;
};

export function ParticipantsManager({
  conversationId,
  participants,
  pickableUsers,
  pickableClients,
  canManage,
}: {
  conversationId: string;
  participants: Participant[];
  pickableUsers: Pickable[];
  pickableClients: Pickable[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Participant | null>(null);
  const [isMutating, startMutation] = useTransition();

  const currentKeys = new Set(
    participants.map((p) => `${p.participantType}:${p.participantId}`),
  );
  const availableUsers = pickableUsers.filter(
    (u) => !currentKeys.has(`${u.participantType}:${u.participantId}`),
  );
  const availableClients = pickableClients.filter(
    (c) => !currentKeys.has(`${c.participantType}:${c.participantId}`),
  );

  function onAdd(target: Pickable) {
    startMutation(async () => {
      const result = await addConversationParticipant({
        conversationId,
        participantType: target.participantType,
        participantId: target.participantId,
      });
      if ('error' in result) {
        toast.error(`Couldn't add: ${result.reason ?? result.error}`);
        return;
      }
      toast.success(`Added ${target.displayName}.`);
      setAdding(false);
      router.refresh();
    });
  }

  function onConfirmRemove() {
    if (!pendingRemove) return;
    const target = pendingRemove;
    startMutation(async () => {
      const result = await removeConversationParticipant({
        conversationId,
        participantType: target.participantType,
        participantId: target.participantId,
      });
      if ('error' in result) {
        toast.error(`Couldn't remove: ${result.reason ?? result.error}`);
        setPendingRemove(null);
        return;
      }
      toast.success(`Removed ${target.displayName}.`);
      setPendingRemove(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {participants.map((p) => (
          <span
            key={`${p.participantType}:${p.participantId}`}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {p.displayName}
            <span className="text-muted-foreground">
              ({p.participantType === 'user' ? 'team' : 'stakeholder'})
            </span>
            {canManage ? (
              <button
                type="button"
                onClick={() => setPendingRemove(p)}
                aria-label={`Remove ${p.displayName}`}
                className="rounded-full text-muted-foreground hover:text-destructive"
                disabled={isMutating}
              >
                <UserMinus className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {canManage ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setAdding(true)}
            disabled={isMutating}
          >
            <UserPlus />
            Add participant
          </Button>
        ) : null}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add participant</DialogTitle>
            <DialogDescription>
              Pick a team member or stakeholder to invite into this conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div>
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Team members
              </p>
              {availableUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  All team members are already participants.
                </p>
              ) : (
                <ul className="space-y-1">
                  {availableUsers.map((u) => (
                    <li key={u.participantId}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => onAdd(u)}
                        disabled={isMutating}
                      >
                        <span>{u.displayName}</span>
                        {u.subline ? (
                          <span className="text-xs text-muted-foreground">
                            {u.subline}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Stakeholders
              </p>
              {availableClients.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No additional stakeholders linked to this org.
                </p>
              ) : (
                <ul className="space-y-1">
                  {availableClients.map((c) => (
                    <li key={c.participantId}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => onAdd(c)}
                        disabled={isMutating}
                      >
                        <span>{c.displayName}</span>
                        {c.subline ? (
                          <span className="text-xs text-muted-foreground">
                            {c.subline}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title={`Remove ${pendingRemove?.displayName ?? ''}?`}
        description="They'll lose access to this conversation. A system message will note the change."
        confirmText="Remove"
        variant="destructive"
        busy={isMutating}
        onConfirm={onConfirmRemove}
      />
    </div>
  );
}
