'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { reviseInvoice } from '@/actions/documents';
import { calculateTotals, type LineItem } from '@/lib/documents/vat';

// Phase 2 Session 13 — invoice revision dialog. Only available on
// status='sent' invoices (drafts use the standard edit form). The action
// runs a semantic diff and rejects no-op resaves; the surveyor must enter
// a reason that's recorded on each revision_log_payload entry.

type InvoiceSubtype = 'initial' | 'final';

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

export function ReviseInvoiceDialog({
  documentId,
  documentNumber,
  initial,
}: {
  documentId: string;
  documentNumber: string;
  initial: {
    subtype: InvoiceSubtype | null;
    lineItems: LineItem[];
    discountPct: number;
    vatApplicable: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>(
    initial.lineItems.length > 0
      ? initial.lineItems.map(rowFromInit)
      : [blankRow()],
  );
  const [discountPct, setDiscountPct] = useState<number>(initial.discountPct);
  const [vatApplicable, setVatApplicable] = useState<boolean>(initial.vatApplicable);
  const [subtype, setSubtype] = useState<InvoiceSubtype>(
    initial.subtype ?? 'initial',
  );
  const [reason, setReason] = useState<string>('');
  const [isPending, startTransition] = useTransition();

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
    if (reason.trim().length === 0) {
      toast.error('Reason is required.');
      return;
    }

    startTransition(async () => {
      const result = await reviseInvoice({
        documentId,
        subtype,
        lineItems,
        discountPct,
        vatApplicable,
        reason: reason.trim(),
      });
      if ('error' in result) {
        if (result.reason === 'no_changes') {
          toast.error('Nothing was changed — no revision logged.');
        } else if (result.reason === 'no_accepted_quote') {
          toast.error('Changing to Final requires an accepted quote.');
        } else {
          toast.error(`Couldn't revise invoice: ${result.reason ?? result.error}`);
        }
        return;
      }
      toast.success(
        `Invoice ${documentNumber} revised (revision ${result.data.revisionNumber}).`,
      );
      setReason('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Revise invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revise invoice {documentNumber}</DialogTitle>
          <DialogDescription>
            Mutates the sent invoice in place and appends a revision log entry
            with your reason and the amount delta.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="revise-subtype">Invoice type</Label>
              <Select
                value={subtype}
                onValueChange={(v) => setSubtype(v as InvoiceSubtype)}
                disabled={isPending}
              >
                <SelectTrigger id="revise-subtype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="initial">Initial</SelectItem>
                  <SelectItem value="final">Final</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items</Label>
            {rows.map((r) => (
              <div
                key={r.uiKey}
                className="grid grid-cols-12 items-center gap-2 rounded-md border p-2"
              >
                <Input
                  className="col-span-5"
                  placeholder="Description"
                  value={r.description}
                  onChange={(e) =>
                    updateRow(r.uiKey, { description: e.target.value })
                  }
                  disabled={isPending}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  step="any"
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={isPending}
            >
              Add line
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="revise-discount">Discount %</Label>
              <Input
                id="revise-discount"
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
                id="revise-vat"
                type="checkbox"
                checked={vatApplicable}
                onChange={(e) => setVatApplicable(e.target.checked)}
                disabled={isPending}
              />
              <Label htmlFor="revise-vat">Apply VAT (20%)</Label>
            </div>
          </div>

          <div className="rounded-md border p-3 text-sm">
            <div className="flex justify-between font-medium">
              <span>New total</span>
              <span>{formatGBP(totals.total)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="revise-reason">Reason for revision</Label>
            <Textarea
              id="revise-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              placeholder="Scope change agreed with client, additional surveying work, etc."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save revision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
