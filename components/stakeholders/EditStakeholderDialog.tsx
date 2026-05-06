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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateStakeholder } from '@/actions/stakeholders';
import { VisibilityProfilePicker } from './VisibilityProfilePicker';
import {
  inferVisibilityProfile,
  type VisibilityFlags,
  type VisibilityProfile,
} from '@/lib/visibility-profiles';

const STAKEHOLDER_ROLES = [
  'primary_client',
  'collaborator',
  'observer',
  'billing_contact',
] as const;

const ROLE_LABELS: Record<(typeof STAKEHOLDER_ROLES)[number], string> = {
  primary_client: 'Primary client',
  collaborator: 'Collaborator',
  observer: 'Observer',
  billing_contact: 'Billing contact',
};

export function EditStakeholderDialog({
  stakeholderId,
  clientName,
  initialRole,
  initialFlags,
  open,
  onOpenChange,
}: {
  stakeholderId: string;
  clientName: string;
  initialRole: (typeof STAKEHOLDER_ROLES)[number];
  initialFlags: VisibilityFlags;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const inferredProfile = inferVisibilityProfile(initialFlags);
  const [role, setRole] = useState<(typeof STAKEHOLDER_ROLES)[number]>(initialRole);
  const [profile, setProfile] = useState<VisibilityProfile>(inferredProfile);
  const [customFlags, setCustomFlags] = useState<VisibilityFlags | null>(
    inferredProfile === 'custom' ? initialFlags : null,
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit() {
    startTransition(async () => {
      const result = await updateStakeholder({
        stakeholderId,
        role,
        visibilityProfile: profile,
        customFlags: profile === 'custom' && customFlags ? customFlags : undefined,
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't update: ${reason}`);
        return;
      }
      router.refresh();
      toast.success(`${clientName} updated.`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit {clientName}</DialogTitle>
          <DialogDescription>
            Change role or visibility. Changes apply on the stakeholder&apos;s
            next portal load.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as (typeof STAKEHOLDER_ROLES)[number])}
            >
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAKEHOLDER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <VisibilityProfilePicker
            profile={profile}
            customFlags={customFlags}
            onProfileChange={(p) => {
              setProfile(p);
              if (p !== 'custom') setCustomFlags(null);
            }}
            onCustomFlagsChange={setCustomFlags}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
