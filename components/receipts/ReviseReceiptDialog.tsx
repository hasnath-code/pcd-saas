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
import { reviseReceipt } from '@/actions/documents';

// Phase 2 Session 14 — receipt revision dialog. Narrower than
// ReviseInvoiceDialog: receipts have one mutable field (recipient_name).
// Money values mirror the linked payment in lockstep — correctPayment is
// the canonical path for changing an amount, so this dialog deliberately
// doesn't expose line items / totals.
//
// Reason field required + non-empty (mirrors reviseInvoice). Diff is
// trivial: prev/new recipient_name; no-op resave returns
// conflict/no_changes from the action.

export function ReviseReceiptDialog({
  documentId,
  documentNumber,
  initialRecipientName,
}: {
  documentId: string;
  documentNumber: string;
  initialRecipientName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recipientName, setRecipientName] = useState(initialRecipientName ?? '');
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();

  function onSubmit() {
    if (recipientName.trim().length === 0) {
      toast.error('Recipient name is required.');
      return;
    }
    if (reason.trim().length === 0) {
      toast.error('Reason is required.');
      return;
    }
    startTransition(async () => {
      const result = await reviseReceipt({
        documentId,
        recipientName: recipientName.trim(),
        reason: reason.trim(),
      });
      if ('error' in result) {
        if (result.reason === 'no_changes') {
          toast.error('Recipient is unchanged — no revision logged.');
        } else {
          toast.error(`Couldn't revise receipt: ${result.reason ?? result.error}`);
        }
        return;
      }
      toast.success(
        `Receipt ${documentNumber} revised (revision ${result.data.revisionNumber}).`,
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
          Revise recipient
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revise receipt {documentNumber}</DialogTitle>
          <DialogDescription>
            Updates the recipient label on this receipt and appends a revision
            log entry. Money values are unchanged (correctPayment is the path
            for adjusting the recorded amount).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="receipt-recipient">Recipient name</Label>
            <Input
              id="receipt-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              disabled={isPending}
              placeholder="Person or company the receipt is addressed to"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="receipt-reason">Reason for revision</Label>
            <Textarea
              id="receipt-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              placeholder="Recipient name correction, etc."
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
