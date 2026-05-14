import { Badge } from '@/components/ui/badge';
import type { PaymentStatus } from '@/lib/documents/payment-status';

// Phase 2 §4 / Session 13 — payment-status axis badge for project detail
// pages. Rendered alongside the existing ProjectStageBadge so the user sees
// both axes at once ("In Progress · Partially Paid").

const LABELS: Record<PaymentStatus, string> = {
  no_quote: 'No quote',
  quote_sent: 'Quote sent',
  quote_accepted: 'Quote accepted',
  initial_invoice_sent: 'Invoice sent',
  partially_paid: 'Partially paid',
  paid_in_full: 'Paid in full',
  overpaid: 'Overpaid',
};

function variantFor(
  status: PaymentStatus,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'paid_in_full') return 'default';
  if (status === 'overpaid') return 'destructive';
  if (status === 'partially_paid' || status === 'initial_invoice_sent') {
    return 'secondary';
  }
  return 'outline';
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant={variantFor(status)} title={`Payment status: ${LABELS[status]}`}>
      {LABELS[status]}
    </Badge>
  );
}
