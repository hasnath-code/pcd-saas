import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
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

// DEBT-025: attach the authenticated user to the current Sentry isolation
// scope so any error captured later in this request carries user attribution.
// Sentry SDK calls are safe no-ops when the SDK isn't initialised (e.g. the
// vitest env). Called from every server-side auth entry point.
function applySentryUser(user: User): void {
  Sentry.setUser({ id: user.id, email: user.email });
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
  applySentryUser(user);
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
  applySentryUser(user);
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
  // DEBT-025: surfaced so the portal layout can pass it to the client-side
  // Sentry scope. Optional — Supabase User.email is `string | undefined`.
  email?: string;
}

// Return the calling user's active org membership, or throw.
//
// Resolution order (Session 5 multi-org switcher):
//   1. Single membership → use it (cookie ignored). Don't auto-set the cookie
//      for single-membership users; only `switchActiveOrg` writes it.
//   2. Multiple memberships + cookie matches one → use that one.
//   3. Multiple memberships + cookie missing or invalid (e.g. user was removed
//      from that org since last switch) → fall back to data[0] AND attempt to
//      delete the stale cookie. cookies().delete() throws in read-only RSC
//      context — wrapped in try/catch; stale cookie self-corrects on next
//      mutation request.
//   4. Zero memberships → throw not_authorized (caller redirects to onboarding).
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

  let chosen = data[0];

  if (data.length > 1) {
    const cookieStore = await cookies();
    const activeOrgId = cookieStore.get('active_org_id')?.value;
    if (activeOrgId) {
      const match = data.find((row) => row.org_id === activeOrgId);
      if (match) {
        chosen = match;
      } else {
        // Stale cookie — attempt cleanup. RSC context throws on .delete();
        // catch silently and let it self-correct on next mutation request.
        try {
          cookieStore.delete('active_org_id');
        } catch {
          // expected in read-only contexts
        }
      }
    }
  }

  const role = chosen.role as OrgUserContext['role'];
  if (role !== 'owner' && role !== 'admin' && role !== 'member') {
    throw new AuthError('internal_error', `requireOrgUser: unexpected role '${chosen.role}'`);
  }
  // DEBT-025: org + participant tags on the Sentry scope. requireAuth (called
  // at the top of this function) has already set the user. requireOrgAdmin
  // funnels through requireOrgUser, so the tags are set exactly once per
  // request — no duplication from the admin call chain.
  Sentry.setTag('org_id', chosen.org_id);
  Sentry.setTag('participant_type', 'user');
  return {
    authUserId: authUser.id,
    userId: chosen.id,
    orgId: chosen.org_id,
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

// Resolve the calling user's stakeholder identity. Returns the (authUserId,
// clientId) tuple where clientId is the public.clients row whose auth_user_id
// matches auth.uid(). Throws AuthError('not_authorized', 'no_stakeholder_identity')
// if the auth user has no clients row (e.g. an org user who landed in /portal
// by mistake, or a stakeholder whose acceptance was reversed).
//
// Single-clients-row guarantee: clients.email is GLOBALLY UNIQUE and a single
// auth.users row maps to at most one clients row (auth_user_id is set during
// acceptStakeholderInvitation). No multi-stakeholder-identity picker needed.
//
// RLS: the SELECT on `clients` flows through clients_select_self_or_org_member
// policy; the auth_user_id = auth.uid() branch matches our own row.
export async function requireStakeholder(): Promise<StakeholderContext> {
  const authUser = await requireAuth();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .eq('auth_user_id', authUser.id)
    .is('deleted_at', null)
    .limit(1);
  if (error) throw new AuthError('internal_error', `requireStakeholder: ${error.message}`);
  if (!data || data.length === 0) {
    throw new AuthError('not_authorized', 'no_stakeholder_identity');
  }
  // DEBT-025: participant tag on the Sentry scope. requireAuth (above) set the
  // user; stakeholders have no org at this layer, so no org_id tag here.
  Sentry.setTag('participant_type', 'client');
  return { authUserId: authUser.id, clientId: data[0].id, email: authUser.email };
}
