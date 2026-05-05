'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { AuthError, requireAuth, type ServerActionErrorCode } from '@/lib/auth/requireAuth';
import { createServiceClient } from '@/lib/supabase/service';
import { logAudit } from '@/lib/audit/log';
import { authUserHasMembership } from '@/db/queries/users';

export type ServerActionResult =
  | { success: true }
  | { error: ServerActionErrorCode; reason?: string };

const CreateOrgInput = z.object({
  orgTypeSlug: z.enum(['surveyor', 'architect']),
  name: z.string().trim().min(1, 'Firm name is required').max(120),
  ownerName: z.string().trim().min(1, 'Your name is required').max(120),
});

// Bootstrap action: turns a freshly-signed-up auth user into the owner of a new
// organization. RLS doesn't apply here (the caller has no `users` row yet), so
// uses the service-role client. Adjustment 1 (Session 3 plan): plan picker is
// hidden in Phase 1a; defaults to `solo_free` for the chosen org type. Phase 6
// will surface the upgrade UI — see ARCHITECTURE-saas.md §31 Phase 6 row.
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

  const supabase = createServiceClient();

  const { data: orgType, error: orgTypeErr } = await supabase
    .from('org_types')
    .select('id, slug')
    .eq('slug', orgTypeSlug)
    .single();
  if (orgTypeErr || !orgType) {
    return { error: 'not_found', reason: `org_type:${orgTypeSlug}` };
  }

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id, slug')
    .eq('org_type_id', orgType.id)
    .eq('slug', 'solo_free')
    .single();
  if (planErr || !plan) {
    return { error: 'not_found', reason: 'plan:solo_free' };
  }

  const orgId = uuidv7();
  const userId = uuidv7();

  const { error: orgInsErr } = await supabase.from('organizations').insert({
    id: orgId,
    name,
    type_id: orgType.id,
    plan_id: plan.id,
  });
  if (orgInsErr) {
    return { error: 'internal_error', reason: `org_insert:${orgInsErr.message}` };
  }

  const { error: userInsErr } = await supabase.from('users').insert({
    id: userId,
    auth_user_id: authUser.id,
    org_id: orgId,
    email: authUser.email ?? '',
    name: ownerName,
    role: 'owner',
  });
  if (userInsErr) {
    return { error: 'internal_error', reason: `user_insert:${userInsErr.message}` };
  }

  await logAudit({
    orgId,
    userId,
    action: 'create',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { plan: plan.slug, type: orgType.slug },
  });
  await logAudit({
    orgId,
    userId,
    action: 'create',
    resourceType: 'user',
    resourceId: userId,
    metadata: { role: 'owner' },
  });

  return { success: true };
}
