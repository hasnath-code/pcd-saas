import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgAdmin: vi.fn(),
    requireOrgUser: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  pickDestination,
  resolvePostAuthIdentity,
  type ResolvedIdentity,
} from '@/lib/auth/postAuthResolve';
import { createOrganization } from '@/actions/orgs';
import * as auth from '@/lib/auth/requireAuth';

// DEBT-037 regression coverage: the three §8 identity scenarios.
// Test 1 (stakeholder-only) is the bug's victim profile — must NOT spawn
// an org. Test 2 (net-new owner) is the legitimate signup path — must
// continue to work. Test 3 (dual-context) is Sarah Step 2 — must NOT be
// blocked, and must surface dual_context_signup in audit metadata.
//
// Per DEBT-023, fixtures inserting users rows directly with fake UUIDs
// hit the auth.users FK. We mint via service.auth.admin.createUser.

// ─── Local helpers (mirror tests/fixtures/stakeholder-fixtures.ts internals) ──

async function mintAuthIdentity(
  service: SupabaseClient,
  label: string,
): Promise<{ authUserId: string; email: string; password: string }> {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  const email = `${label}-${ts}-${rnd}@test.local`;
  const password = `pw-${rnd}-x9X`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`mintAuthIdentity ${label}: ${error?.message ?? 'no user'}`);
  }
  return { authUserId: data.user.id, email, password };
}

async function insertClientRow(
  service: SupabaseClient,
  opts: { email: string; authUserId?: string },
): Promise<string> {
  const id = uuidv7();
  const row: Record<string, unknown> = {
    id,
    email: opts.email,
    name: 'Auth Callback Test',
  };
  if (opts.authUserId) row.auth_user_id = opts.authUserId;
  const { error } = await service.from('clients').insert(row);
  if (error) throw new Error(`insertClientRow: ${error.message}`);
  return id;
}

