import 'server-only';
import { and, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { clients } from '@/db/schema';

// Cheap "does this email already have a clients row?" check, used by the
// root page and dashboard page guard to short-circuit the path that would
// otherwise push a stakeholder-only auth user into the org-creation wizard
// (DEBT-037 routing fix). Mirrors db/queries/users.ts:authUserHasMembership.
//
// Case-insensitive — clients.email is text UNIQUE (case-sensitive at the
// schema level), and legacy rows may have been inserted with mixed case.
// Auth-side, actions/auth.ts:emailPasswordSchema lowercases at ingress, so
// the live auth user email is reliably lowercase. The lower() comparison
// defends against historical case-mismatch. Seq-scan acceptable at current
// scale; add functional index on lower(email) if hot.
export async function authEmailHasClient(email: string): Promise<boolean> {
  const trimmed = email.trim();
  if (!trimmed) return false;
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        sql`lower(${clients.email}) = lower(${trimmed})`,
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
