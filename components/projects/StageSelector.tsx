'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { moveProjectToStage } from '@/actions/projects';

type StageOption = {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
};

// Stage transition surface for the project detail page. Forward + same-
// position transitions go through immediately. Backward transitions surface
// a shadcn AlertDialog (Decision 9.7 / DEBT-016 — supersedes ADR-024 native
// confirm).
//
// The Select is controlled by `currentStageId`; a cancelled backward
// transition leaves the value pinned to the current stage automatically (the
// prop never changes mid-render). On confirm, the action fires, router
// refreshes, and the new currentStageId flows in via the parent.
export function StageSelector({
  projectId,
  currentStageId,
  stages,
}: {
  projectId: string;
  currentStageId: string;
  stages: StageOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingBackwardTarget, setPendingBackwardTarget] =
    useState<StageOption | null>(null);

  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const current = sorted.find((s) => s.id === currentStageId);

  function transition(target: StageOption) {
    startTransition(async () => {
      const result = await moveProjectToStage({
        projectId,
        toStageId: target.id,
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        if (reason === 'already_on_stage') {
          return;
        }
        toast.error(`Couldn't move stage: ${reason}`);
        return;
      }
      const data = 'data' in result ? result.data : undefined;
      const summary = data?.isTerminalDestination
        ? `Project moved to "${target.name}" — terminal stage.`
        : `Project moved to "${target.name}".`;
      toast.success(summary);
      router.refresh();
    });
  }

  function onValueChange(toStageId: string) {
    if (toStageId === currentStageId) return;
    const target = sorted.find((s) => s.id === toStageId);
    if (!target) return;
    if (current && target.position < current.position) {
      setPendingBackwardTarget(target);
      return;
    }
    transition(target);
  }

  function onBackwardConfirmed() {
    if (!pendingBackwardTarget) return;
    const target = pendingBackwardTarget;
    setPendingBackwardTarget(null);
    transition(target);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="project-stage-select">Move stage</Label>
      <Select
        value={currentStageId}
        onValueChange={onValueChange}
        disabled={isPending}
      >
        <SelectTrigger id="project-stage-select" className="w-full sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sorted.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.position}. {s.name}
              {s.isTerminal ? ' (terminal)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Forward transitions apply immediately. Going backward asks for
        confirmation.
      </p>

      <ConfirmDialog
        open={pendingBackwardTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBackwardTarget(null);
        }}
        title={`Move project back to "${pendingBackwardTarget?.name ?? ''}"?`}
        description="This is unusual but sometimes necessary. The change is logged."
        confirmText="Move backward"
        busy={isPending}
        onConfirm={onBackwardConfirmed}
      />
    </div>
  );
}
