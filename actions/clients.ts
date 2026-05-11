'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  AuthError,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db, type DbOrTx } from '@/db';
import { clients, clientOrgMemberships } from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { autoCreateGeneralConversationTx } from '@/actions/conversations';
import { seedNotificationDefaultsTx } from '@/lib/notifications/seed-defaults';

export type ClientActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

const COMPANY_TYPES = [
  'architect_firm',
  'contractor',
  'homeowner',
  'engineer',
  'developer',
  'other',
] as const;

const FindOrCreateClientInput = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().trim().min(1, 'Client name is required').max(120),
  phone: z.string().trim().max(40).optional(),
  companyName: z.string().trim().max(120).optional(),
  companyType: z.enum(COMPANY_TYPES).optional(),
});

export type FindOrCreateClientInputT = z.infer<typeof FindOrCreateClientInput>;

// Internal tx-friendly variant of findOrCreateClient. Takes an existing
// transaction client (or the top-level db) so callers like inviteStakeholder
// can compose it inside their own atomic write. Drizzle does NOT support
// nested transactions, so the outer caller MUST pass `tx` rather than calling
// findOrCreateClient (the public action wraps in its own tx).
//
// Returns clientId + a `created` flag (true if a new clients row was inserted;
// false if reusing an existing row globally or in this org). Caller is
// responsible for the audit log entry — this helper does no audit so it
// remains a pure data primitive.
export async function findOrCreateClientTx(
  tx: DbOrTx,
  input: FindOrCreateClientInputT,
  orgId: string,
): Promise<{ clientId: string; created: boolean }> {
  const { email, name, phone, companyName, companyType } = input;

  // Existing client by email + linked to caller's org via membership?
  const existingInOrg = await tx
    .select({ id: clients.id })
    .from(clients)
    .innerJoin(clientOrgMemberships, eq(clientOrgMemberships.clientId, clients.id))
    .where(
      and(
        eq(clients.email, email),
        eq(clientOrgMemberships.orgId, orgId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (existingInOrg.length > 0) {
    return { clientId: existingInOrg[0].id, created: false };
  }

  // Existing client globally (different org)? Reuse the row, just attach a
  // new membership for caller's org.
  const existingGlobal = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.email, email), isNull(clients.deletedAt)))
    .limit(1);

  let clientId: string;
  let created = false;

  if (existingGlobal.length > 0) {
    clientId = existingGlobal[0].id;
  } else {
    clientId = uuidv7();
    await tx.insert(clients).values({
      id: clientId,
      email,
      name,
      phone,
      companyName,
      companyType,
    });
    created = true;
  }

  await tx.insert(clientOrgMemberships).values({
    id: uuidv7(),
    clientId,
    orgId,
  });

  // Session 11 §17: seed default notification preferences for the client.
  // Always idempotent (ON CONFLICT DO NOTHING), so safe to call on both the
  // new-client path AND the reuse-global-row path — a client invited to two
  // orgs only seeds once, the second pass is a no-op.
  await seedNotificationDefaultsTx(tx, { clientId });

  return { clientId, created };
}

// Idempotent: if a client row with the given email is already linked to the
// caller's org via client_org_memberships, returns it; else creates a new
// clients row + memberships row in one transaction. Audit only on actual
// create — repeated lookups don't write audit rows.
//
// Email matching uses normalized form (lower+trim) per the schema. Same client
// email can exist in multiple orgs (one homeowner working with two firms);
// `clients.email` is globally UNIQUE so the second org reuses the same row
// via a fresh client_org_memberships entry.
export async function findOrCreateClient(
  input: unknown,
): Promise<ClientActionResult<{ clientId: string; created: boolean }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = FindOrCreateClientInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  let result: { clientId: string; created: boolean };
  try {
    result = await db.transaction(async (tx) => {
      const r = await findOrCreateClientTx(tx, parsed.data, ctx.orgId);
      // Decision 9.1B: auto-create the org↔client general conversation when a
      // new client_org_memberships row lands. autoCreateGeneralConversationTx
      // is idempotent — re-runs on existing memberships are no-ops.
      await autoCreateGeneralConversationTx(tx, {
        orgId: ctx.orgId,
        clientId: r.clientId,
        createdByUserId: ctx.userId,
      });
      return r;
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `find_or_create_client:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    clientId: result.clientId,
    action: 'create',
    resourceType: result.created ? 'client' : 'client_org_membership',
    resourceId: result.clientId,
    metadata: { email: parsed.data.email, via: 'find_or_create' },
  });

  return { success: true, data: result };
}

const UpdateClientInput = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  companyName: z.string().trim().max(120).nullable().optional(),
  companyType: z.enum(COMPANY_TYPES).nullable().optional(),
  billingAddress: z.string().trim().max(500).nullable().optional(),
});

// Update mutable client fields. Cross-org targets are returned as not_found
// to avoid leaking client existence across orgs (matches removeUserFromOrg
// precedent in actions/users.ts).
export async function updateClient(
  input: unknown,
): Promise<ClientActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdateClientInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { clientId, ...patch } = parsed.data;

  // Verify the client is linked to caller's org.
  const linkRows = await db
    .select({ id: clientOrgMemberships.id })
    .from(clientOrgMemberships)
    .innerJoin(clients, eq(clients.id, clientOrgMemberships.clientId))
    .where(
      and(
        eq(clientOrgMemberships.clientId, clientId),
        eq(clientOrgMemberships.orgId, ctx.orgId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (linkRows.length === 0) {
    return { error: 'not_found', reason: 'client' };
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return { error: 'validation_error', reason: 'no_fields_to_update' };
  }

  await db.update(clients).set(updates).where(eq(clients.id, clientId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    clientId,
    action: 'update',
    resourceType: 'client',
    resourceId: clientId,
    metadata: { fields: Object.keys(updates) },
  });

  return { success: true };
}