describe('DEBT-037 — resolvePostAuthIdentity + createOrganization §8 scenarios', () => {
  let f: TwoOrgFixture;

  beforeAll(async () => {
    f = await createTwoOrgFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockReset();
  });

  // ─── Scenario 1: Stakeholder-only (the bug's victim profile) ──────────────

  test('stakeholder-only: backfills clients.auth_user_id, no org/user created, route=/portal/projects', async () => {
    const { authUserId, email } = await mintAuthIdentity(f.service, 'sh-only');
    const clientId = await insertClientRow(f.service, { email });

    const identity = await resolvePostAuthIdentity(authUserId, email);
    expect(identity).toEqual({ kind: 'stakeholder' });

    // The link helper executed inside resolve.
    const { data: c } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', clientId)
      .single();
    expect(c?.auth_user_id).toBe(authUserId);

    // No organizations row exists for this auth user.
    const { data: ownedOrgs } = await f.service
      .from('users')
      .select('org_id')
      .eq('auth_user_id', authUserId);
    expect(ownedOrgs).toEqual([]);

    // pickDestination routes to the stakeholder portal.
    expect(pickDestination(identity, null)).toBe('/portal/projects');
    // Even with a /dashboard ?next, identity overrides.
    expect(pickDestination(identity, '/dashboard')).toBe('/portal/projects');
    // /portal/* ?next is honored.
    expect(pickDestination(identity, '/portal/projects/abc')).toBe('/portal/projects/abc');

    // Audit row written for the link event.
    const { data: auditRows } = await f.service
      .from('audit_logs')
      .select('action, resource_type, resource_id, metadata')
      .eq('client_id', clientId)
      .eq('action', 'invite_accepted')
      .eq('resource_type', 'client');
    expect(auditRows).toHaveLength(1);
    expect(auditRows![0].metadata).toMatchObject({
      event: 'client.linked_to_auth',
      via: 'auth_callback',
    });

    // Cleanup.
    await f.service.from('audit_logs').delete().eq('client_id', clientId);
    await f.service.from('clients').delete().eq('id', clientId);
    await f.service.auth.admin.deleteUser(authUserId);
  });

  // ─── Scenario 2: Net-new owner via the wizard (legitimate path) ───────────

  test('net-new owner: createOrganization happy path still works with intent guard', async () => {
    const { authUserId, email } = await mintAuthIdentity(f.service, 'newowner');
    vi.mocked(auth.requireAuth).mockResolvedValue({ id: authUserId, email } as unknown as User);

    const result = await createOrganization({
      intent: 'wizard_signup',
      orgTypeSlug: 'surveyor',
      name: `Wizard Owner ${uuidv7()}`,
      ownerName: 'Wizard Tester',
    });
    expect(result).toEqual({ success: true });

    // Verify org + user + workflow + 5 stages.
    const { data: userRows } = await f.service
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', authUserId);
    expect(userRows).toHaveLength(1);
    const orgId = userRows![0].org_id;

    const { data: wfRows } = await f.service
      .from('workflows')
      .select('id, slug, is_default')
      .eq('org_id', orgId);
    expect(wfRows).toHaveLength(1);
    expect(wfRows![0].slug).toBe('simple');

    const { data: stageRows } = await f.service
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', wfRows![0].id);
    expect(stageRows).toHaveLength(5);

    // Audit row for the org create exists; dual_context_signup absent (no clients row).
    const { data: orgAudit } = await f.service
      .from('audit_logs')
      .select('metadata')
      .eq('resource_type', 'organization')
      .eq('resource_id', orgId)
      .single();
    expect(orgAudit?.metadata).toMatchObject({ plan: 'solo_free', type: 'surveyor' });
    expect((orgAudit?.metadata as Record<string, unknown>).dual_context_signup).toBeUndefined();

    // pickDestination for a single-membership team identity → /dashboard.
    const teamIdentity: ResolvedIdentity = { kind: 'team', orgCount: 1 };
    expect(pickDestination(teamIdentity, null)).toBe('/dashboard');
    expect(pickDestination(teamIdentity, '/dashboard/projects')).toBe('/dashboard/projects');

    // Cleanup.
    await f.service.from('users').delete().eq('id', userRows![0].id);
    await f.service.from('organizations').delete().eq('id', orgId);
    await f.service.auth.admin.deleteUser(authUserId);
  });

  // ─── Scenario 3: Dual-context (Sarah Step 2 — stakeholder creates own firm) ──

  test('dual-context: stakeholder creates own firm via wizard intent, NOT blocked, audit notes dual_context', async () => {
    const { authUserId, email } = await mintAuthIdentity(f.service, 'dual');
    const clientId = await insertClientRow(f.service, { email, authUserId });
    vi.mocked(auth.requireAuth).mockResolvedValue({ id: authUserId, email } as unknown as User);

    const result = await createOrganization({
      intent: 'wizard_signup',
      orgTypeSlug: 'architect',
      name: `Sarah Architecture Ltd ${uuidv7()}`,
      ownerName: 'Sarah Dual',
    });
    // Critical assertion: dual context is NOT blocked.
    expect(result).toEqual({ success: true });

    const { data: userRows } = await f.service
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', authUserId);
    expect(userRows).toHaveLength(1);
    const orgId = userRows![0].org_id;

    // Clients row preserved (auth_user_id still linked, not nulled).
    const { data: c } = await f.service
      .from('clients')
      .select('id, auth_user_id, deleted_at')
      .eq('id', clientId)
      .single();
    expect(c?.auth_user_id).toBe(authUserId);
    expect(c?.deleted_at).toBeNull();

    // Audit row carries dual_context_signup=true with the linking client_id.
    const { data: orgAudit } = await f.service
      .from('audit_logs')
      .select('metadata')
      .eq('resource_type', 'organization')
      .eq('resource_id', orgId)
      .single();
    expect(orgAudit?.metadata).toMatchObject({
      plan: 'solo_free',
      type: 'architect',
      dual_context_signup: true,
      client_id: clientId,
    });

    // pickDestination for dual_context (team-context default per the locked plan).
    const dualIdentity: ResolvedIdentity = { kind: 'dual_context' };
    expect(pickDestination(dualIdentity, null)).toBe('/dashboard');
    // /portal/* is honored when the user explicitly navigates there.
    expect(pickDestination(dualIdentity, '/portal/projects')).toBe('/portal/projects');

    // Cleanup.
    await f.service.from('users').delete().eq('id', userRows![0].id);
    await f.service.from('organizations').delete().eq('id', orgId);
    await f.service.from('clients').delete().eq('id', clientId);
    await f.service.auth.admin.deleteUser(authUserId);
  });

  // ─── Defense-in-depth: createOrganization rejects missing intent ───────────

  test('createOrganization without intent: validation_error (Zod literal guard)', async () => {
    const { authUserId, email } = await mintAuthIdentity(f.service, 'noint');
    vi.mocked(auth.requireAuth).mockResolvedValue({ id: authUserId, email } as unknown as User);

    // Missing `intent` field — runtime guard rejects.
    const result = await createOrganization({
      orgTypeSlug: 'surveyor',
      name: 'Should fail validation',
      ownerName: 'No Intent',
    });
    expect(result).toMatchObject({ error: 'validation_error' });

    // Wrong intent literal — also rejects.
    const result2 = await createOrganization({
      intent: 'something_else',
      orgTypeSlug: 'surveyor',
      name: 'Wrong intent',
      ownerName: 'Wrong',
    });
    expect(result2).toMatchObject({ error: 'validation_error' });

    // Cleanup.
    await f.service.auth.admin.deleteUser(authUserId);
  });
});

