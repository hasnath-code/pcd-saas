'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { updatePassword } from '@/actions/auth';

// User arrives here from the password-reset email after /auth/callback exchanges the
// recovery code for a session. The Supabase session set by the callback authorizes
// updateUser({ password }) — no token needed in this page.
const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    setError(null);
    startTransition(async () => {
      const result = await updatePassword(values);
      // Success redirects to /dashboard (server action). Error stays on this page.
      if (result && 'error' in result) setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>
          Choose a password of at least 8 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save password'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
