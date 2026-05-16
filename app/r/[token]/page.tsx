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

// Phase 2 Session 14 — public token-gated receipt view. Mirrors /q/[token]
// and /i/[token]:
// - Token-only auth surface — middleware already lists /r/ in PUBLIC_PREFIXES.
// - publicDoc rate-limit by IP, fallback per-token if x-forwarded-for absent.
// - Token resolution via the Drizzle pooler (RLS-bypass; the random UUID
//   token IS the security envelope per §25 + ADR-001).
// - 404 for invalid/missing tokens, mis-typed (e.g. invoice token hitting
//   /r/), or documents in draft/void status. Cross-type tokens 404 per
//   ADR-034.
//
// Receipt-specific: read-only. There's no token-authorized write on this
// page — receipts record what happened, not what's about to. Money values
// render straight from the documents row (correctPayment keeps the
// snapshot in lockstep, see actions/payments.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!UUID_RE.test(token)) notFound();

  try {
    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? `token:${token}`;
    const rl = await rateLimit('publicDoc', ip);
    if (rl.limited) {
      return (
        <main className="mx-auto max-w-md p-4 sm:p-8">
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
    // No request context — proceed without rate limit (matches /q/, /i/).
  }

  const result = await getDocumentByToken(token);
  if (!result) notFound();

  const { document: doc, orgName, tokenDocumentType } = result;
  if (tokenDocumentType !== 'receipt' || doc.type !== 'receipt') notFound();
  if (doc.status === 'draft' || doc.status === 'void') notFound();

  const issuedAt = doc.sentAt;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
      <div className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">
          {orgName}
        </p>
        <h1 className="text-2xl font-semibold">Receipt {doc.documentNumber}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">PAID</Badge>
          {doc.revisionNumber > 0 && (
            <Badge variant="secondary">Revision {doc.revisionNumber}</Badge>
          )}
          {issuedAt && (
            <span className="text-sm text-muted-foreground">
              Received {issuedAt.toLocaleDateString('en-GB')}
            </span>
          )}
        </div>
      </div>

      {doc.recipientName && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Received from</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium">{doc.recipientName}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment received</CardTitle>
          <CardDescription>
            This receipt acknowledges payment received by {orgName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
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
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total received</span>
            <span>{formatGBP(doc.total)}</span>
          </div>
        </CardContent>
      </Card>

      <div>
        <DownloadPdfButton mode="token" token={token} label="Download receipt PDF" />
      </div>
    </main>
  );
}
