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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { updateCompanyDetails } from '@/actions/settings';

const schema = z.object({
  name: z.string().max(120),
  address: z.string().max(500),
  vatNumber: z.string().max(20),
  companyNumber: z.string().max(20),
});

type FormValues = z.infer<typeof schema>;

export function CompanyDetailsForm({
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
      const result = await updateCompanyDetails(values);
      if ('error' in result) {
        setError(result.reason ?? result.error);
        toast.error(`Couldn't save company details: ${result.reason ?? result.error}`);
        return;
      }
      toast.success('Company details saved.');
      form.reset(values);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company details</CardTitle>
        <CardDescription>
          Shown on quotes, invoices, and document headers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Trading name</FormLabel>
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
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Registered address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={'10 Downing Street\nLondon SW1A 2AA\nUnited Kingdom'}
                      rows={4}
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
              name="vatNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>VAT number</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="GB123456789"
                      disabled={!canEdit}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Optional. Leave blank if not VAT-registered.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="companyNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Companies House number</FormLabel>
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              disabled={!canEdit || isPending || !form.formState.isDirty}
            >
              {isPending ? 'Saving…' : 'Save company details'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
