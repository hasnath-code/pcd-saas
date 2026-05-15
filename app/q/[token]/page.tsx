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
import { AcceptQuoteForm } from '@/components/quotes/AcceptQuoteForm';
import { DownloadPdfButton } from '@/components/pdf/DownloadPdfButton';

// Phase 2 §2.9 + ADR-001 + ADR-034. Public token-gated quote view.
// - Token-only auth surface — middleware skips /q/ paths.
// - publicDoc rate-limit by IP (lib/ratelimit.ts limiter ready since Phase 1a).
// - Token resolution via the Drizzle pooler (bypasses RLS) so unauthenticated
//   callers can read; the security envelope is the random UUID token itself
//   (§25 + ADR-001: "no token = 404, mismatched = 404").
// - Renders 404 for invalid/missing tokens, mis-typed (e.g. invoice token
//   hitting /q/), or documents in draft/void status.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!UUID_RE.test(token)) notFound();

  // Rate-limit. Per-IP via the publicDoc bucket; falls back to per-token if
  // x-forwarded-for is missing.
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? `token:${token}`;
    const rl = await rateLimit('publicDoc', ip);
    if (rl.limited) {
      // Mimic 429 surface — render a plain message; no token leakage.
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
  // A quote token must hit a 'quote'-typed document. Cross-type tokens 404
  // per ADR-034 (token-type-match is part of the security envelope).
  if (tokenDocumentType !== 'quote' || doc.type !== 'quote') notFound();
  if (doc.status === 'draft' || doc.status === 'void') notFound();

  const discountAmount =
    doc.discountPct > 0 ? (doc.subtotal * doc.discountPct) / 100 : 0;
  const accepted = doc.acceptedAt !== null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">
          {orgName}
        </p>
        <h1 className="text-2xl font-semibold">Quote {doc.documentNumber}</h1>
        {accepted && (
          <Badge variant="default">
            Accepted by {doc.acceptedByName} on{' '}
            {doc.acceptedAt!.toLocaleDateString('en-GB')}
          </Badge>
        )}
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

      <div>
        <DownloadPdfButton mode="token" token={token} label="Download quote PDF" />
      </div>

      {!accepted && doc.status === 'sent' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accept this quote</CardTitle>
            <CardDescription>
              Enter your name to confirm. You can reach out to {orgName} to
              discuss any changes before accepting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AcceptQuoteForm token={token} quoteNumber={doc.documentNumber} />
          </CardContent>
        </Card>
      )}

      {doc.status === 'superseded' && !accepted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This quote was revised</CardTitle>
            <CardDescription>
              A newer version has been issued. Please refer to the most recent
              email from {orgName}.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
