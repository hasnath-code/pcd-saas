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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createGroupConversation } from '@/actions/conversations';

export type PickableUser = { id: string; name: string | null; role: string };
export type PickableClient = { id: string; name: string | null; email: string };
export type PickableProject = { id: string; projectNumber: string; siteAddress: string };

export function NewConversationDialog({
  users,
  clients,
  projects,
  trigger,
}: {
  users: PickableUser[];
  clients: PickableClient[];
  projects: PickableProject[];
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName('');
    setProjectId('');
    setSelectedUsers(new Set());
    setSelectedClients(new Set());
  }

  function toggleUser(id: string) {
    const next = new Set(selectedUsers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUsers(next);
  }
  function toggleClient(id: string) {
    const next = new Set(selectedClients);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedClients(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.error('Name is required.');
      return;
    }
    startTransition(async () => {
      const result = await createGroupConversation({
        projectId: projectId || null,
        name: trimmed,
        participantUserIds: Array.from(selectedUsers),
        participantClientIds: Array.from(selectedClients),
      });
      if ('error' in result) {
        toast.error(`Couldn't create: ${result.reason ?? result.error}`);
        return;
      }
      toast.success(`Created "${trimmed}".`);
      const data = 'data' in result ? result.data : null;
      reset();
      setOpen(false);
      if (data) router.push(`/conversations/${data.conversationId}`);
      else router.refresh();
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
      <DialogTrigger asChild>{trigger ?? <Button>New conversation</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>
              Group conversations include selected team members and stakeholders.
              Project assignment is optional.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="conv-name">Name</Label>
              <Input
                id="conv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Roof refurb design review"
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conv-project">Project (optional)</Label>
              <select
                id="conv-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="flex h-8 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— No project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectNumber} · {p.siteAddress}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Team members</Label>
              <div className="max-h-32 overflow-y-auto rounded-md border p-2">
                {users.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No team members.</p>
                ) : (
                  users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.has(u.id)}
                        onChange={() => toggleUser(u.id)}
                      />
                      <span>{u.name ?? 'Unnamed'}</span>
                      <span className="text-xs text-muted-foreground">{u.role}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Stakeholders</Label>
              <div className="max-h-32 overflow-y-auto rounded-md border p-2">
                {clients.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No stakeholders linked yet.</p>
                ) : (
                  clients.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedClients.has(c.id)}
                        onChange={() => toggleClient(c.id)}
                      />
                      <span>{c.name ?? 'Unnamed'}</span>
                      <span className="text-xs text-muted-foreground">{c.email}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
