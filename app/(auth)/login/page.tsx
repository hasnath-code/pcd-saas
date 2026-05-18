'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { signIn } from '@/actions/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default function LoginPage() {
  return (
    <Suspense fallback={<Card><CardHeader><CardTitle>Sign in</CardTitle></CardHeader></Card>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const invitationToken = searchParams.get('invitation');
  const explicitNext = searchParams.get('next');
  const next = invitationToken
    ? `/invitations/${invitationToken}/accept`
    : explicitNext ?? undefined;

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    setError(null);
    startTransition(async () => {
      const result = await signIn({ ...values, next });
      // Successful sign-in redirects via next/navigation; only error path returns.
      if (result && 'error' in result) setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your email and password to continue.</CardDescription>
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
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <div className="space-y-1.5">
                <p className="text-sm text-destructive">{error}</p>
                {/* DEBT-063: a first-time invitee who picked Sign in has no
                    account yet — surface a recovery path to Sign up, but only
                    in the invitation flow (?invitation= present) so a plain
                    mistyped-password sign-in isn't pushed toward signup. */}
                {invitationToken && (
                  <p className="text-sm text-muted-foreground">
                    No PCD account yet?{' '}
                    <Link
                      href={`/signup?invitation=${encodeURIComponent(invitationToken)}`}
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      Sign up →
                    </Link>
                  </p>
                )}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Form>
        <div className="mt-4 space-y-2 text-center text-sm">
          <p>
            <Link href="/magic-link" className="underline">
              Sign in with a magic link
            </Link>
          </p>
          <p>
            <Link href="/forgot-password" className="underline">
              Forgot your password?
            </Link>
          </p>
          <p>
            No account?{' '}
            <Link
              href={
                invitationToken
                  ? `/signup?invitation=${encodeURIComponent(invitationToken)}`
                  : '/signup'
              }
              className="underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
