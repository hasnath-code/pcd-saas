'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { restoreFile } from '@/actions/files';

// DEBT-035 — per-row Restore control for the file recycle bin. Thin client
// wrapper over the existing `restoreFile` server action (org-admin-only,
// clears deleted_at, audit-logs 'restore'). No confirmation dialog — restore
// is non-destructive, unlike SoftDeleteProjectButton's delete. On success,
// router.refresh() re-runs the recycle page's server fetch so the restored
// row drops off the list.
export function RestoreFileButton({
  fileId,
  filename,
}: {
  fileId: string;
  filename: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onRestore() {
    startTransition(async () => {
      const result = await restoreFile({ fileId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't restore ${filename}: ${reason}`);
        return;
      }
      toast.success(`${filename} restored.`);
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onRestore} disabled={isPending}>
      {isPending ? 'Restoring…' : 'Restore'}
    </Button>
  );
}
