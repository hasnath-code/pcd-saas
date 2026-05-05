import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { organizations, users } from '@/db/schema';

export type MyOrgInfo = {
  userId: string;
  userName: string;
  orgId: string;
  orgName: string;
  role: 'owner' | 'admin' | 'member';
};

// Returns the auth user's single org membership (joined with the org row), or
// null if no `users` row exists yet for this auth_user_id (pre-onboarding).
//
// Multi-org users would return only the first row here — Phase 1a is single-org;
// `requireOrgUser()` is the gating helper that errors on multi-org. Callers that
// need a guaranteed-single-org context should use that instead.
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
