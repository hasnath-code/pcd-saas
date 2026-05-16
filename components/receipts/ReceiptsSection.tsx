import Link from 'next/link';
import { listReceiptsForProject } from '@/db/queries/documents';
import { Receipt } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Phase 2 Session 14 — Receipts card on the project detail page. Server
// component; mirrors InvoicesSection. Receipts are auto-created in
// recordPayment so there's no "Create receipt" CTA. Per-row "Open" link
// goes to the org-side receipt detail page; portal-side row is read-only.
//
// The bidirectional link is surfaced by including the linked payment
// amount/date alongside each receipt — paired with PaymentsSection which
// shows R{n} per row, the user can hop both directions without hunting.

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export async function ReceiptsSection({
  projectId,
  viewer = 'org',
  stakeholderAuthUserId,
}: {
  projectId: string;
  viewer?: 'org' | 'stakeholder';
  stakeholderAuthUserId?: string;
}) {
  const receipts = await listReceiptsForProject({
    projectId,
    visibleOnly: viewer === 'stakeholder',
    stakeholderAuthUserId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receipts</CardTitle>
        <CardDescription>
          {viewer === 'org'
            ? 'One receipt per recorded payment. Issued automatically; recipient details are revisable.'
            : 'Receipts for payments recorded on this project.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No receipts yet"
            description={
              viewer === 'org'
                ? 'A receipt is issued automatically for each payment you record.'
                : 'Receipts shared with you will appear here.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                {viewer === 'org' && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.documentNumber}</TableCell>
                  <TableCell>
                    {r.sentAt
                      ? r.sentAt.toLocaleDateString('en-GB')
                      : r.createdAt.toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell>
                    {r.recipientName ?? (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatGBP(r.total)}</TableCell>
                  <TableCell>
                    <Badge variant="default">PAID</Badge>
                    {r.revisionNumber > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        rev {r.revisionNumber}
                      </Badge>
                    )}
                  </TableCell>
                  {viewer === 'org' && (
                    <TableCell className="text-right">
                      <Link
                        className="text-sm hover:underline"
                        href={`/dashboard/projects/${projectId}/receipts/${r.id}`}
                      >
                        Open
                      </Link>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
