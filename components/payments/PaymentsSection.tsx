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
// Org-side caller passes visibleOnly=false; portal-side caller (TBD Session 14)
// will pass true and the query short-circuits to [].

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export async function PaymentsSection({ projectId }: { projectId: string }) {
  const { rows, runningTotal } = await getPaymentsForProject({
    projectId,
    visibleOnly: false,
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
        <RecordPaymentDialog projectId={projectId} />
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead className="w-32" />
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
                    <TableCell>{p.recordedByName ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <CorrectPaymentDialog
                        paymentId={p.id}
                        currentAmount={p.amount}
                      />
                    </TableCell>
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
