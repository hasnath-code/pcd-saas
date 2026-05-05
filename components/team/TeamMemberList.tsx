'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { RemoveMemberDialog } from '@/components/team/RemoveMemberDialog';
import type { TeamMember } from '@/db/queries/team';

const ROLE_LABEL = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
} as const;

export function TeamMemberList({
  members,
  currentUserId,
  currentUserRole,
  orgName,
}: {
  members: TeamMember[];
  currentUserId: string;
  currentUserRole: 'owner' | 'admin' | 'member';
  orgName: string;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const isAdmin = currentUserRole === 'owner' || currentUserRole === 'admin';
  const removingMember = members.find((m) => m.id === removingId) ?? null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Everyone here can sign in to your firm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isYou = m.id === currentUserId;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.name}
                      {isYou && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={m.role === 'owner' ? 'default' : 'secondary'}
                      >
                        {ROLE_LABEL[m.role]}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {!isYou && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={`Actions for ${m.name}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setRemovingId(m.id)}
                              >
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {removingMember && (
        <RemoveMemberDialog
          userId={removingMember.id}
          userName={removingMember.name}
          orgName={orgName}
          open={true}
          onOpenChange={(open) => {
            if (!open) setRemovingId(null);
          }}
        />
      )}
    </>
  );
}
