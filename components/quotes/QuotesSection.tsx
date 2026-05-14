import Link from 'next/link';
import { listQuotesForProject } from '@/db/queries/documents';
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

// Phase 2 — Quotes card section on the project detail page. Server component.
// Org-side caller passes visibleOnly: false (org members see all of their
// org's quotes per the documents SELECT RLS).

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function statusVariant(
  status: string,
  accepted: boolean,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (accepted) return 'default';
  if (status === 'sent') return 'secondary';
  if (status === 'draft') return 'outline';
  return 'destructive';
}

function statusLabel(status: string, accepted: boolean): string {
  if (accepted) return 'Accepted';
  if (status === 'draft') return 'Draft';
  if (status === 'sent') return 'Sent';
  if (status === 'superseded') return 'Superseded';
  if (status === 'void') return 'Void';
  return status;
}

export async function QuotesSection({ projectId }: { projectId: string }) {
  const quotes = await listQuotesForProject({ projectId, visibleOnly: false });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Quotes</CardTitle>
          <CardDescription>
            Quotes sent to this project's client. Drafts are private until sent.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/dashboard/projects/${projectId}/quotes/new`}>
            Create quote
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No quotes yet. Create one to send the client a token-gated public
            link.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">{q.documentNumber}</TableCell>
                  <TableCell>
                    <Badge
                      variant={statusVariant(q.status, q.acceptedAt !== null)}
                    >
                      {statusLabel(q.status, q.acceptedAt !== null)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatGBP(q.total)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="text-sm hover:underline"
                      href={`/dashboard/projects/${projectId}/quotes/${q.id}`}
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
