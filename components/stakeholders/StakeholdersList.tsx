'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StakeholderRow } from '@/db/queries/projects';
import { EditStakeholderDialog } from './EditStakeholderDialog';
import { RemoveStakeholderButton } from './RemoveStakeholderButton';
import { VISIBILITY_PROFILE_LABELS } from '@/lib/visibility-profiles';

const STAKEHOLDER_ROLES = [
  'primary_client',
  'collaborator',
  'observer',
  'billing_contact',
] as const;

const ROLE_LABELS: Record<string, string> = {
  primary_client: 'Primary client',
  collaborator: 'Collaborator',
  observer: 'Observer',
  billing_contact: 'Billing contact',
};

export function StakeholdersList({ rows }: { rows: StakeholderRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stakeholders yet. Use &quot;Invite stakeholder&quot; above to add one.
      </p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => {
            const isEditing = editingId === s.id;
            const isRemoving = removingId === s.id;
            const profileKey =
              s.visibilityProfile in VISIBILITY_PROFILE_LABELS
                ? (s.visibilityProfile as keyof typeof VISIBILITY_PROFILE_LABELS)
                : 'custom';
            return (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.clientName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.clientEmail}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {ROLE_LABELS[s.role] ?? s.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {VISIBILITY_PROFILE_LABELS[profileKey]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.acceptedAt
                    ? `Joined ${s.acceptedAt.toLocaleDateString('en-GB')}`
                    : 'Pending'}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Actions for ${s.clientName}`}
                      >
                        ⋯
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingId(s.id)}>
                        Edit visibility
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setRemovingId(s.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {isEditing && (
                    <EditStakeholderDialog
                      stakeholderId={s.id}
                      clientName={s.clientName}
                      initialRole={
                        STAKEHOLDER_ROLES.includes(
                          s.role as (typeof STAKEHOLDER_ROLES)[number],
                        )
                          ? (s.role as (typeof STAKEHOLDER_ROLES)[number])
                          : 'collaborator'
                      }
                      initialFlags={{
                        canMessage: s.canMessage,
                        canUploadFiles: s.canUploadFiles,
                        canViewFinancials: s.canViewFinancials,
                        canViewDrawings: s.canViewDrawings,
                        canViewSchedule: s.canViewSchedule,
                      }}
                      open={isEditing}
                      onOpenChange={(o) => setEditingId(o ? s.id : null)}
                    />
                  )}
                  {isRemoving && (
                    <RemoveStakeholderButton
                      stakeholderId={s.id}
                      clientName={s.clientName}
                      open={isRemoving}
                      onOpenChange={(o) => setRemovingId(o ? s.id : null)}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
