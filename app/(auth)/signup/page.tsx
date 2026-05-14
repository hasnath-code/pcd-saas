'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { signUp } from '@/actions/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default function SignupPage() {
  return (
    <Suspense fallback={<Card><CardHeader><CardTitle>Create account</CardTitle></CardHeader></Card>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();
  const invitationToken = searchParams.get('invitation');
  const next = invitationToken ? `/invitations/${invitationToken}/accept` : undefined;

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Invitation flow: Supabase auto-confirms the email on signUp, so the user
  // is already signed in by the time the action returns. Push them to the
  // accept route (which then redirects into the portal). 500 ms lets the
  // confirmation copy render before navigation.
  useEffect(() => {
    if (!redirectingTo) return;
    const timer = setTimeout(() => router.push(redirectingTo), 500);
    return () => clearTimeout(timer);
  }, [redirectingTo, router]);

  function onSubmit(values: z.infer<typeof schema>) {
    setError(null);
    setSuccess(null);
    setRedirectingTo(null);
    startTransition(async () => {
      const result = await signUp({ ...values, next });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if (invitationToken && next) {
        setRedirectingTo(next);
      } else {
        setSuccess(result.message ?? 'Check your email.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>
          {invitationToken
            ? "You'll be signed in and added to the project automatically."
            : "We'll send a confirmation email. Click the link to finish signing up."}
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
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            {redirectingTo && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                <p>Welcome — you&apos;re signed in. Redirecting to your portal&hellip;</p>
                <Link href={redirectingTo} className="mt-1 inline-block underline">
                  Continue to portal
                </Link>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isPending || !!success || !!redirectingTo}>
              {isPending ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </Form>
        <p className="mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link
            href={
              invitationToken
                ? `/login?invitation=${encodeURIComponent(invitationToken)}`
                : '/login'
            }
            className="underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
