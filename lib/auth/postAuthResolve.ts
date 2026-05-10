import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { clients, users } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';

// DEBT-037 hotfix — restores the §8 auth contract that the generic auth
// callback was bypassing. After Supabase confirms a session, this resolver:
//   1. Backfills clients.auth_user_id by email (Sarah Step 7) — idempotent
//      via the WHERE auth_user_id IS NULL predicate, so a concurrent
//      acceptStakeholderInvitation (actions/stakeholders.ts:402-409) that
//      wins the race becomes a no-op for us.
//   2. Anti-hijack: if the clients row is already linked to a different
//      auth_user_id, log to Sentry and treat as orphan/team for routing
//      (mirrors actions/stakeholders.ts:398-400).
//   3. Counts users rows for this auth_user_id.
//   4. Returns the §8 identity kind. Routing decisions live in
//      pickDestination so all post-auth routing flows through one helper
//      (the post-merge ADR enshrines: "no direct redirects from auth
//      actions; everything goes through pickDestination").

export type ResolvedIdentity =
  | { kind: 'team'; orgCount: number }
  | { kind: 'stakeholder' }
  | { kind: 'dual_context' }
  | { kind: 'orphan' };

export async function resolvePostAuthIdentity(
  authUserId: string,
  authEmail: string,
): Promise<ResolvedIdentity> {
  const trimmedEmail = (authEmail ?? '').trim();

  let clientId: string | null = null;
  let backfilled = false;

  if (trimmedEmail) {
    const result = await db.transaction(async (tx) => {
      // Atomic backfill: idempotent against concurrent acceptance flows.
      const updated = await tx
        .update(clients)
        .set({ authUserId })
        .where(
          and(
            sql`lower(${clients.email}) = lower(${trimmedEmail})`,
            isNull(clients.authUserId),
            isNull(clients.deletedAt),
          ),
        )
        .returning({ id: clients.id });

      const rows = await tx
        .select({ id: clients.id, authUserId: clients.authUserId })
        .from(clients)
        .where(
          and(
            sql`lower(${clients.email}) = lower(${trimmedEmail})`,
            isNull(clients.deletedAt),
          ),
        )
        .limit(1);

      return { row: rows[0] ?? null, justBackfilled: updated.length > 0 };
    });

    if (result.row) {
      if (result.row.authUserId === authUserId) {
        clientId = result.row.id;
        backfilled = result.justBackfilled;
      } else if (result.row.authUserId !== null) {
        // Anti-hijack: another auth identity is already linked to this email.
        // Don't return 'stakeholder' — treat as orphan/team for routing.
        Sentry.captureMessage('debt_037_anti_hijack', {
          level: 'warning',
          extra: {
            authUserId,
            clientId: result.row.id,
            existingAuthUserId: result.row.authUserId,
          },
        });
      }
    }
  }

  if (backfilled && clientId) {
    // Soft-actor audit: client_id set, user_id/org_id left NULL = system.
    // Re-uses the existing 'invite_accepted' verb; the new event lives in
    // metadata.event so we don't grow the AuditAction enum for one usage.
    await logAudit({
      clientId,
      action: 'invite_accepted',
      resourceType: 'client',
      resourceId: clientId,
      metadata: {
        event: 'client.linked_to_auth',
        via: 'auth_callback',
        auth_user_id: authUserId,
      },
    });
  }

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)));
  const userCount = userRows.length;

  if (userCount === 0 && clientId === null) return { kind: 'orphan' };
  if (userCount === 0 && clientId !== null) return { kind: 'stakeholder' };
  if (userCount >= 1 && clientId === null) return { kind: 'team', orgCount: userCount };
  return { kind: 'dual_context' };
}

// Open-redirect guard. Mirrors actions/auth.ts:safeNext.
function safeNext(candidate: string, fallback: string): string {
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  return candidate;
}

// Decides the post-auth redirect path given identity + the caller-supplied
// ?next. ALL post-auth routing flows through here — the auth callback,
// signIn, and any future entry points. Rules in priority order:
//
//   1. /invitations/* → honor verbatim (the acceptance page does its own
//      identity dispatch and we must not undermine it).
//   2. /onboarding when userCount === 0 → honor (Sarah Step 2 valid for
//      stakeholders; net-new for orphans).
//   3. /onboarding when userCount >= 1 → /dashboard (no second-org in
//      Phase 1a; mirrors the existing onboarding/page.tsx guard).
//   4. /portal/* when identity is stakeholder or dual_context → honor.
//   5. /dashboard or /dashboard/* when identity is team or dual_context
//      → honor.
//   6. Else apply identity default per §8:
//        team → /dashboard
//        stakeholder → /portal/projects
//        dual_context → /dashboard (team-context default; user can
//          navigate to /portal/projects via direct URL — /select-context
//          page is Phase 1c)
//        orphan → /onboarding
//   7. safeNext() validates the candidate before returning.
export function pickDestination(
  identity: ResolvedIdentity,
  next: string | null,
): string {
  const userCount = identity.kind === 'team' ? identity.orgCount
    : identity.kind === 'dual_context' ? 1
    : 0;

  const def =
    identity.kind === 'team' ? '/dashboard'
    : identity.kind === 'stakeholder' ? '/portal/projects'
    : identity.kind === 'dual_context' ? '/dashboard'
    : '/onboarding';

  if (next) {
    if (next.startsWith('/invitations/')) return safeNext(next, def);

    if (next === '/onboarding') {
      return userCount === 0 ? safeNext(next, def) : '/dashboard';
    }

    if (
      next.startsWith('/portal/') &&
      (identity.kind === 'stakeholder' || identity.kind === 'dual_context')
    ) {
      return safeNext(next, def);
    }

    if (
      (next === '/dashboard' || next.startsWith('/dashboard/')) &&
      (identity.kind === 'team' || identity.kind === 'dual_context')
    ) {
      return safeNext(next, def);
    }
  }

  return def;
}
