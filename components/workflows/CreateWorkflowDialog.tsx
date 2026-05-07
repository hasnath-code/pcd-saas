'use client';

import { useState, useTransition } from 'react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createWorkflow } from '@/actions/workflows';

type StageDraft = {
  name: string;
  isTerminal: boolean;
};

const DEFAULT_STAGES: StageDraft[] = [
  { name: 'Started', isTerminal: false },
  { name: 'In progress', isTerminal: false },
  { name: 'Done', isTerminal: true },
];

export function CreateWorkflowDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageDraft[]>(DEFAULT_STAGES);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName('');
    setDescription('');
    setStages(DEFAULT_STAGES);
  }

  function addStage() {
    setStages((prev) => [...prev, { name: '', isTerminal: false }]);
  }

  function removeStage(idx: number) {
    setStages((prev) => prev.filter((_, i) => i !== idx));
  }

  function setStageField<K extends keyof StageDraft>(
    idx: number,
    key: K,
    value: StageDraft[K],
  ) {
    setStages((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [key]: value } : s)),
    );
  }

  function onSubmit() {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      toast.error('Workflow name is required.');
      return;
    }
    if (stages.length === 0) {
      toast.error('Add at least one stage.');
      return;
    }
    if (!stages.some((s) => s.isTerminal)) {
      toast.error('Mark at least one stage as a terminal (final) stage.');
      return;
    }

    startTransition(async () => {
      const result = await createWorkflow({
        name: trimmedName,
        description: description.trim() || undefined,
        stages: stages.map((s, i) => ({
          name: s.name.trim(),
          position: i + 1,
          isTerminal: s.isTerminal,
        })),
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't create: ${reason}`);
        return;
      }
      toast.success(`Created "${trimmedName}".`);
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create a workflow</DialogTitle>
          <DialogDescription>
            Define the ordered stages your projects move through. Mark at least
            one stage as terminal so projects can close out.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wf-name">Name</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. PCD Surveyor"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-description">Description (optional)</Label>
            <Textarea
              id="wf-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short note on what this workflow is for."
              maxLength={500}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Stages</Label>
            <div className="space-y-2">
              {stages.map((s, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <span className="w-6 text-sm text-muted-foreground">
                    {idx + 1}.
                  </span>
                  <Input
                    value={s.name}
                    onChange={(e) => setStageField(idx, 'name', e.target.value)}
                    placeholder="Stage name"
                    className="flex-1"
                    maxLength={60}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={s.isTerminal}
                      onChange={(e) =>
                        setStageField(idx, 'isTerminal', e.target.checked)
                      }
                    />
                    terminal
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={() => removeStage(idx)}
                    disabled={stages.length <= 1}
                    aria-label={`Remove stage ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStage}
              disabled={stages.length >= 50}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add stage
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? 'Creating…' : 'Create workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
