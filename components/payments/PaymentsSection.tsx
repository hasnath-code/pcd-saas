import Link from 'next/link';
import { getPaymentsForProject } from '@/db/queries/payments';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import { CorrectPaymentDialog } from './CorrectPaymentDialog';

// Phase 2 Session 13 — Payments card on the project detail page. Server
// component. Shows recorded payments, running total, and exposes
// record-payment + per-row correct-payment affordances via client dialogs.
//
// Session 14: viewer prop + bidirectional payment↔receipt link.
//   - viewer='org' (default): shows record/correct affordances + R{n} link
//     to org-side receipt detail page.
//   - viewer='stakeholder': read-only, shows R{n} link to /r/[token] (TBD
//     — for now stakeholder-side rows show R{n} as plain text since no
//     token is available on the receipt-list query — the dedicated
//     receipt-section card on the portal page surfaces full receipt info).
//   stakeholderAuthUserId is forwarded to the query layer for defense-in-depth.

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export async function PaymentsSection({
  projectId,
  viewer = 'org',
  stakeholderAuthUserId,
}: {
  projectId: string;
  viewer?: 'org' | 'stakeholder';
  stakeholderAuthUserId?: string;
}) {
  const { rows, runningTotal } = await getPaymentsForProject({
    projectId,
    visibleOnly: viewer === 'stakeholder',
    stakeholderAuthUserId,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Payments</CardTitle>
          <CardDescription>
            Recorded against the accepted quote. Running total:{' '}
            <strong>{formatGBP(runningTotal)}</strong>
          </CardDescription>
        </div>
        {viewer === 'org' && <RecordPaymentDialog projectId={projectId} />}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {viewer === 'org'
              ? 'No payments recorded yet.'
              : 'No payments to show yet.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Receipt</TableHead>
                {viewer === 'org' && <TableHead>Recorded by</TableHead>}
                {viewer === 'org' && <TableHead className="w-32" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const corrections = Array.isArray(p.correctionLogPayload)
                  ? p.correctionLogPayload.length
                  : 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.recordedAt.toLocaleDateString('en-GB')}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatGBP(p.amount)}
                      {corrections > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (corrected ×{corrections})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.receiptNumber && p.receiptId ? (
                        viewer === 'org' ? (
                          <Link
                            className="text-sm hover:underline"
                            href={`/dashboard/projects/${projectId}/receipts/${p.receiptId}`}
                          >
                            {p.receiptNumber}
                          </Link>
                        ) : (
                          <span className="text-sm">{p.receiptNumber}</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {viewer === 'org' && (
                      <TableCell>{p.recordedByName ?? '—'}</TableCell>
                    )}
                    {viewer === 'org' && (
                      <TableCell className="text-right">
                        <CorrectPaymentDialog
                          paymentId={p.id}
                          currentAmount={p.amount}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
