import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';
import { assertNotVisible, assertVisibleIds, assertWriteDenied } from './_helpers';

// notifications RLS (migration 0021 §12.6):
// - recipient_type + recipient_id are duck-typed (no FK on recipient_id).
//   SELECT + UPDATE are self-only (mark-read).
// - INSERT + DELETE have NO authenticated policy and are NOT granted to the
//   authenticated role — the dispatcher writes via the Drizzle pooler.
// - Added to supabase_realtime publication in 0021.
//
// Duck-typing safety: a row with recipient_type='client' but recipient_id
// pointing at a users.id row should NOT be visible (lookup falls through
// the wrong branch and returns no match).

describe('notifications RLS', () => {
  let f: TwoOrgFixture;
  let notifAId: string; // recipient = userA
  let notifBId: string; // recipient = userB
  let notifClientAId: string; // recipient = clientA
  let clientAId: string; // client owned by userA (auth-linked)
  let wrongTypeNotifId: string; // recipient_type='client' with userA's userId — duck-type bug

  beforeAll(async () => {
    f = await createTwoOrgFixture();

    // Synthetic client row linked to user A's auth user for the client-branch test.
    clientAId = uuidv7();
    const rnd = Math.random().toString(36).slice(2, 10);
    await f.service.from('clients').insert({
      id: clientAId,
      auth_user_id: f.userA.authUserId,
      email: `notif-client-${rnd}@test.local`,
      name: 'A as client',
    });

    notifAId = uuidv7();
    notifBId = uuidv7();
    notifClientAId = uuidv7();
    wrongTypeNotifId = uuidv7();

    const { error } = await f.service.from('notifications').insert([
      {
        id: notifAId,
        recipient_type: 'user',
        recipient_id: f.userA.userId,
        channel: 'in_app',
        event_type: 'message.new',
        payload: { snippet: 'hello' },
      },
      {
        id: notifBId,
        recipient_type: 'user',
        recipient_id: f.userB.userId,
        channel: 'in_app',
        event_type: 'message.new',
        payload: { snippet: 'b' },
      },
      {
        id: notifClientAId,
        recipient_type: 'client',
        recipient_id: clientAId,
        channel: 'in_app',
        event_type: 'file.uploaded',
        payload: { filename: 'survey.pdf' },
      },
      {
        // Intentionally inconsistent: type=client, id=a users.id.
        // RLS branches by type so this row should be invisible to everyone
        // (the client lookup against users.id returns no match).
        id: wrongTypeNotifId,
        recipient_type: 'client',
        recipient_id: f.userA.userId,
        channel: 'in_app',
        event_type: 'message.new',
        payload: { malformed: true },
      },
    ]);
    if (error) throw new Error(`seed notifications: ${error.message}`);
  });

  afterAll(async () => {
    await f.service
      .from('notifications')
      .delete()
      .in('id', [notifAId, notifBId, notifClientAId, wrongTypeNotifId]);
    await f.service.from('clients').delete().eq('id', clientAId);
    await f.cleanup();
  });

  test('User A sees own user-branch notification, NOT user B', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'notifications',
      { column: 'id', values: [notifAId, notifBId] },
      [notifAId],
      'user A sees only own user-branch notification',
    );
  });

  test('User A sees client-branch notification via auth-linked clients row', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    await assertVisibleIds(
      c,
      'notifications',
      { column: 'id', values: [notifClientAId] },
      [notifClientAId],
      'client-branch notification visible to linked auth user',
    );
  });

  test('User B cannot SELECT user A notification (cross-recipient isolation)', async () => {
    const c = await asUser(f.userB.email, f.userB.password);
    await assertNotVisible(c, 'notifications', notifAId);
  });

  test('Anonymous cannot SELECT any notification', async () => {
    await assertVisibleIds(
      asAnon(),
      'notifications',
      {
        column: 'id',
        values: [notifAId, notifBId, notifClientAId, wrongTypeNotifId],
      },
      [],
      'anon SELECT blocked',
    );
  });

  test('Duck-type safety: recipient_type=client + recipient_id=users.id is invisible to that user', async () => {
    // wrongTypeNotifId has recipient_type='client' but recipient_id is
    // user A's *users.id* (not clientA's clients.id). The client-branch
    // RLS does `recipient_id IN (SELECT auth_user_client_ids())`, which
    // returns clientAId only. So the row is invisible.
    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'notifications', wrongTypeNotifId);
  });

  test('User A can UPDATE own notification read_at (mark-read)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const now = new Date().toISOString();
    const { data, error } = await c
      .from('notifications')
      .update({ read_at: now })
      .eq('id', notifAId)
      .select('id, read_at');
    expect(error).toBeNull();
    expect(data?.[0]?.id).toBe(notifAId);
    expect(data?.[0]?.read_at).not.toBeNull();

    // Reset so subsequent tests start clean.
    await f.service.from('notifications').update({ read_at: null }).eq('id', notifAId);
  });

  test('User B cannot UPDATE user A notification (cross-recipient)', async () => {
    const c = await asUser(f.userB.email, f.userB.password);
    await assertWriteDenied(
      () =>
        c
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', notifAId)
          .select('id'),
      'user B cannot mark user A notification read',
      async () => {
        const { data } = await f.service
          .from('notifications')
          .select('read_at')
          .eq('id', notifAId)
          .single();
        expect(data?.read_at).toBeNull();
      },
    );
  });

  test('Authenticated user cannot INSERT a notification (no policy + no GRANT)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const newId = uuidv7();
    const { data, error } = await c
      .from('notifications')
      .insert({
        id: newId,
        recipient_type: 'user',
        recipient_id: f.userA.userId,
        channel: 'in_app',
        event_type: 'message.new',
        payload: {},
      })
      .select('id');
    expect(data ?? []).toEqual([]);
    if (error) {
      // 42501 (permission denied) is expected — no GRANT INSERT on
      // notifications for the authenticated role. PGRST code surfaces
      // similarly via PostgREST.
      expect(error.code).toMatch(/42501|PGRST/);
    }

    // Confirm nothing actually landed.
    const { data: check } = await f.service
      .from('notifications')
      .select('id')
      .eq('id', newId);
    expect(check ?? []).toEqual([]);
  });

  test('Soft-deleted user loses access to own notifications', async () => {
    await f.service
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.userA.userId);

    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'notifications', notifAId);

    // Restore.
    await f.service.from('users').update({ deleted_at: null }).eq('id', f.userA.userId);
  });

  test('Soft-deleted client loses access to client-branch notifications', async () => {
    await f.service
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', clientAId);

    const c = await asUser(f.userA.email, f.userA.password);
    await assertNotVisible(c, 'notifications', notifClientAId);

    // Restore.
    await f.service.from('clients').update({ deleted_at: null }).eq('id', clientAId);
  });
});
