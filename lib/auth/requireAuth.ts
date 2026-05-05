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
  | 'internal_error'
  // Adjustment 2 (Phase 1a Session 3 plan): acceptInvitation surfaces this
  // when the auth user already has a `users` row in another org. Multi-org
  // membership is queued for Session 5 (context switcher).
  | 'multi_org_not_yet_supported'
  // Session 4: rate limiter tripped. `reason` carries `retry_after_<n>s`.
  | 'rate_limited';

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
// Org / stakeholder context resolution. Each helper returns the calling user's
// active context or throws AuthError. Use as the first line of every server
// action (per ARCHITECTURE-saas.md §20).
//
// The session-bound supabase client is used so RLS evaluates auth.uid() — the
// SELECT on `users` flows through the users_select_org_members policy, which
// in turn calls is_org_member() (SECURITY DEFINER) to avoid recursion.

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

// Return the calling user's single org membership, or throw.
//
// Phase 1a: a user with multiple `users` rows is unsupported — Session 3 will
// implement the context switcher (set active_org via session) and update this
// helper to read that session field. For now, multi-org is an explicit error.
export async function requireOrgUser(): Promise<OrgUserContext> {
  const authUser = await requireAuth();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('users')
    .select('id, org_id, role')
    .eq('auth_user_id', authUser.id)
    .is('deleted_at', null);

  if (error) {
    throw new AuthError('internal_error', `requireOrgUser: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new AuthError('not_authorized', 'no_org_membership');
  }
  if (data.length > 1) {
    // Session 3 will resolve via active_org_id in session. Until then, fail loud.
    throw new AuthError('not_authorized', 'multi_org_unsupported_until_session_3');
  }

  const row = data[0];
  const role = row.role as OrgUserContext['role'];
  if (role !== 'owner' && role !== 'admin' && role !== 'member') {
    throw new AuthError('internal_error', `requireOrgUser: unexpected role '${row.role}'`);
  }
  return {
    authUserId: authUser.id,
    userId: row.id,
    orgId: row.org_id,
    role,
  };
}

// Same as requireOrgUser but throws 'not_authorized' if role is 'member'.
export async function requireOrgAdmin(): Promise<OrgAdminContext> {
  const ctx = await requireOrgUser();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    throw new AuthError('not_authorized', 'org_admin_required');
  }
  return {
    authUserId: ctx.authUserId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    role: ctx.role,
  };
}

// STUB. The `clients` table ships in Phase 1b Session 6; until then there is
// no stakeholder identity to resolve. Wired here so server actions in 1a can
// reference the symbol; calling it always throws.
export async function requireStakeholder(): Promise<StakeholderContext> {
  await requireAuth();
  throw new AuthError(
    'internal_error',
    'requireStakeholder: ships in Phase 1b Session 6 (clients table)',
  );
}
