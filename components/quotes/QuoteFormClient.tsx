'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createQuote, updateQuoteDraft } from '@/actions/documents';
import { calculateTotals, type LineItem } from '@/lib/documents/vat';

// Phase 2 — quote create/edit form. Used by /quotes/new (mode='create') and
// the draft view at /quotes/[quoteId] (mode='edit'). Server actions enforce
// the schema; this form is the lightweight surveyor-facing input layer.

type Mode =
  | { kind: 'create'; projectId: string }
  | {
      kind: 'edit';
      projectId: string;
      documentId: string;
      initial: {
        lineItems: LineItem[];
        discountPct: number;
        vatApplicable: boolean;
      };
    };

type DraftRow = LineItem & { uiKey: string };

function rowFromInit(item: LineItem): DraftRow {
  return { ...item, uiKey: Math.random().toString(36).slice(2) };
}

function blankRow(): DraftRow {
  return {
    description: '',
    quantity: 1,
    unitPrice: 0,
    uiKey: Math.random().toString(36).slice(2),
  };
}

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export function QuoteFormClient(props: { mode: Mode }) {
  const { mode } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialRows: DraftRow[] =
    mode.kind === 'edit' && mode.initial.lineItems.length > 0
      ? mode.initial.lineItems.map(rowFromInit)
      : [blankRow()];

  const [rows, setRows] = useState<DraftRow[]>(initialRows);
  const [discountPct, setDiscountPct] = useState<number>(
    mode.kind === 'edit' ? mode.initial.discountPct : 0,
  );
  const [vatApplicable, setVatApplicable] = useState<boolean>(
    mode.kind === 'edit' ? mode.initial.vatApplicable : false,
  );

  const totals = calculateTotals({
    lineItems: rows.map((r) => ({
      description: r.description,
      quantity: Number(r.quantity) || 0,
      unitPrice: Number(r.unitPrice) || 0,
      category: r.category,
    })),
    discountPct,
    vatApplicable,
  });

  function updateRow(uiKey: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.uiKey === uiKey ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function removeRow(uiKey: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.uiKey !== uiKey) : rs));
  }

  function onSubmit() {
    const lineItems: LineItem[] = rows
      .map((r) => ({
        description: r.description.trim(),
        quantity: Number(r.quantity) || 0,
        unitPrice: Number(r.unitPrice) || 0,
        category: r.category?.trim() || undefined,
      }))
      .filter((r) => r.description.length > 0);

    if (lineItems.length === 0) {
      toast.error('Add at least one line item.');
      return;
    }

    startTransition(async () => {
      if (mode.kind === 'create') {
        const result = await createQuote({
          projectId: mode.projectId,
          lineItems,
          discountPct,
          vatApplicable,
        });
        if ('error' in result) {
          toast.error(`Couldn't create quote: ${result.reason ?? result.error}`);
          return;
        }
        toast.success(`Quote ${result.data.documentNumber} created.`);
        router.push(
          `/dashboard/projects/${mode.projectId}/quotes/${result.data.documentId}`,
        );
      } else {
        const result = await updateQuoteDraft({
          documentId: mode.documentId,
          lineItems,
          discountPct,
          vatApplicable,
        });
        if ('error' in result) {
          toast.error(`Couldn't update quote: ${result.reason ?? result.error}`);
          return;
        }
        toast.success('Quote updated.');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Line items</Label>
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.uiKey}
              className="grid grid-cols-12 items-center gap-2 rounded-md border p-2"
            >
              <Input
                className="col-span-5"
                placeholder="Description"
                value={r.description}
                onChange={(e) => updateRow(r.uiKey, { description: e.target.value })}
                disabled={isPending}
              />
              <Input
                className="col-span-2"
                type="number"
                min={0}
                step="any"
                placeholder="Qty"
                value={r.quantity}
                onChange={(e) =>
                  updateRow(r.uiKey, { quantity: Number(e.target.value) })
                }
                disabled={isPending}
              />
              <Input
                className="col-span-3"
                type="number"
                min={0}
                step="0.01"
                placeholder="Unit price (£)"
                value={r.unitPrice}
                onChange={(e) =>
                  updateRow(r.uiKey, { unitPrice: Number(e.target.value) })
                }
                disabled={isPending}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-2"
                onClick={() => removeRow(r.uiKey)}
                disabled={isPending || rows.length <= 1}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={isPending}>
          Add line
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="discountPct">Discount %</Label>
          <Input
            id="discountPct"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={discountPct}
            onChange={(e) => setDiscountPct(Number(e.target.value))}
            disabled={isPending}
          />
        </div>
        <div className="flex items-end gap-2">
          <input
            id="vatApplicable"
            type="checkbox"
            checked={vatApplicable}
            onChange={(e) => setVatApplicable(e.target.checked)}
            disabled={isPending}
          />
          <Label htmlFor="vatApplicable">Apply VAT (20%)</Label>
        </div>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatGBP(totals.subtotal)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount ({discountPct}%)</span>
            <span>−{formatGBP(totals.discountAmount)}</span>
          </div>
        )}
        {vatApplicable && (
          <div className="flex justify-between text-muted-foreground">
            <span>VAT (20%)</span>
            <span>{formatGBP(totals.vatAmount)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t pt-2 font-medium">
          <span>Total</span>
          <span>{formatGBP(totals.total)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="button" onClick={onSubmit} disabled={isPending}>
          {isPending
            ? 'Saving…'
            : mode.kind === 'create'
              ? 'Create quote'
              : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
