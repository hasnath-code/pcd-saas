'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { env } from '@/env';
import { pickDestination, resolvePostAuthIdentity } from '@/lib/auth/postAuthResolve';

// Shared schemas. Mirror these on the client side via zodResolver in form components.
const emailPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  next: z.string().optional(),
});

const emailSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  next: z.string().optional(),
});

const passwordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Open-redirect guard: only allow relative paths starting with `/` and not `//`.
function safeNext(input: string | undefined, fallback = '/dashboard'): string {
  if (!input) return fallback;
  if (!input.startsWith('/') || input.startsWith('//')) return fallback;
  return input;
}

// Standard return shape for actions called from forms.
// `redirect()` throws across the wire and never returns a value; callers won't see
// `success: true` from sign-in (Next handles the redirect). They will see `success: true`
// for actions that show an in-page confirmation (e.g. magic link sent).
//
// `reason` is optional. When `error === 'rate_limited'` it carries the
// `retry_after_<n>s` marker so UI can render the wait time.
export type AuthActionResult =
  | { success: true; message?: string }
  | { error: string; reason?: string };

const callbackUrl = (next: string = '/dashboard') =>
  `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`;

// IP+email is the right grain for auth limiting: defeats both single-IP
// spraying and single-email distributed attempts. x-forwarded-for is the
// standard Vercel/Next header; '0.0.0.0' is the dev-fallback.
async function authRateLimitKey(email: string): Promise<string> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '0.0.0.0').split(',')[0]?.trim() ?? '0.0.0.0';
  return `${ip}:${email.toLowerCase()}`;
}

export async function signUp(input: { email: string; password: string; next?: string }): Promise<AuthActionResult> {
  const parsed = emailPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const { limited, retryAfterSec } = await rateLimit('auth', await authRateLimitKey(parsed.data.email));
  if (limited) return { error: 'rate_limited', reason: `retry_after_${retryAfterSec}s` };

  const supabase = await createClient();
  // Default `next` to `/onboarding` so signup confirms naturally route to the
  // wizard. pickDestination then honors `next=/onboarding` only when the user
  // has zero `users` rows (orphan or stakeholder — Sarah Step 2). Anyone with
  // an existing membership is bounced to /dashboard. (DEBT-037)
  const next = safeNext(parsed.data.next, '/onboarding');
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: callbackUrl(next) },
  });

  if (error) return { error: error.message };
  return { success: true, message: 'Check your email to confirm your account.' };
}

export async function signIn(input: { email: string; password: string; next?: string }): Promise<AuthActionResult> {
  const parsed = emailPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const { limited, retryAfterSec } = await rateLimit('auth', await authRateLimitKey(parsed.data.email));
  if (limited) return { error: 'rate_limited', reason: `retry_after_${retryAfterSec}s` };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: error.message };
  // DEBT-037: route through pickDestination so password sign-in shares the
  // same §8 identity-aware routing as the magic-link callback. The post-merge
  // ADR enshrines "all post-auth routing goes through pickDestination."
  if (!data.user) redirect('/login?error=no_session');
  const identity = await resolvePostAuthIdentity(data.user.id, data.user.email ?? '');
  redirect(pickDestination(identity, parsed.data.next ?? null));
}

export async function sendMagicLink(input: { email: string; next?: string }): Promise<AuthActionResult> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid email' };

  const { limited, retryAfterSec } = await rateLimit('auth', await authRateLimitKey(parsed.data.email));
  if (limited) return { error: 'rate_limited', reason: `retry_after_${retryAfterSec}s` };

  const supabase = await createClient();
  const next = safeNext(parsed.data.next);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callbackUrl(next) },
  });

  if (error) return { error: error.message };
  return { success: true, message: 'Magic link sent. Check your email.' };
}

export async function sendPasswordReset(input: { email: string }): Promise<AuthActionResult> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid email' };

  const { limited, retryAfterSec } = await rateLimit('auth', await authRateLimitKey(parsed.data.email));
  if (limited) return { error: 'rate_limited', reason: `retry_after_${retryAfterSec}s` };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl('/reset-password'),
  });

  if (error) return { error: error.message };
  return { success: true, message: 'Password reset link sent. Check your email.' };
}

export async function updatePassword(input: { password: string }): Promise<AuthActionResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid password' };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) return { error: error.message };
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
