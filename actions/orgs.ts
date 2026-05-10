'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  AuthError,
  requireAuth,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clients,
  organizations,
  orgTypes,
  plans,
  users,
  workflows,
  workflowStages,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { authUserHasMembership } from '@/db/queries/users';

export type ServerActionResult =
  | { success: true }
  | { error: ServerActionErrorCode; reason?: string };

// DEBT-037: `intent` is a runtime guard that documents and enforces
// "createOrganization may be called from exactly one place — the explicit
// signup wizard." Any future caller missing the literal fails Zod validation
// rather than silently inserting an org. (Post-merge ADR enshrines this.)
const CreateOrgInput = z.object({
  intent: z.literal('wizard_signup'),
  orgTypeSlug: z.enum(['surveyor', 'architect']),
  name: z.string().trim().min(1, 'Firm name is required').max(120),
  ownerName: z.string().trim().min(1, 'Your name is required').max(120),
});

// Bootstrap action: turns a freshly-signed-up auth user into the owner of a new
// organization AND atomically clones the "Simple" workflow into the new org.
// Uses Drizzle pooler `db.transaction(...)` (postgres role bypasses RLS) so the
// org/user/workflow/stages inserts succeed or roll back together — no
// split-brain state where an org exists without its workflow.
//
// Plan picker is hidden in Phase 1a; defaults to `solo_free` for the chosen
// org type. Phase 6 will surface the upgrade UI per ARCHITECTURE-saas.md §31.
//
// Known limitation (Phase 6 will fix): if the transaction rolls back, the
// auth.users row remains (it was created by Supabase auth before this action
// was called). The user can re-attempt signup; authUserHasMembership returns
// false (no public.users row), so the second call proceeds normally.
export async function createOrganization(
  input: unknown,
): Promise<ServerActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateOrgInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { orgTypeSlug, name, ownerName } = parsed.data;

  if (await authUserHasMembership(authUser.id)) {
    return { error: 'conflict', reason: 'membership_already_exists' };
  }

  const orgId = uuidv7();
  const userId = uuidv7();
  const ownerEmail = authUser.email ?? '';

  let chosenPlanSlug: string;
  let chosenOrgTypeSlug: string;

  try {
    const result = await db.transaction(async (tx) => {
      const orgTypeRows = await tx
        .select({ id: orgTypes.id, slug: orgTypes.slug })
        .from(orgTypes)
        .where(eq(orgTypes.slug, orgTypeSlug))
        .limit(1);
      if (orgTypeRows.length === 0) {
        throw new Error(`org_type_not_found:${orgTypeSlug}`);
      }
      const orgType = orgTypeRows[0];

      const planRows = await tx
        .select({ id: plans.id, slug: plans.slug })
        .from(plans)
        .where(and(eq(plans.orgTypeId, orgType.id), eq(plans.slug, 'solo_free')))
        .limit(1);
      if (planRows.length === 0) {
        throw new Error('plan_not_found:solo_free');
      }
      const plan = planRows[0];

      await tx.insert(organizations).values({
        id: orgId,
        name,
        typeId: orgType.id,
        planId: plan.id,
      });

      await tx.insert(users).values({
        id: userId,
        authUserId: authUser.id,
        orgId,
        email: ownerEmail,
        name: ownerName,
        role: 'owner',
      });

      await cloneSimpleWorkflowForOrg(tx, orgId);

      return { planSlug: plan.slug, typeSlug: orgType.slug };
    });
    chosenPlanSlug = result.planSlug;
    chosenOrgTypeSlug = result.typeSlug;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `signup_transaction:${reason}` };
  }

  // DEBT-037: dual-context probe — if this auth user already has a clients
  // row, this is a Sarah Step 2 signup (legitimate stakeholder creating their
  // own firm). We do NOT block — the wizard intent is explicit (Zod literal
  // above + UI form). The metadata flag surfaces the dual-context for
  // observability and future UX (Session 11 may add a confirmation step).
  const stakeholderRows = ownerEmail
    ? await db
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            sql`lower(${clients.email}) = lower(${ownerEmail})`,
            isNull(clients.deletedAt),
          ),
        )
        .limit(1)
    : [];
  const dualContext = stakeholderRows.length > 0;

  // Audit on success only — three rows: organization, user, workflow.
  await logAudit({
    orgId,
    userId,
    action: 'create',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: {
      plan: chosenPlanSlug,
      type: chosenOrgTypeSlug,
      ...(dualContext && {
        dual_context_signup: true,
        client_id: stakeholderRows[0].id,
      }),
    },
  });
  await logAudit({
    orgId,
    userId,
    action: 'create',
    resourceType: 'user',
    resourceId: userId,
    metadata: { role: 'owner' },
  });
  await logAudit({
    orgId,
    userId,
    action: 'create',
    resourceType: 'workflow',
    metadata: { cloned_from: 'simple' },
  });

  return { success: true };
}

