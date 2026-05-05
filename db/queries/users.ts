import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';

// Cheap "does this auth user already have a users row anywhere?" check, used
// during signup to bounce users with an existing membership back to /dashboard
// before they hit createOrganization (and again as a guard inside the action).
export async function authUserHasMembership(authUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
    .limit(1);
  return rows.length > 0;
}
