import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mocks for action calls (anti-hijack tests). Same shape as edge-cases.test.ts.
vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireAuth: vi.fn(), requireOrgUser: vi.fn() };
});
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-msg', emailEventId: null }),
}));
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { acceptStakeholderInvitation } from '@/actions/stakeholders';
import * as auth from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  buildAcceptedStakeholderFixture,
  buildPendingStakeholderFixture,
  type StakeholderFixture,
} from '../fixtures/stakeholder-fixtures';
import { asAuthUser } from '../helpers/sign-in-fixture';
import { asAnon } from '../helpers/as-anon';

// ─── 1. Anti-hijack: already-accepted token ────────────────────────────────
describe('Anti-hijack: already_accepted', () => {
  let f: StakeholderFixture;
  let mallory: { id: string; email: string };

  beforeAll(async () => {
    f = await buildAcceptedStakeholderFixture('full');
    const ts = Date.now();
    const { data } = await f.service.auth.admin.createUser({
      email: `mallory-acc-${ts}@test.local`,
      password: 'pwM-x9X',
      email_confirm: true,
    });
    mallory = { id: data.user!.id, email: data.user!.email! };
  });
  afterAll(async () => {
    await f.service.auth.admin.deleteUser(mallory.id);
    await f.cleanup();
  });

  it("Mallory using Sarah's already-accepted token → conflict/already_accepted (no email_mismatch leak)", async () => {
    const { data: inv } = await f.service
      .from('invitations')
      .select('token')
      .eq('id', f.invitationId)
      .single();

    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: mallory.id,
        userId: '',
        email: mallory.email,
        password: '',
      }),
    );
    const result = await acceptStakeholderInvitation({ token: inv!.token });
    // already_accepted fires before email_mismatch — the response shape does
    // not reveal the legitimate stakeholder's email.
    expect(result).toMatchObject({ error: 'conflict', reason: 'already_accepted' });

    // Sanity: clients.auth_user_id was NOT changed to mallory.
    const { data: clientRow } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', f.clientId)
      .single();
    expect(clientRow?.auth_user_id).not.toBe(mallory.id);
  });
});

// ─── 2. Anti-hijack: client_already_linked second-line defense ──────────────
describe('Anti-hijack: client_already_linked', () => {
  let f: StakeholderFixture;
  let attacker: { id: string };
  let legitAuthUserId: string;

  beforeAll(async () => {
    f = await buildAcceptedStakeholderFixture('full');

    // Stash the legitimate stakeholder's auth_user_id BEFORE mutation.
    const { data: client } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', f.clientId)
      .single();
    legitAuthUserId = client!.auth_user_id as string;

    // Reset to a re-pendable state (action checks already_accepted before
    // client_already_linked; we need an unaccepted invitation to reach the
    // second-line defense).
    await f.service
      .from('invitations')
      .update({ accepted_at: null })
      .eq('id', f.invitationId);
    await f.service
      .from('project_stakeholders')
      .update({ accepted_at: null })
      .eq('id', f.stakeholderId);

    // Create a separate auth user (the "wrong" link target).
    const ts = Date.now();
    const { data } = await f.service.auth.admin.createUser({
      email: `attacker-cal-${ts}@test.local`,
      password: 'pwAtk-x9X',
      email_confirm: true,
    });
    attacker = { id: data.user!.id };

    // Mutate clients.auth_user_id to point at the attacker — simulates a
    // corrupted-state scenario where some other auth user has already claimed
    // the client identity.
    await f.service
      .from('clients')
      .update({ auth_user_id: attacker.id })
      .eq('id', f.clientId);
  });
  afterAll(async () => {
    await f.service.auth.admin.deleteUser(attacker.id);
    await f.cleanup();
  });

  it('legit stakeholder accepts their own token but clients row is hijacked → conflict/client_already_linked', async () => {
    const { data: inv } = await f.service
      .from('invitations')
      .select('token')
      .eq('id', f.invitationId)
      .single();

    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: legitAuthUserId,
        userId: '',
        email: f.email,
        password: '',
      }),
    );
    const result = await acceptStakeholderInvitation({ token: inv!.token });
    expect(result).toMatchObject({ error: 'conflict', reason: 'client_already_linked' });

    // The clients row's auth_user_id is unchanged (still attacker.id) — the
    // second-line defense did not silently overwrite it.
    const { data: clientRow } = await f.service
      .from('clients')
      .select('auth_user_id')
      .eq('id', f.clientId)
      .single();
    expect(clientRow?.auth_user_id).toBe(attacker.id);
  });
});

