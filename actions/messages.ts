'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AuthError,
  requireAuth,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clients,
  conversationParticipants,
  conversations,
  messages,
  users,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';

export type MessageActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

// Body validation per Decision 9.5A: 1..10000 characters after trim. Markdown
// is rendered safely at the UI layer (react-markdown + rehype-sanitize). The
// action layer doesn't sanitize — body is stored as-is.
const BODY_MIN = 1;
const BODY_MAX = 10000;

// ─── Internal: resolve sender identity from auth.uid() + conversation.org_id ─

type SenderIdentity =
  | { participantType: 'user'; participantId: string }
  | { participantType: 'client'; participantId: string };

async function resolveSenderIdentity(
  authUserId: string,
  orgId: string,
): Promise<SenderIdentity | null> {
  // Prefer org-user identity in the conversation's org.
  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.authUserId, authUserId),
        eq(users.orgId, orgId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (userRow.length > 0) {
    return { participantType: 'user', participantId: userRow[0].id };
  }
  // Fall back to stakeholder identity. clients.auth_user_id is set during
  // acceptStakeholderInvitation. clients are globally unique by email/auth.
  const clientRow = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.authUserId, authUserId), isNull(clients.deletedAt)))
    .limit(1);
  if (clientRow.length > 0) {
    return { participantType: 'client', participantId: clientRow[0].id };
  }
  return null;
}

// ─── sendMessage ─────────────────────────────────────────────────────────────

const SendMessageInput = z.object({
  conversationId: z.string().uuid(),
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(BODY_MIN, 'Message cannot be empty')
        .max(BODY_MAX, `Message exceeds ${BODY_MAX} characters`),
    ),
  // Phase 1c S9: attachments are reserved for Session 10 (file uploads). Empty
  // array enforced by Zod default — anything else is rejected.
  attachments: z.array(z.unknown()).max(0).default([]),
});

export async function sendMessage(
  input: unknown,
): Promise<MessageActionResult<{ messageId: string }>> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = SendMessageInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { conversationId, body } = parsed.data;

  const conv = await db
    .select({ id: conversations.id, orgId: conversations.orgId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
    .limit(1);
  if (conv.length === 0) {
    return { error: 'not_found', reason: 'conversation' };
  }

  const sender = await resolveSenderIdentity(authUser.id, conv[0].orgId);
  if (!sender) {
    return { error: 'not_authorized', reason: 'no_identity' };
  }

  // Defense-in-depth: verify the sender is an active participant. RLS would
  // reject the INSERT (messages_insert_participants policy) but the action
  // layer gives a cleaner error than a Postgres violation.
  const participation = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.participantType, sender.participantType),
        eq(conversationParticipants.participantId, sender.participantId),
        isNull(conversationParticipants.leftAt),
      ),
    )
    .limit(1);
  if (participation.length === 0) {
    return { error: 'not_authorized', reason: 'not_a_participant' };
  }

  const messageId = uuidv7();
  try {
    await db.insert(messages).values({
      id: messageId,
      conversationId,
      senderType: sender.participantType,
      senderId: sender.participantId,
      body,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `send_message:${reason}` };
  }

  await logAudit({
    orgId: conv[0].orgId,
    userId: sender.participantType === 'user' ? sender.participantId : undefined,
    clientId: sender.participantType === 'client' ? sender.participantId : undefined,
    action: 'create',
    resourceType: 'message',
    resourceId: messageId,
    metadata: {
      conversation_id: conversationId,
      sender_type: sender.participantType,
      length: body.length,
    },
  });

  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath(`/portal/conversations/${conversationId}`);

  return { success: true, data: { messageId } };
}

// ─── editMessage ─────────────────────────────────────────────────────────────

const EditMessageInput = z.object({
  messageId: z.string().uuid(),
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(BODY_MIN, 'Message cannot be empty')
        .max(BODY_MAX, `Message exceeds ${BODY_MAX} characters`),
    ),
});

