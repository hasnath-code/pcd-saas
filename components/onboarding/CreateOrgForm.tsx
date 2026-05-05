'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Button } from '@/components/ui/button';
import { createOrganization } from '@/actions/orgs';

// TODO(Phase 6 billing): expose plan upgrade UI here. See ARCHITECTURE-saas.md
// §31 Phase 6 row. Phase 1a defaults every new org to `solo_free`.

const schema = z.object({
  ownerName: z.string().trim().min(1, 'Your name is required').max(120),
  name: z.string().trim().min(1, 'Firm name is required').max(120),
});

type FormValues = z.infer<typeof schema>;

export function CreateOrgForm({
  orgTypeSlug,
  title,
  subtitle,
}: {
  orgTypeSlug: 'surveyor' | 'architect';
  title: string;
  subtitle: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ownerName: '', name: '' },
  });

  function onSubmit(values: FormValues) {
    setError(null);
    startTransition(async () => {
      const result = await createOrganization({
        orgTypeSlug,
        ownerName: values.ownerName,
        name: values.name,
      });
      if ('error' in result) {
        setError(result.reason ?? result.error);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="ownerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your name</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="name"
                      placeholder="Jane Doe"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    How your team will see you in the app.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Firm name</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="organization"
                      placeholder="Acme Architecture Ltd"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Creating firm…' : 'Create firm'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
