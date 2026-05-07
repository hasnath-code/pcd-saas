'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addWorkflowStage,
  fetchWorkflowDetail,
  removeWorkflowStage,
  updateWorkflow,
} from '@/actions/workflows';

type StageRow = {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
};

export function EditWorkflowDialog({
  workflowId,
  open,
  onOpenChange,
}: {
  workflowId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);
  const [newStageName, setNewStageName] = useState('');
  const [newStageTerminal, setNewStageTerminal] = useState(false);
  const [isSavingMeta, startSaveMeta] = useTransition();
  const [isMutatingStage, startMutateStage] = useTransition();

  // Fetch the workflow when the dialog opens. Re-fetch on workflowId change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchWorkflowDetail({ workflowId }).then((result) => {
      if (cancelled) return;
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't load workflow: ${reason}`);
        onOpenChange(false);
        return;
      }
      const wf = result.data;
      setName(wf.workflowName);
      setDescription(wf.description ?? '');
      setStages(
        wf.stages.map((s) => ({
          id: s.id,
          name: s.name,
          position: s.position,
          isTerminal: s.isTerminal,
        })),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workflowId, onOpenChange]);

  function onSaveMeta() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.error('Workflow name is required.');
      return;
    }
    startSaveMeta(async () => {
      const result = await updateWorkflow({
        workflowId,
        name: trimmed,
        description: description.trim() || null,
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't save: ${reason}`);
        return;
      }
      toast.success('Saved.');
      router.refresh();
    });
  }

  function onAddStage() {
    const trimmed = newStageName.trim();
    if (trimmed.length === 0) {
      toast.error('Stage name is required.');
      return;
    }
    const nextPosition =
      stages.length === 0 ? 1 : Math.max(...stages.map((s) => s.position)) + 1;
    startMutateStage(async () => {
      const result = await addWorkflowStage({
        workflowId,
        name: trimmed,
        position: nextPosition,
        isTerminal: newStageTerminal,
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't add stage: ${reason}`);
        return;
      }
      const newStage: StageRow = {
        id: 'data' in result ? result.data!.stageId : '',
        name: trimmed,
        position: nextPosition,
        isTerminal: newStageTerminal,
      };
      setStages((prev) => [...prev, newStage]);
      setNewStageName('');
      setNewStageTerminal(false);
      toast.success(`Added "${trimmed}".`);
      router.refresh();
    });
  }

  function onRemoveStage(stage: StageRow) {
    if (
      !confirm(
        `Remove stage "${stage.name}"? Any project currently on this stage will block removal.`,
      )
    ) {
      return;
    }
    startMutateStage(async () => {
      const result = await removeWorkflowStage({ stageId: stage.id });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        if (reason === 'stage_in_use') {
          toast.error(
            `Can't remove "${stage.name}" — at least one project sits on it.`,
          );
        } else if (reason === 'last_terminal') {
          toast.error(
            `Can't remove "${stage.name}" — it's the only terminal stage. Add another terminal first.`,
          );
        } else {
          toast.error(`Couldn't remove: ${reason}`);
        }
        return;
      }
      setStages((prev) => prev.filter((s) => s.id !== stage.id));
      toast.success(`Removed "${stage.name}".`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Edit workflow</DialogTitle>
          <DialogDescription>
            Rename, change description, or manage stages. Stages in use by
            active projects can&apos;t be removed.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="edit-wf-name">Name</Label>
                <Input
                  id="edit-wf-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-wf-description">Description</Label>
                <Textarea
                  id="edit-wf-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
              <Button
                onClick={onSaveMeta}
                disabled={isSavingMeta}
                size="sm"
              >
                {isSavingMeta ? 'Saving…' : 'Save name & description'}
              </Button>
            </div>

            <div className="space-y-3">
              <Label>Stages</Label>
              <div className="space-y-2">
                {stages.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <span className="w-6 text-sm text-muted-foreground">
                      {s.position}.
                    </span>
                    <span className="flex-1 text-sm">{s.name}</span>
                    {s.isTerminal && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
                        terminal
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => onRemoveStage(s)}
                      disabled={isMutatingStage}
                      aria-label={`Remove stage ${s.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 rounded-md border-2 border-dashed p-2">
                <Input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="New stage name"
                  className="flex-1"
                  maxLength={60}
                />
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={newStageTerminal}
                    onChange={(e) => setNewStageTerminal(e.target.checked)}
                  />
                  terminal
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={onAddStage}
                  disabled={isMutatingStage || newStageName.trim().length === 0}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
