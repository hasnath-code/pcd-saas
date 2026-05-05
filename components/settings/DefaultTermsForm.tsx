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
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { updateDefaultTerms } from '@/actions/settings';

const schema = z.object({
  termsAndConditions: z.string().max(10_000),
  footerText: z.string().max(500),
});

type FormValues = z.infer<typeof schema>;

export function DefaultTermsForm({
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
      const result = await updateDefaultTerms(values);
      if ('error' in result) {
        setError(result.reason ?? result.error);
        toast.error(`Couldn't save default terms: ${result.reason ?? result.error}`);
        return;
      }
      toast.success('Default terms saved.');
      form.reset(values);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default terms</CardTitle>
        <CardDescription>
          Appears on every quote and invoice unless overridden per-document.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="termsAndConditions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terms and conditions</FormLabel>
                  <FormControl>
                    <Textarea rows={8} disabled={!canEdit} {...field} />
                  </FormControl>
                  <FormDescription>
                    Plain text. Markdown rendering ships in Phase 2.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="footerText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document footer</FormLabel>
                  <FormControl>
                    <Textarea rows={3} disabled={!canEdit} {...field} />
                  </FormControl>
                  <FormDescription>
                    Optional. Shown at the bottom of every PDF.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              disabled={!canEdit || isPending || !form.formState.isDirty}
            >
              {isPending ? 'Saving…' : 'Save default terms'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
