'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { acceptQuote } from '@/actions/documents';

// Phase 2 — accept-form for the public /q/[token] page. ADR-034 client side.
// The action does the auth-free token resolution + idempotency; we just
// collect the typed name and show a confirmation.

export function AcceptQuoteForm({
  token,
  quoteNumber,
}: {
  token: string;
  quoteNumber: string;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();

  function onSubmit() {
    if (!name.trim()) {
      toast.error('Please enter your name.');
      return;
    }
    startTransition(async () => {
      const result = await acceptQuote({ token, acceptedByName: name.trim() });
      if ('error' in result) {
        toast.error(`Couldn't accept: ${result.reason ?? result.error}`);
        return;
      }
      if (result.data.alreadyAccepted) {
        toast.info('This quote was already accepted.');
      } else {
        toast.success(`Quote ${quoteNumber} accepted.`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="acceptedByName">Your name</Label>
        <Input
          id="acceptedByName"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          maxLength={200}
        />
      </div>
      <Button onClick={onSubmit} disabled={isPending}>
        {isPending ? 'Accepting…' : 'Accept quote'}
      </Button>
    </div>
  );
}
