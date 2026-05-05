'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { switchActiveOrg } from '@/actions/orgs';

type OrgOption = {
  orgId: string;
  orgName: string;
  role: 'owner' | 'admin' | 'member';
};

const ROLE_LABEL: Record<OrgOption['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

// Header dropdown for multi-org users. Single-membership users see plain text
// (no dropdown). Click to switch — fires switchActiveOrg, sets the
// active_org_id cookie, and revalidates the dashboard.
export function OrgSwitcher({
  current,
  others,
}: {
  current: OrgOption;
  others: OrgOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (others.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{current.orgName}</span>
        <Badge variant="secondary" className="text-xs">
          {ROLE_LABEL[current.role]}
        </Badge>
      </div>
    );
  }

  function onSelect(orgId: string) {
    if (orgId === current.orgId) return;
    startTransition(async () => {
      const result = await switchActiveOrg({ orgId });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        toast.error(`Couldn't switch organization: ${reason}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          <span className="mr-2 font-medium">{current.orgName}</span>
          <Badge variant="secondary" className="text-xs">
            {ROLE_LABEL[current.role]}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuLabel>Current organization</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onSelect(current.orgId)}
          className="font-medium"
          disabled
        >
          {current.orgName} ({ROLE_LABEL[current.role]})
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Switch to</DropdownMenuLabel>
        {others.map((o) => (
          <DropdownMenuItem
            key={o.orgId}
            onClick={() => onSelect(o.orgId)}
            disabled={isPending}
          >
            {o.orgName}{' '}
            <span className="ml-auto text-xs text-muted-foreground">
              {ROLE_LABEL[o.role]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
