'use client';

import { useTransition } from 'react';
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
import { moveProjectToStage } from '@/actions/projects';

type StageOption = {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
};

// Replaces the placeholder "Stage transitions ship in a future update." with
// an interactive Select. Backward transitions surface a confirm() dialog
// (the action allows them; we just want the user to pause). Forward + same-
// position transitions go through immediately.
//
// The visual stage timeline above this control stays read-only — it remains
// the at-a-glance progress view; this is the action surface.
//
// confirm() is used here for parity with WorkflowsList + EditWorkflowDialog
// (the codebase doesn't ship shadcn's AlertDialog yet); replace with a styled
// dialog when AlertDialog lands.
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
      const ok = confirm(
        `Move this project back to "${target.name}"? This is unusual but sometimes necessary. The change is logged.`,
      );
      if (!ok) return;
    }
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
    </div>
  );
}
