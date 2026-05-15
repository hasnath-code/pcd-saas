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
import { ReviseReceiptDialog } from '@/components/receipts/ReviseReceiptDialog';
import { DownloadPdfButton } from '@/components/pdf/DownloadPdfButton';
import { getAppUrl } from '@/lib/get-app-url';
import { db } from '@/db';
import { documentTokens, payments } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

// Phase 2 Session 14 — org-side receipt detail page. Mirrors the invoice
// detail page shape with the receipt-specific surface area:
//   - No "send" button (receipts auto-create as status='sent')
//   - Recipient revise affordance (replaces the line-items revise on invoices)
//   - Bidirectional payment link (back to the linked payment)
//   - Public link + Download PDF (matches invoice page)

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; receiptId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { projectId, receiptId } = await params;
  const project = await getProjectByIdForOrg(projectId, ctx.orgId);
  if (!project) notFound();

  const doc = await getDocumentById(receiptId, { orgId: ctx.orgId });
  if (!doc || doc.projectId !== projectId || doc.type !== 'receipt') {
    notFound();
  }

  // Public link
  let publicLink: string | null = null;
  const tokRows = await db
    .select({ token: documentTokens.token })
    .from(documentTokens)
    .where(
      and(
        eq(documentTokens.documentId, receiptId),
        eq(documentTokens.documentType, 'receipt'),
      ),
    )
    .limit(1);
  if (tokRows[0]?.token) {
    publicLink = `${getAppUrl()}/r/${tokRows[0].token}`;
  }

  // Linked payment
  let linkedPayment: {
    id: string;
    amount: number;
    recordedAt: Date;
  } | null = null;
  if (doc.paymentId) {
    const payRows = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        recordedAt: payments.recordedAt,
      })
      .from(payments)
      .where(and(eq(payments.id, doc.paymentId), isNull(payments.deletedAt)))
      .limit(1);
    if (payRows[0]) {
      linkedPayment = {
        id: payRows[0].id,
        amount: Number(payRows[0].amount),
        recordedAt: payRows[0].recordedAt,
      };
    }
  }

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
          <h1 className="text-2xl font-semibold">Receipt {doc.documentNumber}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">PAID</Badge>
            {doc.revisionNumber > 0 && (
              <Badge variant="outline">Revision {doc.revisionNumber}</Badge>
            )}
            {doc.sentAt && (
              <span className="text-sm text-muted-foreground">
                Issued {doc.sentAt.toLocaleDateString('en-GB')}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <ReviseReceiptDialog
            documentId={doc.id}
            documentNumber={doc.documentNumber}
            initialRecipientName={doc.recipientName}
          />
          <DownloadPdfButton mode="document" documentId={doc.id} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipient</CardTitle>
          <CardDescription>
            The name printed on the receipt. Edit via &ldquo;Revise recipient&rdquo;
            above; each edit appends an entry to the revision log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-base font-medium">
            {doc.recipientName ?? (
              <span className="text-sm text-muted-foreground">
                No recipient set — revise to add one.
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      {linkedPayment && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linked payment</CardTitle>
            <CardDescription>
              Receipt amount mirrors the linked payment. Use the Payments
              section on the project page to correct the amount.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              <strong>{formatGBP(linkedPayment.amount)}</strong> recorded{' '}
              {linkedPayment.recordedAt.toLocaleDateString('en-GB')}
            </p>
          </CardContent>
        </Card>
      )}

      {publicLink && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Public link</CardTitle>
            <CardDescription>
              Share with the client. Anyone with this link can view the receipt
              read-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md border bg-muted p-2 text-xs">
              {publicLink}
            </code>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Amount</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doc.lineItems.map((li, idx) => (
                <TableRow key={idx}>
                  <TableCell>{li.description}</TableCell>
                  <TableCell className="text-right">
                    {formatGBP(li.unitPrice * li.quantity)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>Total received</span>
            <span>{formatGBP(doc.total)}</span>
          </div>
        </CardContent>
      </Card>

      {doc.revisionNumber > 0 && Array.isArray(doc.revisionLogPayload) && doc.revisionLogPayload.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revision history</CardTitle>
            <CardDescription>
              Recipient changes are tracked here. Money corrections live on
              the linked payment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rev</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Previous recipient</TableHead>
                  <TableHead>New recipient</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doc.revisionLogPayload as Array<{
                  rev: number;
                  reason: string;
                  previous_recipient_name?: string | null;
                  new_recipient_name?: string;
                }>).map((entry) => (
                  <TableRow key={entry.rev}>
                    <TableCell>{entry.rev}</TableCell>
                    <TableCell>{entry.reason}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.previous_recipient_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.new_recipient_name ?? '—'}
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
