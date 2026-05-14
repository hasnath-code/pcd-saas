import type { LineItem } from './vat';

// Phase 2 Session 13 — reviseInvoice semantic-diff helper.
//
// reviseInvoice writes a `fields_changed: string[]` to each revision_log_payload
// entry. The diff must be SEMANTIC, not raw JSONB: a re-serialised payload
// with identical content (e.g. numeric stringification drift between 100 and
// "100.00", or whitespace differences inside line item strings) must NOT log
// a phantom change.
//
// If diff returns an empty list, the action returns `{error:'conflict',
// reason:'no_changes'}` rather than logging a no-op revision.

export interface InvoiceFieldsSnapshot {
  lineItems: LineItem[];
  discountPct: number;
  vatApplicable: boolean;
  invoiceSubtype: 'initial' | 'final' | null;
}

// 2dp tolerance matches the stored numeric(12,2) precision on the documents
// row. Matches PAID_IN_FULL_TOLERANCE in payment-status.ts for consistency.
const NUMERIC_TOLERANCE = 0.005;

function numericEqual(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  const na = a === null || a === undefined ? null : Number(a);
  const nb = b === null || b === undefined ? null : Number(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) < NUMERIC_TOLERANCE;
}

function stringEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const sa = typeof a === 'string' ? a.trim() : null;
  const sb = typeof b === 'string' ? b.trim() : null;
  if (sa === null && sb === null) return true;
  if (sa === null || sb === null) return false;
  return sa === sb;
}

function lineItemEqual(a: LineItem, b: LineItem): boolean {
  return (
    stringEqual(a.description, b.description) &&
    numericEqual(a.quantity, b.quantity) &&
    numericEqual(a.unitPrice, b.unitPrice) &&
    stringEqual(a.category ?? null, b.category ?? null)
  );
}

function lineItemsEqual(prev: LineItem[], next: LineItem[]): boolean {
  // Order matters — the printed invoice renders line items in the surveyor's
  // chosen order. So we compare positionally, not as a set.
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (!lineItemEqual(prev[i], next[i])) return false;
  }
  return true;
}

export interface DiffResult {
  fieldsChanged: string[];
  hasChanges: boolean;
}

export function diffInvoiceFields(
  prev: InvoiceFieldsSnapshot,
  next: InvoiceFieldsSnapshot,
): DiffResult {
  const changed: string[] = [];

  if (!lineItemsEqual(prev.lineItems, next.lineItems)) changed.push('lineItems');
  if (!numericEqual(prev.discountPct, next.discountPct)) changed.push('discountPct');
  if (prev.vatApplicable !== next.vatApplicable) changed.push('vatApplicable');
  if ((prev.invoiceSubtype ?? null) !== (next.invoiceSubtype ?? null)) {
    changed.push('invoiceSubtype');
  }

  return { fieldsChanged: changed, hasChanges: changed.length > 0 };
}
