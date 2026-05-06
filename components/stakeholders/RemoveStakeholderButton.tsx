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
import { removeStakeholder } from '@/actions/stakeholders';

const ERROR_TOAST: Record<string, string> = {
  already_removed: 'This stakeholder was already removed.',
  stakeholder: 'Stakeholder not found.',
};

export function RemoveStakeholderButton({
  stakeholderId,
  clientName,
  open,
  onOpenChange,
}: {
  stakeholderId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    startTransition(async () => {
      const result = await removeStakeholder({ stakeholderId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(ERROR_TOAST[reason] ?? `Couldn't remove: ${reason}`);
        return;
      }
      router.refresh();
      toast.success(`${clientName} removed from project.`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {clientName} from this project?</DialogTitle>
          <DialogDescription>
            They&apos;ll lose portal access on their next page load. The client
            record stays for any other projects they&apos;re on.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Keep
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
