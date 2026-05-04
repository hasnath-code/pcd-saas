'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { sendMagicLink } from '@/actions/auth';

const schema = z.object({ email: z.string().email() });

export default function MagicLinkPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await sendMagicLink(values);
      if ('error' in result) setError(result.error);
      else setSuccess(result.message ?? 'Magic link sent.');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in with magic link</CardTitle>
        <CardDescription>
          We&apos;ll email you a one-time link to sign in. No password needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <Button type="submit" className="w-full" disabled={isPending || !!success}>
              {isPending ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        </Form>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
