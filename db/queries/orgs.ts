import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { organizations, users } from '@/db/schema';

export type MyOrgInfo = {
  userId: string;
  userName: string;
  orgId: string;
  orgName: string;
  role: 'owner' | 'admin' | 'member';
};

// Returns the auth user's first org membership (joined with the org row), or
// null if no `users` row exists yet for this auth_user_id (pre-onboarding).
//
// For multi-org users, callers should prefer `requireOrgUser()` (cookie-aware
// active-org resolution). This helper is convenient for Server Components
// that just need ONE membership for header rendering before the cookie path
// resolves.
export async function getMyOrg(authUserId: string): Promise<MyOrgInfo | null> {
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      role: users.role,
      orgId: organizations.id,
      orgName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(users.orgId, organizations.id))
    .where(
      and(
        eq(users.authUserId, authUserId),
        isNull(users.deletedAt),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.role !== 'owner' && row.role !== 'admin' && row.role !== 'member') {
    return null;
  }
  return row as MyOrgInfo;
}

export type OrgMembership = {
  userId: string;
  orgId: string;
  orgName: string;
  role: 'owner' | 'admin' | 'member';
};

// Returns ALL active memberships for the auth user, ordered by org name.
// Used by the multi-org switcher dropdown.
export async function listMyMemberships(authUserId: string): Promise<OrgMembership[]> {
  const rows = await db
    .select({
      userId: users.id,
      orgId: organizations.id,
      orgName: organizations.name,
      role: users.role,
    })
    .from(users)
    .innerJoin(organizations, eq(users.orgId, organizations.id))
    .where(
      and(
        eq(users.authUserId, authUserId),
        isNull(users.deletedAt),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(asc(organizations.name));

  return rows.filter(
    (r): r is OrgMembership =>
      r.role === 'owner' || r.role === 'admin' || r.role === 'member',
  );
}
