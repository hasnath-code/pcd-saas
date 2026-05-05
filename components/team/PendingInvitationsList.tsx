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
import type { PendingInvitation } from '@/db/queries/invitations';

function daysUntil(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days === 1) return 'in 1 day';
  return `in ${days} days`;
}

export function PendingInvitationsList({ invitations }: { invitations: PendingInvitation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>
          {invitations.length === 0
            ? 'No pending invitations.'
            : `${invitations.length} invitation${invitations.length === 1 ? '' : 's'} awaiting acceptance.`}
        </CardDescription>
      </CardHeader>
      {invitations.length > 0 && (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {inv.role === 'admin' ? 'Admin' : 'Member'}
                    </Badge>
                    {(inv.latestDeliveryEventType === 'bounced' ||
                      inv.latestDeliveryEventType === 'complained' ||
                      inv.latestDeliveryEventType === 'failed') && (
                      <Badge variant="destructive" className="ml-2">
                        Delivery failed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    Expires {daysUntil(inv.expiresAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
