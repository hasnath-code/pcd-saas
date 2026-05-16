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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  addConversationParticipant,
  createGroupConversation,
  markConversationRead,
  removeConversationParticipant,
} from '@/actions/conversations';
import {
  getConversationDetail,
  listMessagesForConversation,
} from '@/db/queries/conversations';
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
  let secondUser: { userId: string; authUserId: string };

  beforeAll(async () => {
    f = await createConversationFixture();
    // Add a second org-A user we can add to the conversation. users.auth_user_id
    // has a FK to auth.users, so we need a real auth user — same pattern as
    // tests/fixtures/two-orgs.ts:79+.
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const email = `second-${ts}-${rnd}@test.local`;
    const password = `pwSecond-${ts}-${rnd}-x9X`;
    const { data: authDat, error: authErr } = await f.service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr || !authDat?.user) {
      throw new Error(`fixture: secondUser auth createUser: ${authErr?.message ?? 'no user'}`);
    }
    const id = uuidv7();
    const { error: insertErr } = await f.service.from('users').insert({
      id,
      auth_user_id: authDat.user.id,
      org_id: f.orgA.id,
      email,
      name: 'Second teammate',
      role: 'member',
    });
    if (insertErr) {
      throw new Error(`fixture: secondUser users insert: ${insertErr.message}`);
    }
    secondUser = { userId: id, authUserId: authDat.user.id };
  });
  afterAll(async () => {
    await f.service.from('users').delete().eq('id', secondUser.userId);
    await f.service.auth.admin.deleteUser(secondUser.authUserId);
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

// ─── DEBT-060/061: query-layer viewer gate ───────────────────────────────────
// getConversationDetail + listMessagesForConversation take an explicit viewer.
// The Drizzle pooler bypasses RLS, so these tests pin the gate at the query
// layer: org viewers keep the transparency model (see any conversation in their
// org, participant or not — the regression a participant-only gate would have
// introduced); stakeholder viewers see only conversations they participate in.

describe('getConversationDetail — viewer gate (DEBT-060)', () => {
  let f: ConversationsFixture;
  // An extra Org A conversation with NO org-user participant — proves the org
  // transparency model: an org viewer reads it despite not participating.
  const orphanConvId = uuidv7();

  beforeAll(async () => {
    f = await createConversationFixture();
    await f.service.from('conversations').insert({
      id: orphanConvId,
      org_id: f.orgA.id,
      type: 'general',
      name: 'Org A — no org-user participant',
      created_by: f.userA.userId,
    });
  });
  afterAll(async () => {
    await f.service.from('conversations').delete().eq('id', orphanConvId);
    await f.cleanup();
  });

  test('org viewer reads an in-org conversation they do not participate in', async () => {
    // userA is NOT a participant of orphanConvId — the transparency model still
    // grants visibility. A participant-only gate here would 404.
    const detail = await getConversationDetail(orphanConvId, {
      kind: 'org',
      orgId: f.orgA.id,
    });
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(orphanConvId);
  });

  test('stakeholder viewer is gated to conversations they participate in', async () => {
    const clientId = f.extras.orgAClient.id;
    // orgAClient IS a participant of orgAConversation → visible.
    const visible = await getConversationDetail(f.ext.orgAConversation.id, {
      kind: 'stakeholder',
      clientId,
    });
    expect(visible?.id).toBe(f.ext.orgAConversation.id);
    // orgAClient is NOT a participant of orgBConversation (another org) → null,
    // even via a direct pooler query that bypasses RLS.
    const blocked = await getConversationDetail(f.ext.orgBConversation.id, {
      kind: 'stakeholder',
      clientId,
    });
    expect(blocked).toBeNull();
  });
});

describe('listMessagesForConversation — viewer gate (DEBT-061)', () => {
  let f: ConversationsFixture;
  const orphanConvId = uuidv7();
  const orphanMessageId = uuidv7();

  beforeAll(async () => {
    f = await createConversationFixture();
    await f.service.from('conversations').insert({
      id: orphanConvId,
      org_id: f.orgA.id,
      type: 'general',
      name: 'Org A — no org-user participant',
      created_by: f.userA.userId,
    });
    await f.service.from('messages').insert({
      id: orphanMessageId,
      conversation_id: orphanConvId,
      sender_type: 'user',
      sender_id: f.userA.userId,
      body: 'Visible to the org via the transparency model.',
    });
  });
  afterAll(async () => {
    await f.service.from('conversations').delete().eq('id', orphanConvId);
    await f.cleanup();
  });

  test('org viewer reads messages of an in-org conversation they do not participate in', async () => {
    const rows = await listMessagesForConversation(orphanConvId, {
      kind: 'org',
      orgId: f.orgA.id,
    });
    expect(rows.map((r) => r.id)).toContain(orphanMessageId);
  });

  test('stakeholder viewer is gated to conversations they participate in', async () => {
    const clientId = f.extras.orgAClient.id;
    // Participant of orgAConversation → sees its messages.
    const visible = await listMessagesForConversation(f.ext.orgAConversation.id, {
      kind: 'stakeholder',
      clientId,
    });
    expect(visible.map((r) => r.id)).toContain(f.ext.orgAMessage.id);
    // Non-participant of another org's conversation → no rows.
    const blocked = await listMessagesForConversation(f.ext.orgBConversation.id, {
      kind: 'stakeholder',
      clientId,
    });
    expect(blocked).toEqual([]);
  });
});
