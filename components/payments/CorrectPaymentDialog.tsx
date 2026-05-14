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
import { correctPayment } from '@/actions/payments';

// Phase 2 Session 13 — correct-payment dialog. Reason field is mandatory;
// the action's Zod schema rejects an empty / whitespace-only reason.

export function CorrectPaymentDialog({
  paymentId,
  currentAmount,
}: {
  paymentId: string;
  currentAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(String(currentAmount));
  const [reason, setReason] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  function onSubmit() {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }
    if (reason.trim().length === 0) {
      toast.error('Reason is required.');
      return;
    }
    startTransition(async () => {
      const result = await correctPayment({
        paymentId,
        newAmount: numeric,
        reason: reason.trim(),
      });
      if ('error' in result) {
        toast.error(`Couldn't correct payment: ${result.reason ?? result.error}`);
        return;
      }
      toast.success('Payment corrected.');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Correct
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct recorded payment</DialogTitle>
          <DialogDescription>
            Mutates the recorded amount in place and keeps an audit trail.
            Use when the original amount was entered incorrectly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="newAmount">New amount (£)</Label>
            <Input
              id="newAmount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              placeholder="Typo in original amount, bank fee adjustment, etc."
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
            {isPending ? 'Saving…' : 'Save correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
