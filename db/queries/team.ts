import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  authUserId: string;
};

// Active members of an org, excluding soft-deleted.
export async function listTeamMembers(orgId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      authUserId: users.authUserId,
    })
    .from(users)
    .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)))
    .orderBy(asc(users.role), asc(users.name));
  return rows.filter(
    (r): r is TeamMember =>
      r.role === 'owner' || r.role === 'admin' || r.role === 'member',
  );
}
