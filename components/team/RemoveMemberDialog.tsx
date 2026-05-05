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
import { Button } from '@/components/ui/button';
import { removeUserFromOrg } from '@/actions/users';

const ERROR_TOAST: Record<string, string> = {
  last_owner_cannot_be_removed:
    "You're the only owner. Transfer ownership to another admin or member first.",
};

export function RemoveMemberDialog({
  userId,
  userName,
  orgName,
  open,
  onOpenChange,
}: {
  userId: string;
  userName: string;
  orgName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await removeUserFromOrg({ userId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        const friendly = ERROR_TOAST[reason] ?? `Couldn't remove member: ${reason}`;
        setError(friendly);
        toast.error(friendly);
        return;
      }
      toast.success(`${userName} removed from ${orgName}.`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {userName}?</DialogTitle>
          <DialogDescription>
            They&apos;ll immediately lose access to {orgName}. This can be undone
            within 30 days by support.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
