import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import { getProjectByIdForOrg } from '@/db/queries/projects';
import { getDocumentById } from '@/db/queries/documents';
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
import { QuoteFormClient } from '@/components/quotes/QuoteFormClient';
import { SendQuoteButton } from '@/components/quotes/SendQuoteButton';
import { DownloadPdfButton } from '@/components/pdf/DownloadPdfButton';
import { getAppUrl } from '@/lib/get-app-url';
import { db } from '@/db';
import { documentTokens } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; quoteId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { projectId, quoteId } = await params;
  const project = await getProjectByIdForOrg(projectId, ctx.orgId);
  if (!project) notFound();

  const doc = await getDocumentById(quoteId, { orgId: ctx.orgId });
  if (!doc || doc.projectId !== projectId || doc.type !== 'quote') {
    notFound();
  }

  // For sent quotes, surface the public link (read the token via pooler).
  let publicLink: string | null = null;
  if (doc.status === 'sent' || doc.status === 'superseded' || doc.acceptedAt) {
    const tokRows = await db
      .select({ token: documentTokens.token })
      .from(documentTokens)
      .where(
        and(
          eq(documentTokens.documentId, quoteId),
          eq(documentTokens.documentType, 'quote'),
        ),
      )
      .limit(1);
    if (tokRows[0]?.token) {
      publicLink = `${getAppUrl()}/q/${tokRows[0].token}`;
    }
  }

  const discountAmount =
    doc.discountPct > 0 ? (doc.subtotal * doc.discountPct) / 100 : 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/dashboard/projects/${projectId}`}
              className="hover:underline"
            >
              ← {project.projectNumber}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Quote {doc.documentNumber}</h1>
          <div className="flex items-center gap-2">
            <Badge variant={doc.acceptedAt ? 'default' : 'secondary'}>
              {doc.acceptedAt
                ? 'Accepted'
                : doc.status[0].toUpperCase() + doc.status.slice(1)}
            </Badge>
            {doc.sentAt && (
              <span className="text-sm text-muted-foreground">
                Sent {doc.sentAt.toLocaleDateString('en-GB')}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {doc.status === 'draft' && (
            <SendQuoteButton
              documentId={doc.id}
              documentNumber={doc.documentNumber}
            />
          )}
          {(doc.status === 'sent' || doc.status === 'superseded') && (
            <DownloadPdfButton mode="document" documentId={doc.id} />
          )}
        </div>
      </div>

      {doc.acceptedAt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acceptance</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Accepted by <strong>{doc.acceptedByName}</strong> on{' '}
            {doc.acceptedAt.toLocaleDateString('en-GB')}.
          </CardContent>
        </Card>
      )}

      {publicLink && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Public link</CardTitle>
            <CardDescription>
              Share with the client. Anyone with this link can view the quote
              (and accept it while in the sent state).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md border bg-muted p-2 text-xs">
              {publicLink}
            </code>
          </CardContent>
        </Card>
      )}

      {doc.status === 'draft' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit draft</CardTitle>
            <CardDescription>
              Drafts can be edited freely. Send to lock in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuoteFormClient
              mode={{
                kind: 'edit',
                projectId,
                documentId: doc.id,
                initial: {
                  lineItems: doc.lineItems,
                  discountPct: doc.discountPct,
                  vatApplicable: doc.vatApplicable,
                },
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-32 text-right">Unit price</TableHead>
                  <TableHead className="w-32 text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doc.lineItems.map((li, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{li.description}</TableCell>
                    <TableCell className="text-right">{li.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatGBP(li.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatGBP(li.unitPrice * li.quantity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatGBP(doc.subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Discount ({doc.discountPct}%)</span>
                  <span>−{formatGBP(discountAmount)}</span>
                </div>
              )}
              {doc.vatApplicable && (
                <div className="flex justify-between text-muted-foreground">
                  <span>VAT (20%)</span>
                  <span>{formatGBP(doc.vatAmount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>Total</span>
                <span>{formatGBP(doc.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
