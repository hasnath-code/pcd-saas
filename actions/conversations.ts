'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  AuthError,
  requireAuth,
  requireOrgAdmin,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db, type DbOrTx } from '@/db';
import {
  clientOrgMemberships,
  clients,
  conversationParticipants,
  conversations,
  messages,
  projects,
  users,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';

export type ConversationActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

const CONVERSATION_TYPES = ['one_to_one', 'group', 'general'] as const;

// ─── Internal helpers ────────────────────────────────────────────────────────

// Insert a system message inside an existing transaction. sender_type='system'
// + sender_id NULL satisfies the messages_sender_id_consistency CHECK. Used by
// addConversationParticipant + removeConversationParticipant + the auto-create
// helpers below. Bypasses RLS via the postgres pooler role — no policy allows
// system messages from the authenticated role by design.
async function insertSystemMessageTx(
  tx: DbOrTx,
  opts: { conversationId: string; body: string },
): Promise<string> {
  const id = uuidv7();
  await tx.insert(messages).values({
    id,
    conversationId: opts.conversationId,
    senderType: 'system',
    senderId: null,
    body: opts.body,
  });
  return id;
}

// Idempotent: returns the existing one_to_one conversation for (project,
// stakeholder client) if one is present and not soft-deleted; else creates it
// + adds the stakeholder + all active org members as participants. Called from
// inside acceptStakeholderInvitation's transaction. Bypasses RLS via tx
// (postgres pooler).
//
// Decision 9.1A: one-to-one means stakeholder + ALL active org members at the
// time of creation. New org members joining later must be added via
// addConversationParticipant — no auto-join sweep (deferred to future session).
export async function autoCreateOneToOneConversationTx(
  tx: DbOrTx,
  opts: {
    stakeholderClientId: string;
    projectId: string;
    orgId: string;
    createdByUserId: string;
  },
): Promise<{ conversationId: string; created: boolean }> {
  const existing = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, conversations.id),
        eq(conversationParticipants.participantType, 'client'),
        eq(conversationParticipants.participantId, opts.stakeholderClientId),
      ),
    )
    .where(
      and(
        eq(conversations.orgId, opts.orgId),
        eq(conversations.projectId, opts.projectId),
        eq(conversations.type, 'one_to_one'),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { conversationId: existing[0].id, created: false };
  }

  const conversationId = uuidv7();
  await tx.insert(conversations).values({
    id: conversationId,
    orgId: opts.orgId,
    projectId: opts.projectId,
    type: 'one_to_one',
    createdBy: opts.createdByUserId,
  });

  // Stakeholder participant
  await tx.insert(conversationParticipants).values({
    id: uuidv7(),
    conversationId,
    participantType: 'client',
    participantId: opts.stakeholderClientId,
  });

  // All active org members
  const orgMembers = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, opts.orgId), isNull(users.deletedAt)));
  if (orgMembers.length > 0) {
    await tx.insert(conversationParticipants).values(
      orgMembers.map((u) => ({
        id: uuidv7(),
        conversationId,
        participantType: 'user' as const,
        participantId: u.id,
      })),
    );
  }

  return { conversationId, created: true };
}

// Idempotent: returns the existing general conversation for (org, client) if
// one is present; else creates it + adds the client + all active org admins as
// participants. Called from inside findOrCreateClientTx's transaction (when a
// new client_org_memberships row is inserted). Decision 9.1B.
//
// General conversations have project_id NULL — they're org↔client at the org
// level, not tied to any one project.
export async function autoCreateGeneralConversationTx(
  tx: DbOrTx,
  opts: {
    orgId: string;
    clientId: string;
    createdByUserId: string;
  },
): Promise<{ conversationId: string; created: boolean }> {
  const existing = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, conversations.id),
        eq(conversationParticipants.participantType, 'client'),
        eq(conversationParticipants.participantId, opts.clientId),
      ),
    )
    .where(
      and(
        eq(conversations.orgId, opts.orgId),
        isNull(conversations.projectId),
        eq(conversations.type, 'general'),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { conversationId: existing[0].id, created: false };
  }

  const conversationId = uuidv7();
  await tx.insert(conversations).values({
    id: conversationId,
    orgId: opts.orgId,
    projectId: null,
    type: 'general',
    createdBy: opts.createdByUserId,
  });

  await tx.insert(conversationParticipants).values({
    id: uuidv7(),
    conversationId,
    participantType: 'client',
    participantId: opts.clientId,
  });

  // Org admins (owner + admin roles) — general convos are admin-driven
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.orgId, opts.orgId),
        inArray(users.role, ['owner', 'admin']),
        isNull(users.deletedAt),
      ),
    );
  if (admins.length > 0) {
    await tx.insert(conversationParticipants).values(
      admins.map((u) => ({
        id: uuidv7(),
        conversationId,
        participantType: 'user' as const,
        participantId: u.id,
      })),
    );
  }

  return { conversationId, created: true };
}

// ─── createGroupConversation ─────────────────────────────────────────────────

const CreateGroupConversationInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  participantUserIds: z.array(z.string().uuid()).default([]),
  participantClientIds: z.array(z.string().uuid()).default([]),
});