// Clones the "Simple" system template (workflow + stages) into the given org.
// Runs inside a Drizzle transaction (caller passes `tx`). Throws on any failure
// to roll back the parent transaction. Idempotent guard: skips if any workflow
// row already exists for the org (defense-in-depth — in normal signup flow
// this branch shouldn't fire).
async function cloneSimpleWorkflowForOrg(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
): Promise<void> {
  const existing = await tx
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.orgId, orgId))
    .limit(1);
  if (existing.length > 0) return;

  const templateRows = await tx
    .select({
      id: workflows.id,
      slug: workflows.slug,
      name: workflows.name,
      description: workflows.description,
    })
    .from(workflows)
    .where(and(eq(workflows.slug, 'simple'), eq(workflows.isSystemTemplate, true)))
    .limit(1);
  if (templateRows.length === 0) {
    throw new Error('simple_template_missing');
  }
  const template = templateRows[0];

  const stageRows = await tx
    .select({
      slug: workflowStages.slug,
      name: workflowStages.name,
      position: workflowStages.position,
      isTerminal: workflowStages.isTerminal,
      requiresAction: workflowStages.requiresAction,
      color: workflowStages.color,
    })
    .from(workflowStages)
    .where(eq(workflowStages.workflowId, template.id));
  if (stageRows.length === 0) {
    throw new Error('simple_template_has_no_stages');
  }

  const newWorkflowId = uuidv7();
  await tx.insert(workflows).values({
    id: newWorkflowId,
    orgId,
    slug: template.slug,
    name: template.name,
    description: template.description,
    isSystemTemplate: false,
    isDefault: true,
  });

  await tx.insert(workflowStages).values(
    stageRows.map((s) => ({
      id: uuidv7(),
      workflowId: newWorkflowId,
      slug: s.slug,
      name: s.name,
      position: s.position,
      isTerminal: s.isTerminal,
      requiresAction: s.requiresAction,
      color: s.color,
    })),
  );
}

const SwitchOrgInput = z.object({
  orgId: z.string().uuid(),
});

// Multi-org context switcher. Validates the caller has an active membership
// in the target org, sets the `active_org_id` cookie (HttpOnly, Secure in
// prod, SameSite=Lax, 30 days), and revalidates the dashboard + settings
// trees so server components re-fetch with the new org context.
//
// Returns the same `not_authorized / not_a_member` for both "user isn't a
// member" and "org doesn't exist" so the response doesn't leak org existence.
export async function switchActiveOrg(input: unknown): Promise<ServerActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = SwitchOrgInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { orgId } = parsed.data;

  const memberRows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.authUserId, authUser.id),
        eq(users.orgId, orgId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (memberRows.length === 0) {
    return { error: 'not_authorized', reason: 'not_a_member' };
  }

  const cookieStore = await cookies();
  cookieStore.set('active_org_id', orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  await logAudit({
    orgId,
    userId: memberRows[0].id,
    action: 'permission_change',
    resourceType: 'session',
    metadata: { active_org_id: orgId },
  });

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true };
}
