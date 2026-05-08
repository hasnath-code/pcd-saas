import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asAnon } from '../helpers/as-anon';
import { asUser } from '../helpers/as-user';
import {
  createConversationFixture,
  type ConversationsFixture,
} from '../fixtures/with-conversations';

describe('conversations RLS', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });

  test('User A SELECT sees only Org A conversation', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c
      .from('conversations')
      .select('id, org_id')
      .in('id', [f.ext.orgAConversation.id, f.ext.orgBConversation.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([f.ext.orgAConversation.id]);
  });

  test('User A cannot UPDATE Org B conversation', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversations')
      .update({ name: 'PWNED' })
      .eq('id', f.ext.orgBConversation.id)
      .select();
    expect(data ?? []).toEqual([]);

    const { data: row } = await f.service
      .from('conversations')
      .select('name')
      .eq('id', f.ext.orgBConversation.id)
      .single();
    expect(row?.name).not.toBe('PWNED');
  });

  test('User A cannot DELETE Org B conversation', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversations')
      .delete()
      .eq('id', f.ext.orgBConversation.id)
      .select();
    expect(data ?? []).toEqual([]);

    const { data: row } = await f.service
      .from('conversations')
      .select('id')
      .eq('id', f.ext.orgBConversation.id)
      .single();
    expect(row?.id).toBe(f.ext.orgBConversation.id);
  });

  test('Soft-deleted conversation hidden from default SELECT', async () => {
    const { error: delErr } = await f.service
      .from('conversations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.ext.orgAConversation.id);
    expect(delErr).toBeNull();

    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversations')
      .select('id')
      .eq('id', f.ext.orgAConversation.id);
    expect(data ?? []).toEqual([]);

    await f.service
      .from('conversations')
      .update({ deleted_at: null })
      .eq('id', f.ext.orgAConversation.id);
  });

  test('Anonymous cannot SELECT any conversation', async () => {
    const a = asAnon();
    const { data } = await a
      .from('conversations')
      .select('id')
      .in('id', [f.ext.orgAConversation.id, f.ext.orgBConversation.id]);
    expect(data ?? []).toEqual([]);
  });

  test('Stakeholder sees conversations they participate in', async () => {
    const c = await asUser(
      f.ext.orgAClientAuth.email,
      f.ext.orgAClientAuth.password,
    );
    const { data, error } = await c
      .from('conversations')
      .select('id')
      .in('id', [f.ext.orgAConversation.id, f.ext.orgBConversation.id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([f.ext.orgAConversation.id]);
  });

  test('Non-org-admin cannot INSERT conversation in another org', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c
      .from('conversations')
      .insert({
        id: '00000000-0000-7000-8000-000000000099',
        org_id: f.orgB.id,
        type: 'group',
        name: 'Cross-org attempt',
        created_by: f.userA.userId,
      })
      .select();
    expect(data ?? []).toEqual([]);
  });
});