// ─── 3. Cross-org email mismatch ────────────────────────────────────────────
describe('Cross-org email mismatch', () => {
  let f: StakeholderFixture;
  let mallory: { id: string; email: string };

  beforeAll(async () => {
    f = await buildPendingStakeholderFixture();
    const ts = Date.now();
    const { data } = await f.service.auth.admin.createUser({
      email: `mallory-em-${ts}@test.local`,
      password: 'pwM-x9X',
      email_confirm: true,
    });
    mallory = { id: data.user!.id, email: data.user!.email! };
  });
  afterAll(async () => {
    await f.service.auth.admin.deleteUser(mallory.id);
    await f.cleanup();
  });

  it("Mallory's auth (different email) on Sarah's pending invitation → not_authorized/email_mismatch", async () => {
    const { data: inv } = await f.service
      .from('invitations')
      .select('token')
      .eq('id', f.invitationId)
      .single();

    vi.mocked(auth.requireAuth).mockResolvedValueOnce(
      asAuthUser({
        authUserId: mallory.id,
        userId: '',
        email: mallory.email,
        password: '',
      }),
    );
    const result = await acceptStakeholderInvitation({ token: inv!.token });
    expect(result).toMatchObject({ error: 'not_authorized', reason: 'email_mismatch' });
  });
});

// ─── 4. Service-role bypasses RLS by design ────────────────────────────────
describe('Service-role bypass intent', () => {
  let f: StakeholderFixture;
  beforeAll(async () => {
    f = await buildAcceptedStakeholderFixture('full');
  });
  afterAll(async () => f.cleanup());

  // This regression test documents the architectural intent: service-role
  // queries bypass RLS, period. A future "harden service-role with RLS"
  // attempt would fail this test loudly. RLS is designed to defend against
  // authenticated-user-level queries; service-role is the trusted backplane
  // that server actions, fixtures, audit logging, and admin tools rely on.
  it('service-role SELECT returns the project (RLS bypassed by design)', async () => {
    const { data, error } = await f.service.from('projects').select('id').eq('id', f.projectId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0].id).toBe(f.projectId);

    // Compare: anon client cannot read the same row (RLS blocks anon).
    const { data: anonData } = await asAnon().from('projects').select('id').eq('id', f.projectId);
    expect(anonData ?? []).toEqual([]);
  });
});

// ─── 5–6. Helper SQL function search_path safety ────────────────────────────
describe('Helper SQL function search_path safety', () => {
  it('auth_user_stakeholder_project_visibility(uuid) has SET search_path', async () => {
    const rows = (await db.execute(
      sql`SELECT proconfig::text AS proconfig FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE p.proname = 'auth_user_stakeholder_project_visibility'
             AND n.nspname = 'public'`,
    )) as unknown as Array<{ proconfig: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0].proconfig, 'auth_user_stakeholder_project_visibility proconfig').toContain(
      'search_path=public, auth, pg_temp',
    );
  });

  it('auth_user_org_project_ids() has SET search_path', async () => {
    const rows = (await db.execute(
      sql`SELECT proconfig::text AS proconfig FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE p.proname = 'auth_user_org_project_ids'
             AND n.nspname = 'public'`,
    )) as unknown as Array<{ proconfig: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0].proconfig, 'auth_user_org_project_ids proconfig').toContain(
      'search_path=public, auth, pg_temp',
    );
  });
});
