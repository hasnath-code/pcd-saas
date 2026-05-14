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
import { InvoiceFormClient } from '@/components/invoices/InvoiceFormClient';
import { SendInvoiceButton } from '@/components/invoices/SendInvoiceButton';
import { ReviseInvoiceDialog } from '@/components/invoices/ReviseInvoiceDialog';
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

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; invoiceId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { projectId, invoiceId } = await params;
  const project = await getProjectByIdForOrg(projectId, ctx.orgId);
  if (!project) notFound();

  const doc = await getDocumentById(invoiceId, { orgId: ctx.orgId });
  if (!doc || doc.projectId !== projectId || doc.type !== 'invoice') {
    notFound();
  }

  let publicLink: string | null = null;
  if (doc.status === 'sent' || doc.status === 'superseded') {
    const tokRows = await db
      .select({ token: documentTokens.token })
      .from(documentTokens)
      .where(
        and(
          eq(documentTokens.documentId, invoiceId),
          eq(documentTokens.documentType, 'invoice'),
        ),
      )
      .limit(1);
    if (tokRows[0]?.token) {
      publicLink = `${getAppUrl()}/i/${tokRows[0].token}`;
    }
  }

  const discountAmount =
    doc.discountPct > 0 ? (doc.subtotal * doc.discountPct) / 100 : 0;
  const subtypeLabel = doc.invoiceSubtype === 'final' ? 'Final' : 'Initial';

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
          <h1 className="text-2xl font-semibold">Invoice {doc.documentNumber}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{subtypeLabel}</Badge>
            <Badge variant={doc.status === 'sent' ? 'default' : 'secondary'}>
              {doc.status[0].toUpperCase() + doc.status.slice(1)}
            </Badge>
            {doc.revisionNumber > 0 && (
              <Badge variant="outline">Revision {doc.revisionNumber}</Badge>
            )}
            {doc.sentAt && (
              <span className="text-sm text-muted-foreground">
                Sent {doc.sentAt.toLocaleDateString('en-GB')}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {doc.status === 'draft' && (
            <SendInvoiceButton
              documentId={doc.id}
              documentNumber={doc.documentNumber}
            />
          )}
          {doc.status === 'sent' && (
            <ReviseInvoiceDialog
              documentId={doc.id}
              documentNumber={doc.documentNumber}
              initial={{
                subtype: doc.invoiceSubtype,
                lineItems: doc.lineItems,
                discountPct: doc.discountPct,
                vatApplicable: doc.vatApplicable,
              }}
            />
          )}
        </div>
      </div>

      {publicLink && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Public link</CardTitle>
            <CardDescription>
              Share with the client. Anyone with this link can view the invoice
              read-only — payments are recorded by the org, not through the
              public page.
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
            <InvoiceFormClient
              mode={{
                kind: 'edit',
                projectId,
                documentId: doc.id,
                initial: {
                  subtype: doc.invoiceSubtype,
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
            <CardTitle className="text-base">Invoice</CardTitle>
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

      {doc.revisionNumber > 0 && Array.isArray(doc.revisionLogPayload) && doc.revisionLogPayload.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revision history</CardTitle>
            <CardDescription>
              Every revise call appends an entry with the amount delta and your
              reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rev</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">New</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doc.revisionLogPayload as Array<{
                  rev: number;
                  previous_amount: number;
                  new_amount: number;
                  reason: string;
                }>).map((entry) => (
                  <TableRow key={entry.rev}>
                    <TableCell>{entry.rev}</TableCell>
                    <TableCell>{entry.reason}</TableCell>
                    <TableCell className="text-right">
                      {formatGBP(Number(entry.previous_amount))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatGBP(Number(entry.new_amount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
