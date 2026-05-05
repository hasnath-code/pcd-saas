import type { OrgAdminContext, OrgUserContext } from '@/lib/auth/requireAuth';
import type { User } from '@supabase/supabase-js';
import type { TwoOrgUser } from '../fixtures/two-orgs';

// Build the auth-helper return shapes from a fixture user. Action tests don't
// actually sign in (no cookies in vitest); instead they vi.mock() requireAuth
// helpers and feed them these objects. Keeps the per-test setup terse and
// makes the contract between test and action explicit.

export function asAuthUser(user: TwoOrgUser): User {
  // Minimal User shape — actions only read .id and .email.
  return {
    id: user.authUserId,
    email: user.email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date(0).toISOString(),
  } as unknown as User;
}

export function asOrgUserContext(
  user: TwoOrgUser,
  orgId: string,
  role: OrgUserContext['role'],
): OrgUserContext {
  return {
    authUserId: user.authUserId,
    userId: user.userId,
    orgId,
    role,
  };
}

export function asOrgAdminContext(
  user: TwoOrgUser,
  orgId: string,
  role: OrgAdminContext['role'],
): OrgAdminContext {
  return {
    authUserId: user.authUserId,
    userId: user.userId,
    orgId,
    role,
  };
}
