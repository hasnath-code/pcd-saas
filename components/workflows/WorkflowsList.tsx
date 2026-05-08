'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EditWorkflowDialog } from './EditWorkflowDialog';
import { deleteWorkflow } from '@/actions/workflows';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export type WorkflowsListRow = {
  workflowId: string;
  workflowName: string;
  isDefault: boolean;
  stageCount: number;
  projectCount: number;
};

export function WorkflowsList({
  workflows,
  canManage,
}: {
  workflows: WorkflowsListRow[];
  canManage: boolean;
}) {
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowsListRow | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const router = useRouter();

  function onDelete() {
    if (!deleteTarget) return;
    const row = deleteTarget;
    startDelete(async () => {
      const result = await deleteWorkflow({ workflowId: row.workflowId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        if (reason === 'workflow_in_use') {
          toast.error(
            `Cannot delete: ${row.projectCount} project(s) use this workflow. Move them off first.`,
          );
        } else {
          toast.error(`Couldn't delete: ${reason}`);
        }
        setDeleteTarget(null);
        return;
      }
      toast.success(`Deleted "${row.workflowName}".`);
      setDeleteTarget(null);
      router.refresh();
    });
  }

  if (workflows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No custom workflows yet</CardTitle>
          <CardDescription>
            Your org has the default Simple workflow. Create a custom workflow
            to define your own stages.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your workflows</CardTitle>
          <CardDescription>
            Workflows in use by active projects can&apos;t be deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-24">Stages</TableHead>
                <TableHead className="w-32">In use</TableHead>
                <TableHead className="w-48 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((w) => (
                <TableRow key={w.workflowId}>
                  <TableCell className="font-medium">
                    {w.workflowName}
                    {w.isDefault && (
                      <Badge variant="secondary" className="ml-2">
                        default
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{w.stageCount}</TableCell>
                  <TableCell>
                    {w.projectCount === 0
                      ? '—'
                      : `${w.projectCount} project${w.projectCount === 1 ? '' : 's'}`}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditTarget(w.workflowId)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isDeleting || w.projectCount > 0}
                          onClick={() => setDeleteTarget(w)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editTarget && (
        <EditWorkflowDialog
          workflowId={editTarget}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete "${deleteTarget?.workflowName ?? ''}"?`}
        description="This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        busy={isDeleting}
        onConfirm={onDelete}
      />
    </>
  );
}
