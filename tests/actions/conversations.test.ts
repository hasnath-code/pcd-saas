import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createConversationFixture,
  type ConversationsFixture,
} from '../fixtures/with-conversations';
import {
  asAuthUser,
  asOrgAdminContext,
  asOrgUserContext,
} from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgUser: vi.fn(),
    requireOrgAdmin: vi.fn(),
  };
});

import {
  addConversationParticipant,
  createGroupConversation,
  markConversationRead,
  removeConversationParticipant,
} from '@/actions/conversations';
import * as auth from '@/lib/auth/requireAuth';

describe('createGroupConversation', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(
      asOrgAdminContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('happy path: creates conversation + participants atomically', async () => {
    const result = await createGroupConversation({
      projectId: f.extras.orgAProject.id,
      name: 'Plan review',
      participantUserIds: [],
      participantClientIds: [f.extras.orgAClient.id],
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const id = result.data.conversationId;

    const { data: conv } = await f.service
      .from('conversations')
      .select('id, type, name, project_id')
      .eq('id', id)
      .single();
    expect(conv?.type).toBe('group');
    expect(conv?.name).toBe('Plan review');

    const { data: parts } = await f.service
      .from('conversation_participants')
      .select('participant_type, participant_id')
      .eq('conversation_id', id);
    expect(parts?.length).toBeGreaterThanOrEqual(2);
    expect(
      (parts ?? []).some(
        (p) => p.participant_type === 'user' && p.participant_id === f.userA.userId,
      ),
    ).toBe(true);
    expect(
      (parts ?? []).some(
        (p) => p.participant_type === 'client' && p.participant_id === f.extras.orgAClient.id,
      ),
    ).toBe(true);

    await f.service.from('conversations').delete().eq('id', id);
  });

  test('cross-org user participant rejected', async () => {
    const result = await createGroupConversation({
      projectId: null,
      name: 'Cross attempt',
      participantUserIds: [f.userB.userId],
      participantClientIds: [],
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('cross-org client participant rejected', async () => {
    const result = await createGroupConversation({
      projectId: null,
      name: 'Cross attempt 2',
      participantUserIds: [],
      participantClientIds: [f.extras.orgBClient.id],
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('validation: empty name → validation_error', async () => {
    const result = await createGroupConversation({
      projectId: null,
      name: '   ',
      participantUserIds: [],
      participantClientIds: [],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });
});

describe('addConversationParticipant', () => {
  let f: ConversationsFixture;
  let secondUser: { userId: string };

  beforeAll(async () => {
    f = await createConversationFixture();
    // Add a second org-A user we can add to the conversation.
    const id = uuidv7();
    await f.service.from('users').insert({
      id,
      auth_user_id: uuidv7(),
      org_id: f.orgA.id,
      email: `second-${Date.now()}@test.local`,
      name: 'Second teammate',
      role: 'member',
    });
    secondUser = { userId: id };
  });
  afterAll(async () => {
    await f.service.from('users').delete().eq('id', secondUser.userId);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(
      asOrgAdminContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('adds participant + emits system message in same tx', async () => {
    const result = await addConversationParticipant({
      conversationId: f.ext.orgAConversation.id,
      participantType: 'user',
      participantId: secondUser.userId,
    });
    expect('error' in result).toBe(false);

    const { data: parts } = await f.service
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('participant_type', 'user')
      .eq('participant_id', secondUser.userId);
    expect(parts?.length).toBe(1);

    const { data: sysMsgs } = await f.service
      .from('messages')
      .select('id, body, sender_type')
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('sender_type', 'system');
    expect(sysMsgs?.length).toBeGreaterThanOrEqual(1);
    expect(sysMsgs?.[0].body).toMatch(/added to the conversation/);

    // Cleanup the inserted participant + system message for follow-up tests.
    await f.service
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('participant_type', 'user')
      .eq('participant_id', secondUser.userId);
    await f.service
      .from('messages')
      .delete()
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('sender_type', 'system');
  });

  test('cross-org conversation returns not_found', async () => {
    const result = await addConversationParticipant({
      conversationId: f.ext.orgBConversation.id,
      participantType: 'user',
      participantId: secondUser.userId,
    });
    expect(result).toMatchObject({ error: 'not_found' });
  });

  test('already-active participant returns conflict', async () => {
    const result = await addConversationParticipant({
      conversationId: f.ext.orgAConversation.id,
      participantType: 'user',
      participantId: f.userA.userId,
    });
    expect(result).toMatchObject({ error: 'conflict' });
  });
});

describe('removeConversationParticipant', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgAdmin).mockResolvedValue(
      asOrgAdminContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('sets left_at + emits system message', async () => {
    const result = await removeConversationParticipant({
      conversationId: f.ext.orgAConversation.id,
      participantType: 'client',
      participantId: f.extras.orgAClient.id,
    });
    expect('error' in result).toBe(false);

    const { data: parts } = await f.service
      .from('conversation_participants')
      .select('left_at')
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('participant_type', 'client')
      .eq('participant_id', f.extras.orgAClient.id)
      .single();
    expect(parts?.left_at).not.toBeNull();

    const { data: sysMsgs } = await f.service
      .from('messages')
      .select('body')
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('sender_type', 'system');
    expect(sysMsgs?.some((m) => /removed from the conversation/.test(m.body))).toBe(true);

    // Restore participant for other tests.
    await f.service
      .from('conversation_participants')
      .update({ left_at: null })
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('participant_type', 'client')
      .eq('participant_id', f.extras.orgAClient.id);
    await f.service
      .from('messages')
      .delete()
      .eq('conversation_id', f.ext.orgAConversation.id)
      .eq('sender_type', 'system');
  });
});

describe('markConversationRead', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
  });

  test('updates last_read_at on caller participant row', async () => {
    const result = await markConversationRead({
      conversationId: f.ext.orgAConversation.id,
    });
    expect('error' in result).toBe(false);

    const { data } = await f.service
      .from('conversation_participants')
      .select('last_read_at')
      .eq('id', f.ext.orgAConversation.participantId)
      .single();
    expect(data?.last_read_at).not.toBeNull();
  });

  test('non-existent conversation returns not_found', async () => {
    const result = await markConversationRead({
      conversationId: '00000000-0000-7000-8000-000000000000',
    });
    expect(result).toMatchObject({ error: 'not_found' });
  });
});
