// Phase 2 §4 / Session 13 — derived payment-status axis.
//
// Two-axis status model: the project's workflow stage is already modelled
// (projects.current_stage_id). The payment-status axis is a pure function of
// document + payment primitives — nothing new is stored. The org-side project
// detail page renders both axes side-by-side ("In Progress · Partially Paid").
//
// States (kickoff §4):
//   no_quote               — no quote ever sent on this project.
//   quote_sent             — a quote is in 'sent' status, not yet accepted.
//   quote_accepted         — accepted quote exists, no invoice sent yet.
//   initial_invoice_sent   — at least one invoice has been sent (initial OR
//                            final), no payments recorded yet. The label is
//                            literal — the "initial" word reads as the V2
//                            framing — but the state also covers the rarer
//                            "final invoice sent with no deposit" path.
//   partially_paid         — payments recorded, sum < accepted quote total.
//   paid_in_full           — payments recorded, sum == accepted quote total
//                            (within 2dp tolerance, mirroring documents'
//                            stored numeric(12,2) precision).
//   overpaid               — payments recorded, sum > accepted quote total.
//
// Refunds (kickoff §4: "out of scope unless you propose a clean additive way
// to model it") are not represented: payments.amount > 0 CHECK precludes
// negative rows, so 'refunded' would need a separate `payment_refunds` table
// shape. Filed as DEBT-065 instead.
//
// `paid_in_full` tolerance: a 0.005 epsilon matches the smallest representable
// gap at 2dp (1/2 a penny). The downstream numeric(12,2) DB column rounds to
// a cleaner boundary on insert; the runtime comparison just needs to ignore
// float-drift on the in-memory SUM.

export type PaymentStatus =
  | 'no_quote'
  | 'quote_sent'
  | 'quote_accepted'
  | 'initial_invoice_sent'
  | 'partially_paid'
  | 'paid_in_full'
  | 'overpaid';

export interface PaymentStatusInput {
  /** Any quote on the project currently in 'sent' status (not superseded/void). */
  hasAnyQuoteSent: boolean;
  /**
   * The accepted quote's `total` (numeric). `null` when no quote has been
   * accepted yet — the payment target is then undefined and any payment that
   * lands is treated as the expected initial-invoice deposit flow (see step 6
   * in the ladder below).
   */
  acceptedQuoteTotal: number | null;
  /** At least one type='invoice' subtype='initial' row in 'sent' status. */
  hasInitialInvoiceSent: boolean;
  /** At least one type='invoice' subtype='final' row in 'sent' status. */
  hasFinalInvoiceSent: boolean;
  /** SUM(amount) of non-deleted payments rows on the project. */
  paymentsTotal: number;
}

const PAID_IN_FULL_TOLERANCE = 0.005;

export function derivePaymentStatus(input: PaymentStatusInput): PaymentStatus {
  const {
    hasAnyQuoteSent,
    acceptedQuoteTotal,
    hasInitialInvoiceSent,
    hasFinalInvoiceSent,
    paymentsTotal,
  } = input;

  const anyInvoiceSent = hasInitialInvoiceSent || hasFinalInvoiceSent;
  const hasPayments = paymentsTotal > 0;

  // 1. No quote, no money: pre-quote state.
  if (!hasPayments && acceptedQuoteTotal === null && !hasAnyQuoteSent) {
    return 'no_quote';
  }

  // 2. Quote sent but not accepted, no payments: client is reviewing the quote.
  if (!hasPayments && acceptedQuoteTotal === null && hasAnyQuoteSent) {
    return 'quote_sent';
  }

  // 3. Quote accepted, no invoices, no payments: signed off, no billing yet.
  if (!hasPayments && acceptedQuoteTotal !== null && !anyInvoiceSent) {
    return 'quote_accepted';
  }

  // 4. Invoices sent (initial or final), no payments recorded yet.
  if (!hasPayments && anyInvoiceSent) {
    return 'initial_invoice_sent';
  }

  // 5. Payments recorded against an accepted quote: compare to target.
  if (hasPayments && acceptedQuoteTotal !== null) {
    if (paymentsTotal > acceptedQuoteTotal + PAID_IN_FULL_TOLERANCE) {
      return 'overpaid';
    }
    if (Math.abs(paymentsTotal - acceptedQuoteTotal) < PAID_IN_FULL_TOLERANCE) {
      return 'paid_in_full';
    }
    return 'partially_paid';
  }

  // 6. Payments recorded but no accepted quote: the expected initial-invoice
  //    deposit flow (e.g. a surveyor takes a mobilisation deposit on the
  //    'initial' invoice before the quote is formally accepted — Q1 decision
  //    in the four-decision table allows subtype='initial' without an accepted
  //    quote; this branch is where those payments land on the badge surface).
  //    Render as `partially_paid` so the user sees money has arrived without
  //    claiming a target the system doesn't yet know.
  return 'partially_paid';
}
