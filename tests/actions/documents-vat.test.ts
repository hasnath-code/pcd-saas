import { describe, expect, test } from 'vitest';
import { calculateTotals } from '@/lib/documents/vat';

// Pure unit tests for the VAT/discount/total calculator. Verifies the
// rounding cascade (per-line → discount → VAT) lands on exact 2dp values
// for the edge cases that matter for client-facing quotes.

describe('calculateTotals', () => {
  test('single line, no discount, no VAT', () => {
    const t = calculateTotals({
      lineItems: [{ description: 'Survey', quantity: 1, unitPrice: 500 }],
      discountPct: 0,
      vatApplicable: false,
    });
    expect(t).toEqual({
      subtotal: 500,
      discountAmount: 0,
      vatAmount: 0,
      total: 500,
    });
  });

  test('multi-line sum + VAT on', () => {
    const t = calculateTotals({
      lineItems: [
        { description: 'A', quantity: 2, unitPrice: 100 },
        { description: 'B', quantity: 1, unitPrice: 50 },
      ],
      discountPct: 0,
      vatApplicable: true,
    });
    // subtotal = 250; vat = 50; total = 300
    expect(t.subtotal).toBe(250);
    expect(t.vatAmount).toBe(50);
    expect(t.total).toBe(300);
  });

  test('discount applied before VAT', () => {
    const t = calculateTotals({
      lineItems: [{ description: 'A', quantity: 1, unitPrice: 100 }],
      discountPct: 20,
      vatApplicable: true,
    });
    // subtotal = 100; discount = 20; discounted = 80; vat = 16; total = 96
    expect(t.subtotal).toBe(100);
    expect(t.discountAmount).toBe(20);
    expect(t.vatAmount).toBe(16);
    expect(t.total).toBe(96);
  });

  test('100% discount → total 0', () => {
    const t = calculateTotals({
      lineItems: [{ description: 'A', quantity: 1, unitPrice: 123.45 }],
      discountPct: 100,
      vatApplicable: true,
    });
    expect(t.subtotal).toBe(123.45);
    expect(t.discountAmount).toBe(123.45);
    expect(t.vatAmount).toBe(0);
    expect(t.total).toBe(0);
  });

  test('0% discount + VAT off', () => {
    const t = calculateTotals({
      lineItems: [{ description: 'A', quantity: 3, unitPrice: 10.99 }],
      discountPct: 0,
      vatApplicable: false,
    });
    expect(t.subtotal).toBe(32.97);
    expect(t.vatAmount).toBe(0);
    expect(t.total).toBe(32.97);
  });

  test('per-line rounding keeps each line on a penny boundary', () => {
    // qty=3, unitPrice=10.33 → 30.99 (no rounding ambiguity). Pick a price
    // that float-multiplies awkwardly: 0.1 + 0.2 type.
    const t = calculateTotals({
      lineItems: [
        { description: 'A', quantity: 3, unitPrice: 0.1 },
        { description: 'B', quantity: 1, unitPrice: 0.2 },
      ],
      discountPct: 0,
      vatApplicable: false,
    });
    // Per-line: 3 * 0.10 = 0.30; 1 * 0.20 = 0.20. Subtotal = 0.50.
    // Without integer-pennies math 0.1 + 0.1 + 0.1 + 0.2 = 0.5 in JS but
    // accumulated 0.30000000000000004 if done line-by-line — the helper
    // rounds at unit*qty so we get exact 0.30 then exact 0.50.
    expect(t.subtotal).toBe(0.5);
    expect(t.total).toBe(0.5);
  });

  test('VAT computed on discounted subtotal, not pre-discount', () => {
    const t = calculateTotals({
      lineItems: [{ description: 'A', quantity: 1, unitPrice: 200 }],
      discountPct: 50,
      vatApplicable: true,
    });
    // subtotal = 200; discount = 100; discounted = 100; vat = 20; total = 120
    expect(t.discountAmount).toBe(100);
    expect(t.vatAmount).toBe(20);
    expect(t.total).toBe(120);
  });

  test('odd-penny discount rounds correctly', () => {
    // subtotal = 99.99, discount 33% → 32.9967 → rounds to 33.00
    const t = calculateTotals({
      lineItems: [{ description: 'A', quantity: 1, unitPrice: 99.99 }],
      discountPct: 33,
      vatApplicable: false,
    });
    expect(t.subtotal).toBe(99.99);
    expect(t.discountAmount).toBe(33);
    expect(t.total).toBe(66.99);
  });

  test('zero quantity line contributes nothing', () => {
    const t = calculateTotals({
      lineItems: [
        { description: 'A', quantity: 0, unitPrice: 999 },
        { description: 'B', quantity: 1, unitPrice: 10 },
      ],
      discountPct: 0,
      vatApplicable: false,
    });
    expect(t.subtotal).toBe(10);
    expect(t.total).toBe(10);
  });
});
