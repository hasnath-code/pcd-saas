'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { updateBankDetails } from '@/actions/settings';

const schema = z.object({
  accountName: z.string().max(120),
  accountNumber: z
    .string()
    .max(20)
    .refine(
      (v) => v.trim() === '' || /^\d{6,12}$/.test(v.replace(/\s+/g, '')),
      'Account number must be 6–12 digits',
    ),
  sortCode: z
    .string()
    .max(10)
    .refine(
      (v) =>
        v.trim() === '' || /^\d{2}-?\d{2}-?\d{2}$/.test(v.replace(/\s+/g, '')),
      'Sort code must be 6 digits, optionally split as 12-34-56',
    ),
});

type FormValues = z.infer<typeof schema>;

export function BankDetailsForm({
  initial,
  canEdit,
}: {
  initial: FormValues;
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });

  function onSubmit(values: FormValues) {
    setError(null);
    startTransition(async () => {
      const result = await updateBankDetails(values);
      if ('error' in result) {
        setError(result.reason ?? result.error);
        toast.error(`Couldn't save bank details: ${result.reason ?? result.error}`);
        return;
      }
      toast.success('Bank details saved.');
      form.reset(values);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank details</CardTitle>
        <CardDescription>
          Shown on invoices for client bank transfers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Acme Architecture Ltd"
                      disabled={!canEdit}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accountNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account number</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="12345678"
                      disabled={!canEdit}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort code</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="12-34-56"
                      disabled={!canEdit}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              disabled={!canEdit || isPending || !form.formState.isDirty}
            >
              {isPending ? 'Saving…' : 'Save bank details'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
