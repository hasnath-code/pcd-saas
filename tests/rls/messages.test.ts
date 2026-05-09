import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createConversationFixture,
  type ConversationsFixture,
} from '../fixtures/with-conversations';

describe('messages RLS', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A SELECT sees only their org conversation messages', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('messages')
      .select('id, conversation_id')
      .in('id', [f.ext.orgAMessage.id, f.ext.orgBMessage.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([f.ext.orgAMessage.id]);
  });

  test('Stakeholder sees messages in conversations they participate in', async () => {
    const c = await asUser(
      f.ext.orgAClientAuth.email,
      f.ext.orgAClientAuth.password,
    );
    const { data } = await c
      .from('messages')
      .select('id')
      .in('id', [f.ext.orgAMessage.id, f.ext.orgBMessage.id]);
    expect((data ?? []).map((r) => r.id)).toEqual([f.ext.orgAMessage.id]);
  });

  test('Anonymous cannot SELECT any message', async () => {
    const a = asAnon();
    const { data } = await a
      .from('messages')
      .select('id')
      .in('id', [f.ext.orgAMessage.id, f.ext.orgBMessage.id]);
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot INSERT message in Org B conversation', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('messages')
      .insert({
        id: uuidv7(),
        conversation_id: f.ext.orgBConversation.id,
        sender_type: 'user',
        sender_id: f.userA.userId,
        body: 'Cross-org attempt',
      })
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('User A can INSERT message in their own org conversation', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const id = uuidv7();
    const { data, error } = await c
      .from('messages')
      .insert({
        id,
        conversation_id: f.ext.orgAConversation.id,
        sender_type: 'user',
        sender_id: f.userA.userId,
        body: 'Reply from user A',
      })
      .select();
    expect(error).toBeNull();
    expect(data?.[0]?.id).toBe(id);
    await f.service.from('messages').delete().eq('id', id);
  });

  test('User A cannot impersonate User B as sender', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('messages')
      .insert({
        id: uuidv7(),
        conversation_id: f.ext.orgAConversation.id,
        sender_type: 'user',
        sender_id: f.userB.userId,
        body: 'Forged sender',
      })
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('Authenticated cannot INSERT system message', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('messages')
      .insert({
        id: uuidv7(),
        conversation_id: f.ext.orgAConversation.id,
        sender_type: 'system',
        sender_id: null,
        body: 'I am the system',
      })
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot UPDATE another user message body', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('messages')
      .update({ body: 'PWNED' })
      .eq('id', f.ext.orgBMessage.id)
      .select();
    expect(data ?? []).toEqual([]);

    const { data: row } = await f.service
      .from('messages')
      .select('body')
      .eq('id', f.ext.orgBMessage.id)
      .single();
    expect(row?.body).toBe('Hello from Org B');
  });

  test('User A can UPDATE own message (edit)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('messages')
      .update({ body: 'Edited from user A', edited_at: new Date().toISOString() })
      .eq('id', f.ext.orgAMessage.id)
      .select();
    expect(error).toBeNull();
    expect(data?.[0]?.body).toBe('Edited from user A');

    await f.service
      .from('messages')
      .update({ body: 'Hello from Org A', edited_at: null })
      .eq('id', f.ext.orgAMessage.id);
  });

  test('Soft-deleted messages still visible (Q6 — UI renders [deleted])', async () => {
    await f.service
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.ext.orgAMessage.id);

    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('messages')
      .select('id, body, deleted_at')
      .eq('id', f.ext.orgAMessage.id);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.deleted_at).not.toBeNull();
    // Body remains in DB; UI/query layer projects to '[deleted]'.
    expect(data?.[0]?.body).toBe('Hello from Org A');

    await f.service
      .from('messages')
      .update({ deleted_at: null })
      .eq('id', f.ext.orgAMessage.id);
  });

  test('Stakeholder can INSERT message when can_message=true', async () => {
    const c = await asUser(
      f.ext.orgAClientAuth.email,
      f.ext.orgAClientAuth.password,
    );
    const id = uuidv7();
    const { data, error } = await c
      .from('messages')
      .insert({
        id,
        conversation_id: f.ext.orgAConversation.id,
        sender_type: 'client',
        sender_id: f.extras.orgAClient.id,
        body: 'Reply from stakeholder',
      })
      .select();
    expect(error).toBeNull();
    expect(data?.[0]?.id).toBe(id);
    await f.service.from('messages').delete().eq('id', id);
  });

  test('Stakeholder INSERT fails when can_message=false', async () => {
    // Flip can_message=false then attempt.
    await f.service
      .from('project_stakeholders')
      .update({ can_message: false })
      .eq('client_id', f.extras.orgAClient.id)
      .eq('project_id', f.extras.orgAProject.id);

    const c = await asUser(
      f.ext.orgAClientAuth.email,
      f.ext.orgAClientAuth.password,
    );
    const { data } = await c
      .from('messages')
      .insert({
        id: uuidv7(),
        conversation_id: f.ext.orgAConversation.id,
        sender_type: 'client',
        sender_id: f.extras.orgAClient.id,
        body: 'Should be blocked',
      })
      .select();
    expect(data ?? []).toEqual([]);

    // Restore.
    await f.service
      .from('project_stakeholders')
      .update({ can_message: true })
      .eq('client_id', f.extras.orgAClient.id)
      .eq('project_id', f.extras.orgAProject.id);
  });
});
