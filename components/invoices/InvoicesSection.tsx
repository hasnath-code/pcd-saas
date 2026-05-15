import Link from 'next/link';
import { listInvoicesForProject } from '@/db/queries/documents';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Phase 2 Session 13 — Invoices card on the project detail page. Server
// component; mirrors QuotesSection.
//
// Session 14: viewer prop. Stakeholder mode hides the "Create invoice" CTA,
// drops the per-row "Open" link (no portal-side detail page exists), and
// shows total-only. Caller passes stakeholderAuthUserId for query-layer gating.

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function statusLabel(
  status: string,
  revisionNumber: number,
): string {
  if (status === 'draft') return 'Draft';
  if (status === 'sent') return revisionNumber > 0 ? `Sent (rev ${revisionNumber})` : 'Sent';
  if (status === 'superseded') return 'Superseded';
  if (status === 'void') return 'Void';
  return status;
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'sent') return 'default';
  if (status === 'draft') return 'outline';
  return 'secondary';
}

export async function InvoicesSection({
  projectId,
  viewer = 'org',
  stakeholderAuthUserId,
}: {
  projectId: string;
  viewer?: 'org' | 'stakeholder';
  stakeholderAuthUserId?: string;
}) {
  const invoices = await listInvoicesForProject({
    projectId,
    visibleOnly: viewer === 'stakeholder',
    stakeholderAuthUserId,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            {viewer === 'org'
              ? 'Initial deposits and final invoices. Drafts are private until sent.'
              : 'Invoices issued by the team for this project.'}
          </CardDescription>
        </div>
        {viewer === 'org' && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard/projects/${projectId}/invoices/new`}>
              Create invoice
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {viewer === 'org'
              ? 'No invoices yet. Create one to send the client a token-gated public link.'
              : 'No invoices to show yet.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                {viewer === 'org' && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.documentNumber}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {inv.invoiceSubtype ?? '—'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(inv.status)}>
                      {statusLabel(inv.status, inv.revisionNumber)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatGBP(inv.total)}</TableCell>
                  {viewer === 'org' && (
                    <TableCell className="text-right">
                      <Link
                        className="text-sm hover:underline"
                        href={`/dashboard/projects/${projectId}/invoices/${inv.id}`}
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