// Sender-only edit per Decision 9.4B. RLS messages_update_sender enforces this
// at the DB layer; the action layer provides a clean error and updates
// edited_at + body atomically. No time window — edits are always allowed.
//
// Soft-deleted messages can still be "edited" in theory but the UI hides the
// edit affordance on deleted rows. Action layer rejects edits on deleted rows
// for clarity.
export async function editMessage(
  input: unknown,
): Promise<MessageActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = EditMessageInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { messageId, body } = parsed.data;

  const msg = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      senderId: messages.senderId,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (msg.length === 0) {
    return { error: 'not_found', reason: 'message' };
  }
  if (msg[0].deletedAt !== null) {
    return { error: 'conflict', reason: 'message_deleted' };
  }
  if (msg[0].senderType === 'system' || msg[0].senderId === null) {
    return { error: 'not_authorized', reason: 'cannot_edit_system' };
  }

  // Sender check: caller's resolved identity must match the message's
  // (sender_type, sender_id). For users we cross-reference users.auth_user_id;
  // for clients we cross-reference clients.auth_user_id.
  if (msg[0].senderType === 'user') {
    const u = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, msg[0].senderId!),
          eq(users.authUserId, authUser.id),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (u.length === 0) return { error: 'not_authorized', reason: 'not_sender' };
  } else if (msg[0].senderType === 'client') {
    const c = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, msg[0].senderId!),
          eq(clients.authUserId, authUser.id),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    if (c.length === 0) return { error: 'not_authorized', reason: 'not_sender' };
  }

  await db
    .update(messages)
    .set({ body, editedAt: new Date() })
    .where(eq(messages.id, messageId));

  // Look up org for audit metadata.
  const conv = await db
    .select({ orgId: conversations.orgId })
    .from(conversations)
    .where(eq(conversations.id, msg[0].conversationId))
    .limit(1);

  await logAudit({
    orgId: conv[0]?.orgId,
    userId: msg[0].senderType === 'user' ? msg[0].senderId! : undefined,
    clientId: msg[0].senderType === 'client' ? msg[0].senderId! : undefined,
    action: 'update',
    resourceType: 'message',
    resourceId: messageId,
    metadata: {
      conversation_id: msg[0].conversationId,
      length: body.length,
    },
  });

  revalidatePath(`/conversations/${msg[0].conversationId}`);
  revalidatePath(`/portal/conversations/${msg[0].conversationId}`);

  return { success: true };
}

// ─── deleteMessage ───────────────────────────────────────────────────────────

const DeleteMessageInput = z.object({
  messageId: z.string().uuid(),
});

// Sender-only soft-delete. Sets deleted_at = now(); body remains in DB but
// the UI replaces it with '[deleted]' (Q6 / Decision 9.4B). RLS keeps the
// message visible to participants so the placeholder renders.
export async function deleteMessage(
  input: unknown,
): Promise<MessageActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = DeleteMessageInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { messageId } = parsed.data;

  const msg = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      senderId: messages.senderId,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (msg.length === 0) {
    return { error: 'not_found', reason: 'message' };
  }
  if (msg[0].deletedAt !== null) {
    return { error: 'conflict', reason: 'already_deleted' };
  }
  if (msg[0].senderType === 'system' || msg[0].senderId === null) {
    return { error: 'not_authorized', reason: 'cannot_delete_system' };
  }

  // Sender match (same pattern as editMessage).
  if (msg[0].senderType === 'user') {
    const u = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, msg[0].senderId!),
          eq(users.authUserId, authUser.id),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (u.length === 0) return { error: 'not_authorized', reason: 'not_sender' };
  } else if (msg[0].senderType === 'client') {
    const c = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, msg[0].senderId!),
          eq(clients.authUserId, authUser.id),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    if (c.length === 0) return { error: 'not_authorized', reason: 'not_sender' };
  }

  await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(eq(messages.id, messageId));

  const conv = await db
    .select({ orgId: conversations.orgId })
    .from(conversations)
    .where(eq(conversations.id, msg[0].conversationId))
    .limit(1);

  await logAudit({
    orgId: conv[0]?.orgId,
    userId: msg[0].senderType === 'user' ? msg[0].senderId! : undefined,
    clientId: msg[0].senderType === 'client' ? msg[0].senderId! : undefined,
    action: 'soft_delete',
    resourceType: 'message',
    resourceId: messageId,
    metadata: { conversation_id: msg[0].conversationId },
  });

  revalidatePath(`/conversations/${msg[0].conversationId}`);
  revalidatePath(`/portal/conversations/${msg[0].conversationId}`);

  return { success: true };
}
