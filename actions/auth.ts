'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/env';

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
export type AuthActionResult =
  | { success: true; message?: string }
  | { error: string };

const callbackUrl = (next: string = '/dashboard') =>
  `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signUp(input: { email: string; password: string; next?: string }): Promise<AuthActionResult> {
  const parsed = emailPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const supabase = await createClient();
  const next = safeNext(parsed.data.next);
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: error.message };
  redirect(safeNext(parsed.data.next));
}

export async function sendMagicLink(input: { email: string; next?: string }): Promise<AuthActionResult> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid email' };

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
