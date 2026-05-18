import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createConversationFixture,
  type ConversationsFixture,
} from '../fixtures/with-conversations';
import { asAuthUser } from '../helpers/sign-in-fixture';

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

// DEBT-021: stub the Upstash limiter so the existing message tests don't hit
// real Redis once sendMessage/editMessage call rateLimit(). Default = not
// limited; the rate-limit tests override per-call with mockResolvedValueOnce.
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));

import { deleteMessage, editMessage, sendMessage } from '@/actions/messages';
import * as auth from '@/lib/auth/requireAuth';
import * as ratelimit from '@/lib/ratelimit';

describe('sendMessage', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    vi.mocked(ratelimit.rateLimit)
      .mockReset()
      .mockResolvedValue({ limited: false, retryAfterSec: 0 });
  });

  test('happy path: org user sends a message', async () => {
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: 'Hello from test',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    const { data } = await f.service
      .from('messages')
      .select('id, body, sender_type, sender_id')
      .eq('id', result.data.messageId)
      .single();
    expect(data?.body).toBe('Hello from test');
    expect(data?.sender_type).toBe('user');
    expect(data?.sender_id).toBe(f.userA.userId);

    await f.service.from('messages').delete().eq('id', result.data.messageId);
  });

  test('validation: empty body rejected', async () => {
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: '   ',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('validation: 10001-char body rejected', async () => {
    const tooLong = 'x'.repeat(10001);
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: tooLong,
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  test('boundary: 10000-char body accepted', async () => {
    const justRight = 'x'.repeat(10000);
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: justRight,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    await f.service.from('messages').delete().eq('id', result.data.messageId);
  });

  test('non-participant returns not_authorized', async () => {
    // Use userB calling against orgAConversation.
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userB));
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: 'Cross-org attempt',
    });
    // userB has no users row in orgA → no_identity OR not_a_participant
    expect('error' in result).toBe(true);
  });

  test('attachments must be empty in Session 9', async () => {
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: 'with attachment',
      attachments: [{ name: 'fake.pdf' }],
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });

  // DEBT-021: rate-limit-hit path. Global cap clears; the per-conversation cap
  // trips → action returns the rate_limited shape, keyed under send_message:*.
  test('rate-limited send returns { error: rate_limited }', async () => {
    vi.mocked(ratelimit.rateLimit)
      .mockResolvedValueOnce({ limited: false, retryAfterSec: 0 }) // message (global)
      .mockResolvedValueOnce({ limited: true, retryAfterSec: 42 }); // messageConversation
    const result = await sendMessage({
      conversationId: f.ext.orgAConversation.id,
      body: 'flood',
    });
    expect(result).toEqual({ error: 'rate_limited', reason: 'retry_after_42s' });
    expect(ratelimit.rateLimit).toHaveBeenCalledWith(
      'messageConversation',
      `send_message:user:${f.userA.authUserId}:conv:${f.ext.orgAConversation.id}`,
    );
  });
});

describe('editMessage', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    vi.mocked(ratelimit.rateLimit)
      .mockReset()
      .mockResolvedValue({ limited: false, retryAfterSec: 0 });
  });

  test('happy path: sender edits own message', async () => {
    const result = await editMessage({
      messageId: f.ext.orgAMessage.id,
      body: 'Edited text',
    });
    expect('error' in result).toBe(false);

    const { data } = await f.service
      .from('messages')
      .select('body, edited_at')
      .eq('id', f.ext.orgAMessage.id)
      .single();
    expect(data?.body).toBe('Edited text');
    expect(data?.edited_at).not.toBeNull();

    await f.service
      .from('messages')
      .update({ body: 'Hello from Org A', edited_at: null })
      .eq('id', f.ext.orgAMessage.id);
  });

  test('non-sender cannot edit', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userB));
    const result = await editMessage({
      messageId: f.ext.orgAMessage.id,
      body: 'PWNED',
    });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('cannot edit deleted message', async () => {
    await f.service
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.ext.orgAMessage.id);

    const result = await editMessage({
      messageId: f.ext.orgAMessage.id,
      body: 'after delete',
    });
    expect(result).toMatchObject({ error: 'conflict' });

    await f.service
      .from('messages')
      .update({ deleted_at: null })
      .eq('id', f.ext.orgAMessage.id);
  });

  // DEBT-021: rate-limit-hit path. The per-user global edit cap trips on the
  // first check, keyed under the edit_message:* prefix (separate from sends).
  test('rate-limited edit returns { error: rate_limited }', async () => {
    vi.mocked(ratelimit.rateLimit).mockResolvedValueOnce({
      limited: true,
      retryAfterSec: 30,
    });
    const result = await editMessage({
      messageId: f.ext.orgAMessage.id,
      body: 'flood edit',
    });
    expect(result).toEqual({ error: 'rate_limited', reason: 'retry_after_30s' });
    expect(ratelimit.rateLimit).toHaveBeenCalledWith(
      'message',
      `edit_message:user:${f.userA.authUserId}`,
    );
  });
});

describe('deleteMessage', () => {
  let f: ConversationsFixture;

  beforeAll(async () => {
    f = await createConversationFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userA));
    vi.mocked(ratelimit.rateLimit)
      .mockReset()
      .mockResolvedValue({ limited: false, retryAfterSec: 0 });
  });

  test('happy path: sender soft-deletes own message', async () => {
    const result = await deleteMessage({ messageId: f.ext.orgAMessage.id });
    expect('error' in result).toBe(false);

    const { data } = await f.service
      .from('messages')
      .select('deleted_at, body')
      .eq('id', f.ext.orgAMessage.id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
    // Body remains in DB; UI/query layer renders '[deleted]'.
    expect(data?.body).toBe('Hello from Org A');

    await f.service
      .from('messages')
      .update({ deleted_at: null })
      .eq('id', f.ext.orgAMessage.id);
  });

  test('non-sender cannot delete', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue(asAuthUser(f.userB));
    const result = await deleteMessage({ messageId: f.ext.orgAMessage.id });
    expect(result).toMatchObject({ error: 'not_authorized' });
  });

  test('already-deleted returns conflict', async () => {
    await f.service
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', f.ext.orgAMessage.id);

    const result = await deleteMessage({ messageId: f.ext.orgAMessage.id });
    expect(result).toMatchObject({ error: 'conflict' });

    await f.service
      .from('messages')
      .update({ deleted_at: null })
      .eq('id', f.ext.orgAMessage.id);
  });
});
