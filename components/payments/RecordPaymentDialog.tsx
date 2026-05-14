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
import { recordPayment } from '@/actions/payments';

// Phase 2 Session 13 — record-payment dialog. Client component. The server
// action enforces Zod (amount > 0, multipleOf 0.01); the form rejects locally
// before submit on the same constraints to avoid a roundtrip.

export function RecordPaymentDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  function onSubmit() {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }
    startTransition(async () => {
      const result = await recordPayment({ projectId, amount: numeric });
      if ('error' in result) {
        toast.error(`Couldn't record payment: ${result.reason ?? result.error}`);
        return;
      }
      toast.success('Payment recorded.');
      setAmount('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Enter the amount received. Recorded payments contribute to the
            running total used by the payment-status badge.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="amount">Amount (£)</Label>
          <Input
            id="amount"
            type="number"
            min={0.01}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isPending}
          />
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
            {isPending ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
