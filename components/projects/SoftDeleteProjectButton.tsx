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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { softDeleteProject } from '@/actions/projects';

export function SoftDeleteProjectButton({
  projectId,
  projectNumber,
}: {
  projectId: string;
  projectNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    startTransition(async () => {
      const result = await softDeleteProject({ projectId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't delete project: ${reason}`);
        return;
      }
      toast.success(`Project ${projectNumber} deleted.`);
      setOpen(false);
      router.push('/dashboard/projects');
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project {projectNumber}?</DialogTitle>
          <DialogDescription>
            This soft-deletes the project. It will disappear from the list but
            can be restored later by an owner or admin.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
