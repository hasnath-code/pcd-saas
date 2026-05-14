import 'server-only';

// Phase 2 §2.8 — port of V2's `calculateTotals`. VAT is 20% on the discounted
// subtotal; suppressed when `vatApplicable=false`. All money math runs in
// integer pennies to avoid JS float drift, rounding at each step so each
// stored / displayed number is an exact 2dp value:
//
//   1. Each line:  linePennies = round(unitPrice * 100) * quantity   (per-line round)
//   2. Subtotal:   sum of line pennies                              (sum of ints — exact)
//   3. Discount:   discountPennies = round(subtotal * discountPct / 100)
//   4. VAT:        vatPennies = vatApplicable ? round((subtotal - discount) * 0.20) : 0
//   5. Total:      subtotal - discount + VAT
//
// Stored on the document row: `subtotal` (pre-discount line sum), `vat_amount`,
// `total`. Discount amount is DERIVED on read from `discount_pct` + `subtotal`
// — exact reconstruction, no need to store separately.

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  category?: string;
}

export interface TotalsInput {
  lineItems: LineItem[];
  /** Percentage 0–100. */
  discountPct: number;
  vatApplicable: boolean;
}

export interface TotalsOutput {
  /** Pre-discount, pre-VAT sum of line totals. 2dp. */
  subtotal: number;
  /** Derived from subtotal + discountPct. 2dp. */
  discountAmount: number;
  /** Stored on the document row. 0 when vatApplicable=false. 2dp. */
  vatAmount: number;
  /** subtotal - discountAmount + vatAmount. 2dp. */
  total: number;
}

const VAT_RATE = 0.2;

function poundsToPennies(amount: number): number {
  // Round to the nearest penny so float inputs like 9.99 don't become 998 or
  // 999 from binary float reps. Math.round handles negative inputs symmetrically
  // (banker's rounding NOT used — V2 used straight round, port matches).
  return Math.round(amount * 100);
}

function penniesToPounds(pennies: number): number {
  return pennies / 100;
}

export function calculateTotals(input: TotalsInput): TotalsOutput {
  const { lineItems, discountPct, vatApplicable } = input;

  // 1. Per-line round.
  let subtotalPennies = 0;
  for (const item of lineItems) {
    // qty is a count, unitPrice is money. Round the per-unit first, then
    // multiply by qty as an integer — this matches the user-visible "line
    // total" on the printed quote.
    const unitPricePennies = poundsToPennies(item.unitPrice);
    const linePennies = Math.round(unitPricePennies * item.quantity);
    subtotalPennies += linePennies;
  }

  // 2. Discount round.
  const discountAmountPennies = Math.round((subtotalPennies * discountPct) / 100);
  const discountedSubtotalPennies = subtotalPennies - discountAmountPennies;

  // 3. VAT round.
  const vatPennies = vatApplicable
    ? Math.round(discountedSubtotalPennies * VAT_RATE)
    : 0;

  const totalPennies = discountedSubtotalPennies + vatPennies;

  return {
    subtotal: penniesToPounds(subtotalPennies),
    discountAmount: penniesToPounds(discountAmountPennies),
    vatAmount: penniesToPounds(vatPennies),
    total: penniesToPounds(totalPennies),
  };
}