// Group conversation creation — owner/admin only. Inserts the conversation +
// participants in one transaction. Caller is auto-added as a participant.
//
// participantUserIds / participantClientIds are validated against the caller's
// org (cross-org membership returns not_authorized). System-template / cross-
// org leakage is the same kind of footgun called out in S8 §35.8 entry 3.
export async function createGroupConversation(
  input: unknown,
): Promise<ConversationActionResult<{ conversationId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateGroupConversationInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, name, participantUserIds, participantClientIds } = parsed.data;

  // Verify caller's user.id ends up in participants once.
  const userIdSet = new Set(participantUserIds);
  userIdSet.add(ctx.userId);
  const finalUserIds = Array.from(userIdSet);

  // Validate user participants are in caller's org (cross-org → not_authorized).
  if (finalUserIds.length > 0) {
    const orgUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, finalUserIds),
          eq(users.orgId, ctx.orgId),
          isNull(users.deletedAt),
        ),
      );
    if (orgUsers.length !== finalUserIds.length) {
      return { error: 'not_authorized', reason: 'cross_org_user' };
    }
  }

  // Validate client participants are linked to caller's org via
  // client_org_memberships. Cross-org clients are not allowed (would let the
  // cross-org auth user see this org's conversation via the helper).
  if (participantClientIds.length > 0) {
    const orgClients = await db
      .select({ id: clients.id })
      .from(clients)
      .innerJoin(
        clientOrgMemberships,
        eq(clientOrgMemberships.clientId, clients.id),
      )
      .where(
        and(
          inArray(clients.id, participantClientIds),
          eq(clientOrgMemberships.orgId, ctx.orgId),
          isNull(clients.deletedAt),
        ),
      );
    if (orgClients.length !== participantClientIds.length) {
      return { error: 'not_authorized', reason: 'cross_org_client' };
    }
  }

  // If projectId given, validate it's in caller's org.
  if (projectId) {
    const projRow = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, ctx.orgId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (projRow.length === 0) {
      return { error: 'not_found', reason: 'project' };
    }
  }

  const conversationId = uuidv7();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(conversations).values({
        id: conversationId,
        orgId: ctx.orgId,
        projectId: projectId ?? null,
        type: 'group',
        name,
        createdBy: ctx.userId,
      });

      const participantRows = [
        ...finalUserIds.map((uid) => ({
          id: uuidv7(),
          conversationId,
          participantType: 'user' as const,
          participantId: uid,
        })),
        ...participantClientIds.map((cid) => ({
          id: uuidv7(),
          conversationId,
          participantType: 'client' as const,
          participantId: cid,
        })),
      ];
      if (participantRows.length > 0) {
        await tx.insert(conversationParticipants).values(participantRows);
      }
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `create_group_conversation:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'conversation',
    resourceId: conversationId,
    metadata: {
      type: 'group',
      project_id: projectId ?? null,
      participant_user_count: finalUserIds.length,
      participant_client_count: participantClientIds.length,
    },
  });

  revalidatePath('/conversations');
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);

  return { success: true, data: { conversationId } };
}

// ─── addConversationParticipant ──────────────────────────────────────────────

const AddParticipantInput = z.object({
  conversationId: z.string().uuid(),
  participantType: z.enum(['user', 'client']),
  participantId: z.string().uuid(),
});

export async function addConversationParticipant(
  input: unknown,
): Promise<ConversationActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = AddParticipantInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { conversationId, participantType, participantId } = parsed.data;

  // Verify conversation belongs to caller's org and is not soft-deleted.
  const conv = await db
    .select({
      id: conversations.id,
      orgId: conversations.orgId,
      projectId: conversations.projectId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.orgId, ctx.orgId),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (conv.length === 0) {
    return { error: 'not_found', reason: 'conversation' };
  }

  // Validate participant exists in caller's org context.
  if (participantType === 'user') {
    const u = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.id, participantId),
          eq(users.orgId, ctx.orgId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (u.length === 0) return { error: 'not_authorized', reason: 'cross_org_user' };

    return await insertParticipantWithSystemMsg(ctx, conversationId, 'user', participantId, u[0].name ?? 'A team member');
  } else {
    const c = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .innerJoin(
        clientOrgMemberships,
        eq(clientOrgMemberships.clientId, clients.id),
      )
      .where(
        and(
          eq(clients.id, participantId),
          eq(clientOrgMemberships.orgId, ctx.orgId),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    if (c.length === 0) return { error: 'not_authorized', reason: 'cross_org_client' };
    return await insertParticipantWithSystemMsg(ctx, conversationId, 'client', participantId, c[0].name ?? 'A stakeholder');
  }
}

async function insertParticipantWithSystemMsg(
  ctx: Awaited<ReturnType<typeof requireOrgAdmin>>,
  conversationId: string,
  participantType: 'user' | 'client',
  participantId: string,
  displayName: string,
): Promise<ConversationActionResult> {
  // If a row already exists (active or left), reactivate by clearing left_at.
  // UNIQUE (conversation_id, participant_type, participant_id) prevents
  // duplicate INSERTs.
  try {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: conversationParticipants.id, leftAt: conversationParticipants.leftAt })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.participantType, participantType),
            eq(conversationParticipants.participantId, participantId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        if (existing[0].leftAt === null) {
          throw new Error('PARTICIPANT_ALREADY_ACTIVE');
        }
        await tx
          .update(conversationParticipants)
          .set({ leftAt: null, joinedAt: new Date() })
          .where(eq(conversationParticipants.id, existing[0].id));
      } else {
        await tx.insert(conversationParticipants).values({
          id: uuidv7(),
          conversationId,
          participantType,
          participantId,
        });
      }

      await insertSystemMessageTx(tx, {
        conversationId,
        body: `${displayName} was added to the conversation.`,
      });
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (reason.includes('PARTICIPANT_ALREADY_ACTIVE')) {
      return { error: 'conflict', reason: 'already_participant' };
    }
    return { error: 'internal_error', reason: `add_participant:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'permission_change',
    resourceType: 'conversation_participant',
    resourceId: conversationId,
    metadata: {
      verb: 'added',
      participant_type: participantType,
      participant_id: participantId,
    },
  });

  revalidatePath(`/conversations/${conversationId}`);

  return { success: true };
}

