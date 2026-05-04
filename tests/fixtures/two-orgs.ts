import { v7 as uuidv7 } from 'uuid';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../helpers/service-client';

export interface TwoOrgUser {
  authUserId: string;
  userId: string;
  email: string;
  password: string;
}

export interface TwoOrgFixture {
  service: SupabaseClient;
  orgA: { id: string; name: string };
  orgB: { id: string; name: string };
  userA: TwoOrgUser; // owner of orgA
  userB: TwoOrgUser; // owner of orgB
  cleanup: () => Promise<void>;
}

// Creates two organizations + one owner each, via the service-role client.
// Every test file gets its own fixture (timestamps in emails/names ensure
// no collision between parallel test files).
export async function createTwoOrgFixture(): Promise<TwoOrgFixture> {
  const service = serviceClient();
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  const tag = `${ts}-${rnd}`;

  // 1. Look up plans (one per org type). Seeds must have run.
  const { data: plansRaw, error: plansErr } = await service
    .from('plans')
    .select('id, slug, org_type_id');
  if (plansErr) throw new Error(`fixture: plans read: ${plansErr.message}`);
  if (!plansRaw || plansRaw.length === 0) {
    throw new Error('fixture: no plans rows — run `npm run db:seed` against this stack first');
  }

  const { data: types, error: typesErr } = await service
    .from('org_types')
    .select('id, slug');
  if (typesErr) throw new Error(`fixture: org_types read: ${typesErr.message}`);
  const surveyorId = types?.find((t) => t.slug === 'surveyor')?.id;
  const architectId = types?.find((t) => t.slug === 'architect')?.id;
  if (!surveyorId || !architectId)
    throw new Error('fixture: org_types not seeded (surveyor/architect missing)');

  const surveyorPlan = plansRaw.find((p) => p.org_type_id === surveyorId)!;
  const architectPlan = plansRaw.find((p) => p.org_type_id === architectId)!;

  // 2. Create two organizations.
  const orgAId = uuidv7();
  const orgBId = uuidv7();
  const orgA = { id: orgAId, name: `Test Org A ${tag}` };
  const orgB = { id: orgBId, name: `Test Org B ${tag}` };

  const { error: orgErr } = await service.from('organizations').insert([
    {
      id: orgAId,
      name: orgA.name,
      type_id: surveyorId,
      plan_id: surveyorPlan.id,
    },
    {
      id: orgBId,
      name: orgB.name,
      type_id: architectId,
      plan_id: architectPlan.id,
    },
  ]);
  if (orgErr) throw new Error(`fixture: insert organizations: ${orgErr.message}`);

  // 3. Create two auth users (email_confirm so signInWithPassword works).
  const emailA = `rls-a-${tag}@test.local`;
  const emailB = `rls-b-${tag}@test.local`;
  const passwordA = `pwA-${tag}-x9X`;
  const passwordB = `pwB-${tag}-x9X`;

  const { data: authADat, error: authAErr } = await service.auth.admin.createUser({
    email: emailA,
    password: passwordA,
    email_confirm: true,
  });
  if (authAErr || !authADat.user)
    throw new Error(`fixture: createUser A: ${authAErr?.message ?? 'no user'}`);

  const { data: authBDat, error: authBErr } = await service.auth.admin.createUser({
    email: emailB,
    password: passwordB,
    email_confirm: true,
  });
  if (authBErr || !authBDat.user)
    throw new Error(`fixture: createUser B: ${authBErr?.message ?? 'no user'}`);

  // 4. Create users rows wiring auth → org. Owner role.
  const userAId = uuidv7();
  const userBId = uuidv7();

  const { error: usersErr } = await service.from('users').insert([
    {
      id: userAId,
      auth_user_id: authADat.user.id,
      org_id: orgAId,
      email: emailA,
      name: `User A ${tag}`,
      role: 'owner',
    },
    {
      id: userBId,
      auth_user_id: authBDat.user.id,
      org_id: orgBId,
      email: emailB,
      name: `User B ${tag}`,
      role: 'owner',
    },
  ]);
  if (usersErr) throw new Error(`fixture: insert users: ${usersErr.message}`);

  const cleanup = async () => {
    // Delete in dependency order. Errors swallowed — tests have already run.
    await service.from('users').delete().in('id', [userAId, userBId]);
    await service.from('organizations').delete().in('id', [orgAId, orgBId]);
    await service.auth.admin.deleteUser(authADat.user!.id);
    await service.auth.admin.deleteUser(authBDat.user!.id);
  };

  return {
    service,
    orgA,
    orgB,
    userA: { authUserId: authADat.user.id, userId: userAId, email: emailA, password: passwordA },
    userB: { authUserId: authBDat.user.id, userId: userBId, email: emailB, password: passwordB },
    cleanup,
  };
}