// ─── Pure pickDestination unit tests (no DB) — §8 decision tree coverage ────

describe('DEBT-037 — pickDestination §8 routing tree', () => {
  test('orphan → /onboarding, no ?next override needed', () => {
    expect(pickDestination({ kind: 'orphan' }, null)).toBe('/onboarding');
    expect(pickDestination({ kind: 'orphan' }, '/onboarding')).toBe('/onboarding');
    // Orphan honoring /dashboard would be wrong (no users row); falls back to identity default.
    expect(pickDestination({ kind: 'orphan' }, '/dashboard')).toBe('/onboarding');
  });

  test('/invitations/* always honored (acceptance page does its own dispatch)', () => {
    expect(pickDestination({ kind: 'orphan' }, '/invitations/abc-123')).toBe('/invitations/abc-123');
    expect(pickDestination({ kind: 'stakeholder' }, '/invitations/xyz')).toBe('/invitations/xyz');
    expect(pickDestination({ kind: 'team', orgCount: 1 }, '/invitations/zzz')).toBe('/invitations/zzz');
  });

  test('/onboarding honored only when userCount === 0 (Sarah Step 2 valid for stakeholder)', () => {
    // Stakeholder + ?next=/onboarding → wizard reachable for Sarah Step 2.
    expect(pickDestination({ kind: 'stakeholder' }, '/onboarding')).toBe('/onboarding');
    // Team + ?next=/onboarding → bounce to /dashboard (no second-org in Phase 1a).
    expect(pickDestination({ kind: 'team', orgCount: 1 }, '/onboarding')).toBe('/dashboard');
    expect(pickDestination({ kind: 'dual_context' }, '/onboarding')).toBe('/dashboard');
  });

  test('open-redirect guard: //external blocked, falls back to identity default', () => {
    expect(pickDestination({ kind: 'team', orgCount: 1 }, '//evil.com/path')).toBe('/dashboard');
    expect(pickDestination({ kind: 'stakeholder' }, '//evil.com')).toBe('/portal/projects');
  });

  test('non-rooted path blocked', () => {
    expect(pickDestination({ kind: 'team', orgCount: 1 }, 'not-a-path')).toBe('/dashboard');
  });
});