// ─── removeConversationParticipant ───────────────────────────────────────────

const RemoveParticipantInput = z.object({
  conversationId: z.string().uuid(),
  participantType: z.enum(['user', 'client']),
  participantId: z.string().uuid(),
});

export async function removeConversationParticipant(
  input: unknown,
): Promise<ConversationActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    ctx = await requireOrgAdmin();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = RemoveParticipantInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { conversationId, participantType, participantId } = parsed.data;

  // Verify conversation belongs to caller's org.
  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.orgId, ctx.orgId),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (conv.length === 0) {
    return { error: 'not_found', reason: 'conversation' };
  }

  // Resolve display name BEFORE the tx so the system-message body is concrete.
  let displayName = participantType === 'user' ? 'A team member' : 'A stakeholder';
  if (participantType === 'user') {
    const u = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, participantId))
      .limit(1);
    if (u.length > 0 && u[0].name) displayName = u[0].name;
  } else {
    const c = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, participantId))
      .limit(1);
    if (c.length > 0 && c[0].name) displayName = c[0].name;
  }

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(conversationParticipants)
        .set({ leftAt: new Date() })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.participantType, participantType),
            eq(conversationParticipants.participantId, participantId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .returning({ id: conversationParticipants.id });
      if (updated.length === 0) {
        throw new Error('PARTICIPANT_NOT_FOUND');
      }

      await insertSystemMessageTx(tx, {
        conversationId,
        body: `${displayName} was removed from the conversation.`,
      });
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (reason.includes('PARTICIPANT_NOT_FOUND')) {
      return { error: 'not_found', reason: 'participant' };
    }
    return { error: 'internal_error', reason: `remove_participant:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'permission_change',
    resourceType: 'conversation_participant',
    resourceId: conversationId,
    metadata: {
      verb: 'removed',
      participant_type: participantType,
      participant_id: participantId,
    },
  });

  revalidatePath(`/conversations/${conversationId}`);

  return { success: true };
}

// ─── markConversationRead ────────────────────────────────────────────────────

const MarkReadInput = z.object({
  conversationId: z.string().uuid(),
});

// Self-only update of last_read_at on the caller's participant row. No audit
// log entry — read-tracking writes don't go in audit_logs per §22 (Q4 answer).
//
// Caller can be an org user OR a stakeholder. We resolve identity from
// auth.uid() against users (org membership match via the conversation's org)
// or clients. RLS would also enforce this via conversation_participants_update.
export async function markConversationRead(
  input: unknown,
): Promise<ConversationActionResult> {
  let authUser;
  try {
    authUser = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = MarkReadInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { conversationId } = parsed.data;

  // Look up conversation to scope by org_id.
  const conv = await db
    .select({ orgId: conversations.orgId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
    .limit(1);
  if (conv.length === 0) {
    return { error: 'not_found', reason: 'conversation' };
  }

  // Resolve as user (in conversation's org) first, then client.
  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.authUserId, authUser.id),
        eq(users.orgId, conv[0].orgId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  let participantType: 'user' | 'client';
  let participantId: string;
  if (userRow.length > 0) {
    participantType = 'user';
    participantId = userRow[0].id;
  } else {
    const clientRow = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.authUserId, authUser.id), isNull(clients.deletedAt)))
      .limit(1);
    if (clientRow.length === 0) {
      return { error: 'not_authorized', reason: 'no_identity' };
    }
    participantType = 'client';
    participantId = clientRow[0].id;
  }

  const updated = await db
    .update(conversationParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.participantType, participantType),
        eq(conversationParticipants.participantId, participantId),
        isNull(conversationParticipants.leftAt),
      ),
    )
    .returning({ id: conversationParticipants.id });

  if (updated.length === 0) {
    return { error: 'not_found', reason: 'participant' };
  }

  return { success: true };
}
