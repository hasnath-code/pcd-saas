import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
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
import { getDocumentByToken } from '@/db/queries/documents';
import { rateLimit } from '@/lib/ratelimit';
import { DownloadPdfButton } from '@/components/pdf/DownloadPdfButton';

// Phase 2 Session 13 — public token-gated invoice view. Mirrors /q/[token]:
// - Token-only auth surface — middleware skips /i/ paths.
// - publicDoc rate-limit by IP.
// - Token resolution via the Drizzle pooler (bypasses RLS) so unauthenticated
//   callers can read; the security envelope is the random UUID token itself.
// - 404 for invalid/missing tokens, mis-typed (e.g. quote token hitting /i/),
//   or documents in draft/void status.
//
// Read-only: there is NO token-authorized write on this page. Payments are
// recorded org-side. The page renders line items + totals + revision summary
// (if revised). Receipts (one-per-payment) ship in Session 14 with their own
// /r/[token] page.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!UUID_RE.test(token)) notFound();

  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? `token:${token}`;
    const rl = await rateLimit('publicDoc', ip);
    if (rl.limited) {
      return (
        <main className="mx-auto max-w-md p-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Too many requests</CardTitle>
              <CardDescription>
                Please try again in {rl.retryAfterSec} seconds.
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      );
    }
  } catch {
    // No request context — proceed without rate limit.
  }

  const result = await getDocumentByToken(token);
  if (!result) notFound();

  const { document: doc, orgName, tokenDocumentType } = result;
  if (tokenDocumentType !== 'invoice' || doc.type !== 'invoice') notFound();
  if (doc.status === 'draft' || doc.status === 'void') notFound();

  const discountAmount =
    doc.discountPct > 0 ? (doc.subtotal * doc.discountPct) / 100 : 0;
  const subtypeLabel = doc.invoiceSubtype === 'final' ? 'Final' : 'Initial';

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">
          {orgName}
        </p>
        <h1 className="text-2xl font-semibold">
          Invoice {doc.documentNumber}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{subtypeLabel}</Badge>
          {doc.revisionNumber > 0 && (
            <Badge variant="secondary">Revision {doc.revisionNumber}</Badge>
          )}
          {doc.sentAt && (
            <span className="text-sm text-muted-foreground">
              Sent {doc.sentAt.toLocaleDateString('en-GB')}
            </span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-16 text-right">Qty</TableHead>
                <TableHead className="w-28 text-right">Unit</TableHead>
                <TableHead className="w-28 text-right">Total</TableHead>
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

      {doc.status === 'superseded' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This invoice was superseded</CardTitle>
            <CardDescription>
              A newer version has been issued. Please refer to the most recent
              email from {orgName}.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div>
        <DownloadPdfButton mode="token" token={token} label="Download invoice PDF" />
      </div>
    </main>
  );
}
