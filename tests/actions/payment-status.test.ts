import { describe, expect, test } from 'vitest';
import { derivePaymentStatus } from '@/lib/documents/payment-status';

// Phase 2 §4 / Session 13 — pure-function unit tests for the derived
// payment-status axis. No DB, no fixtures. Exhaustive over the ladder.

describe('derivePaymentStatus — ladder', () => {
  test('no_quote: no sent quote, no accepted quote, no payments', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: false,
        acceptedQuoteTotal: null,
        hasInitialInvoiceSent: false,
        hasFinalInvoiceSent: false,
        paymentsTotal: 0,
      }),
    ).toBe('no_quote');
  });

  test('quote_sent: any quote sent but no acceptance yet, no payments', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: null,
        hasInitialInvoiceSent: false,
        hasFinalInvoiceSent: false,
        paymentsTotal: 0,
      }),
    ).toBe('quote_sent');
  });

  test('quote_accepted: accepted quote, no invoices, no payments', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: false,
        hasFinalInvoiceSent: false,
        paymentsTotal: 0,
      }),
    ).toBe('quote_accepted');
  });

  test('initial_invoice_sent: initial invoice sent, no payments', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: false,
        paymentsTotal: 0,
      }),
    ).toBe('initial_invoice_sent');
  });

  test('initial_invoice_sent: final invoice sent with no initial, no payments', () => {
    // "initial_invoice_sent" is the label for "any invoice sent, no money yet"
    // — not literally about subtype=initial. Final-only path also lands here.
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: false,
        hasFinalInvoiceSent: true,
        paymentsTotal: 0,
      }),
    ).toBe('initial_invoice_sent');
  });

  test('partially_paid: payments < accepted quote total', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: false,
        paymentsTotal: 500,
      }),
    ).toBe('partially_paid');
  });

  test('paid_in_full: payments == accepted quote total', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: true,
        paymentsTotal: 1000,
      }),
    ).toBe('paid_in_full');
  });

  test('paid_in_full: tolerance absorbs sub-penny float drift', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: true,
        paymentsTotal: 1000.001,
      }),
    ).toBe('paid_in_full');
  });

  test('overpaid: payments > accepted quote total (beyond tolerance)', () => {
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: false,
        paymentsTotal: 1500,
      }),
    ).toBe('overpaid');
  });
});

describe('derivePaymentStatus — accepted-quote-total target invariant', () => {
  test('target is acceptedQuoteTotal, NOT sum of invoice amounts', () => {
    // A project where invoices sum to 600, accepted quote total is 1000,
    // payments total 700. Status should be partially_paid (700 < 1000),
    // NOT paid_in_full (which would be true if the target were sum-of-invoices).
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: false,
        paymentsTotal: 700,
      }),
    ).toBe('partially_paid');
  });

  test('target is acceptedQuoteTotal even when invoice sum exceeds it', () => {
    // Invoices summing to 2000 (initial + final overlap), accepted quote
    // is 1000, payments are 1000. Status is paid_in_full because the target
    // is the quote total, not the invoice sum.
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: 1000,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: true,
        paymentsTotal: 1000,
      }),
    ).toBe('paid_in_full');
  });
});

describe('derivePaymentStatus — initial-invoice-deposit flow (Q1 decision)', () => {
  test('payment recorded with no accepted quote yet → partially_paid', () => {
    // Per Q1 decision (four-decision table): initial invoices are allowed
    // without an accepted quote (deposit/mobilisation flow). A payment that
    // lands in this state is the expected case, not anomalous.
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: true,
        acceptedQuoteTotal: null,
        hasInitialInvoiceSent: true,
        hasFinalInvoiceSent: false,
        paymentsTotal: 250,
      }),
    ).toBe('partially_paid');
  });

  test('payment with no quote at all (edge case) → partially_paid', () => {
    // Defensive: if a surveyor records a payment with no quote OR invoice
    // (data-entry edge case), still surface as partially_paid so the money
    // is visible. The badge doesn't claim a target.
    expect(
      derivePaymentStatus({
        hasAnyQuoteSent: false,
        acceptedQuoteTotal: null,
        hasInitialInvoiceSent: false,
        hasFinalInvoiceSent: false,
        paymentsTotal: 100,
      }),
    ).toBe('partially_paid');
  });
});
