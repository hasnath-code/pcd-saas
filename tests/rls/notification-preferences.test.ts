import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { assertNotVisible, assertVisibleIds, assertWriteDenied } from './_helpers';

// notification_preferences RLS (migration 0020 §12.5):
// - SELECT / INSERT / UPDATE / DELETE all self-only (per-command, ADR-016).
// - XOR CHECK: exactly one of user_id / client_id is set.
// - UNIQUE (user_id, channel, event_type) + UNIQUE (client_id, channel, event_type).
//   Postgres NULLS DISTINCT default means these don't constrain each other.
// - No deleted_at column — preferences CASCADE with parent user/client.
//
// Writes hit RLS via the authenticated REST role in these tests (defense-in-depth).
// Production seeding goes through the Drizzle pooler (postgres, RLS bypassed).

describe('notification_preferences RLS', () => {
  let f: TwoOrgFixture;
  let prefAId: string; // user A's pref row
  let prefBId: string; // user B's pref row
  let clientAId: string; // client owned (auth-linked) by user A — synthetic
  let prefClientAId: string; // pref row attached to clientA

  beforeAll(async () => {
    f = await createTwoOrgFixture();

    // Seed: one pref row per user via service role.
    prefAId = uuidv7();
    prefBId = uuidv7();
    const { error: prefErr } = await f.service
      .from('notification_preferences')
      .insert([
        {
          id: prefAId,
          user_id: f.userA.userId,
          channel: 'email',
          event_type: 'message.new',
          enabled: true,
        },
        {
          id: prefBId,
          user_id: f.userB.userId,
          channel: 'email',
          event_type: 'message.new',
          enabled: true,
        },
      ]);
    if (prefErr) throw new Error(`seed prefs: ${prefErr.message}`);

    // Synthetic clients row linked to user A's auth user, so the
    // client-branch RLS test can assert that auth.uid() reaches the right
    // identity (no project_stakeholders / memberships needed for prefs RLS).
    clientAId = uuidv7();
    const rnd = Math.random().toString(36).slice(2, 10);
    await f.service.from('clients').insert({
      id: clientAId,
      auth_user_id: f.userA.authUserId,
      email: `pref-client-${rnd}@test.local`,
      name: 'A as client',
    });
    prefClientAId = uuidv7();
    await f.service.from('notification_preferences').insert({
      id: prefClientAId,
      client_id: clientAId,
      channel: 'in_app',
      event_type: 'file.uploaded',
      enabled: true,
    });
  });

  afterAll(async () => {
    await f.service
      .from('notification_preferences')
      .delete()
      .in('id', [prefAId, prefBId, prefClientAId]);
    await f.service.from('clients').delete().eq('id', clientAId);
    await f.cleanup();
  });

  test('User A sees own pref, NOT User B pref (self-only SELECT)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'notification_preferences',
      { column: 'id', values: [prefAId, prefBId] },
      [prefAId],
      'user A sees own pref only',
    );
  });

  test('User A sees client-branch pref via their auth-linked clients row', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'notification_preferences',
      { column: 'id', values: [prefClientAId] },
      [prefClientAId],
      'client-branch pref visible to linked auth user',
    );
  });

  test('User B cannot SELECT user A pref (cross-identity)', async () => {
    const c = await asUser(f.userB.email, f.userB.password);
    await assertNotVisible(c, 'notification_preferences', prefAId);
  });

  test('Anonymous cannot SELECT any preference', async () => {
    await assertVisibleIds(
      asAnon(),
      'notification_preferences',
      { column: 'id', values: [prefAId, prefBId, prefClientAId] },
      [],
      'anon SELECT blocked',
    );
  });

  test('XOR CHECK rejects row with both user_id AND client_id set', async () => {
    const id = uuidv7();
    const { error } = await f.service.from('notification_preferences').insert({
      id,
      user_id: f.userA.userId,
      client_id: clientAId,
      channel: 'email',
      event_type: 'project.stage_changed',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/notification_preferences_owner_xor|check constraint/i);
  });

  test('XOR CHECK rejects row with NEITHER user_id NOR client_id set', async () => {
    const id = uuidv7();
    const { error } = await f.service.from('notification_preferences').insert({
      id,
      user_id: null,
      client_id: null,
      channel: 'email',
      event_type: 'project.stage_changed',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/notification_preferences_owner_xor|check constraint|null/i);
  });

  test('UNIQUE (user_id, channel, event_type) rejects duplicate via service role', async () => {
    const dupeId = uuidv7();
    const { error } = await f.service.from('notification_preferences').insert({
      id: dupeId,
      user_id: f.userA.userId,
      channel: 'email',
      event_type: 'message.new', // same triple as prefAId
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/duplicate key|notification_preferences_user_channel_event_uniq/i);
  });

  test('User A can UPDATE own pref (toggle off)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('notification_preferences')
      .update({ enabled: false })
      .eq('id', prefAId)
      .select('id, enabled');
    expect(error).toBeNull();
    expect(data?.[0]?.enabled).toBe(false);

    // Restore so other tests start from a known state.
    await f.service
      .from('notification_preferences')
      .update({ enabled: true })
      .eq('id', prefAId);
  });

  test('User B cannot UPDATE User A pref', async () => {
    const c = await asUser(f.userB.email, f.userB.password);
    await assertWriteDenied(
      () =>
        c
          .from('notification_preferences')
          .update({ enabled: false })
          .eq('id', prefAId)
          .select('id'),
      'user B cannot update user A pref',
      async () => {
        const { data } = await f.service
          .from('notification_preferences')
          .select('enabled')
          .eq('id', prefAId)
          .single();
        expect(data?.enabled).toBe(true);
      },
    );
  });

  test('Soft-deleted user loses access to own prefs', async () => {
    await f.service
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.userA.userId);

    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'notification_preferences', prefAId);

    // Restore.
    await f.service.from('users').update({ deleted_at: null }).eq('id', f.userA.userId);
  });
});
