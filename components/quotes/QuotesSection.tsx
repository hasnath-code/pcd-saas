import Link from 'next/link';
import { listQuotesForProject } from '@/db/queries/documents';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
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

export async function QuotesSection({
  projectId,
  viewer = 'org',
  stakeholderAuthUserId,
}: {
  projectId: string;
  viewer?: 'org' | 'stakeholder';
  stakeholderAuthUserId?: string;
}) {
  const quotes = await listQuotesForProject({
    projectId,
    visibleOnly: viewer === 'stakeholder',
    stakeholderAuthUserId,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Quotes</CardTitle>
          <CardDescription>
            {viewer === 'org'
              ? 'Quotes sent to this project’s client. Drafts are private until sent.'
              : 'Quotes issued by the team for this project.'}
          </CardDescription>
        </div>
        {viewer === 'org' && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard/projects/${projectId}/quotes/new`}>
              Create quote
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {quotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No quotes yet"
            description={
              viewer === 'org'
                ? 'Quotes you create are sent to the client as a token-gated public link.'
                : 'Quotes the team issues for this project will appear here.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                {viewer === 'org' && <TableHead className="w-12" />}
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
                  {viewer === 'org' && (
                    <TableCell className="text-right">
                      <Link
                        className="text-sm hover:underline"
                        href={`/dashboard/projects/${projectId}/quotes/${q.id}`}
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
