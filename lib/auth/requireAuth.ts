import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Server-action error codes (ARCHITECTURE-saas.md §20). Server actions return
// { error: <code> } objects rather than throwing across the wire; the helpers below
// throw AuthError with one of these codes, which the action wrapper translates.
export type ServerActionErrorCode =
  | 'not_authenticated'
  | 'not_authorized'
  | 'not_found'
  | 'validation_error'
  | 'feature_gated'
  | 'quota_exceeded'
  | 'conflict'
  | 'internal_error';

export class AuthError extends Error {
  constructor(
    public readonly code: ServerActionErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AuthError';
  }
}

// Phase 1a: working. Returns the auth.users row for the current session,
// or throws AuthError('not_authenticated'). Use in server actions and route handlers.
export async function requireAuth(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new AuthError('not_authenticated');
  return user;
}

// Same as requireAuth() but redirects to /login instead of throwing.
// Use in Server Components / page.tsx where structured errors don't apply.
export async function requireAuthOrRedirect(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session 2 stubs. These reference users / clients / project_stakeholders tables
// which don't exist until Session 2. Throwing now (rather than returning fake data)
// makes accidental Phase-1a usage loud. Wired here so Session 2 only fills bodies,
// no caller refactoring needed.

export interface OrgUserContext {
  authUserId: string;
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
}

export interface OrgAdminContext {
  authUserId: string;
  userId: string;
  orgId: string;
  role: 'owner' | 'admin';
}

export interface StakeholderContext {
  authUserId: string;
  clientId: string;
}

export async function requireOrgUser(): Promise<OrgUserContext> {
  await requireAuth();
  throw new AuthError(
    'internal_error',
    'requireOrgUser: not implemented — domain tables ship in Session 2',
  );
}

export async function requireOrgAdmin(): Promise<OrgAdminContext> {
  await requireAuth();
  throw new AuthError(
    'internal_error',
    'requireOrgAdmin: not implemented — domain tables ship in Session 2',
  );
}

export async function requireStakeholder(): Promise<StakeholderContext> {
  await requireAuth();
  throw new AuthError(
    'internal_error',
    'requireStakeholder: not implemented — domain tables ship in Session 2',
  );
}
