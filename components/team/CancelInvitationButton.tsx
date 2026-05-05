'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cancelInvitation } from '@/actions/invitations';

const ERROR_TOAST: Record<string, string> = {
  already_accepted: 'This invitation has already been accepted.',
  already_cancelled: 'This invitation was already cancelled.',
  invitation: 'Invitation not found.',
};

export function CancelInvitationButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    startTransition(async () => {
      const result = await cancelInvitation({ invitationId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        const friendly =
          ERROR_TOAST[reason] ?? `Couldn't cancel invitation: ${reason}`;
        toast.error(friendly);
        return;
      }
      toast.success(`Invitation to ${email} cancelled.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Invitation actions">
            ⋯
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            Cancel invitation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel invitation to {email}?</DialogTitle>
            <DialogDescription>
              They won&apos;t be able to use the magic link they were sent.
              You can re-invite them later if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Keep invitation
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Cancelling…' : 'Cancel invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
