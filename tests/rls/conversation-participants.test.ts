import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createConversationFixture,
  type ConversationsFixture,
} from '../fixtures/with-conversations';

describe('conversation_participants RLS', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A sees own org participants only', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversation_participants')
      .select('id, conversation_id')
      .in('id', [f.ext.orgAConversation.participantId, f.ext.orgBConversation.participantId]);
    expect((data ?? []).map((r) => r.id)).toEqual([
      f.ext.orgAConversation.participantId,
    ]);
  });

  test('Anonymous sees no participants', async () => {
    const a = asAnon();
    const { data } = await a
      .from('conversation_participants')
      .select('id')
      .in('id', [f.ext.orgAConversation.participantId, f.ext.orgBConversation.participantId]);
    expect(data ?? []).toEqual([]);
  });

  test('Self can UPDATE last_read_at on own row', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const now = new Date().toISOString();
    const { data, error } = await c
      .from('conversation_participants')
      .update({ last_read_at: now })
      .eq('id', f.ext.orgAConversation.participantId)
      .select();
    expect(error).toBeNull();
    expect(data?.length).toBe(1);

    await f.service
      .from('conversation_participants')
      .update({ last_read_at: null })
      .eq('id', f.ext.orgAConversation.participantId);
  });

  test('User A cannot UPDATE Org B participant row', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('id', f.ext.orgBConversation.participantId)
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot INSERT participant in Org B conversation', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversation_participants')
      .insert({
        id: uuidv7(),
        conversation_id: f.ext.orgBConversation.id,
        participant_type: 'user',
        participant_id: f.userA.userId,
      })
      .select();
    expect(data ?? []).toEqual([]);
  });

  test('Soft-leave (left_at IS NOT NULL) hides participant row', async () => {
    await f.service
      .from('conversation_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('id', f.ext.orgAConversation.participantId);

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversation_participants')
      .select('id')
      .eq('id', f.ext.orgAConversation.participantId);
    expect(data ?? []).toEqual([]);

    await f.service
      .from('conversation_participants')
      .update({ left_at: null })
      .eq('id', f.ext.orgAConversation.participantId);
  });
});
