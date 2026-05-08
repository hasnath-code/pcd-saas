import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  clientOrgMemberships,
  clients,
  conversationParticipants,
  conversations,
  messages,
  projects,
  users,
} from '@/db/schema';

// Phase 1c §12. SSR data fetches for conversations + participants. Body
// projection (deleted → '[deleted]') happens here so server components and
// the realtime hook share the same display contract.

const DELETED_PLACEHOLDER = '[deleted]';

export type ConversationKind = 'one_to_one' | 'group' | 'general';

export type ConversationListItem = {
  id: string;
  type: ConversationKind;
  name: string | null;
  projectId: string | null;
  projectNumber: string | null;
  projectSiteAddress: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  participantNames: string[];
};

// Inbox listing for org users in a single org context. Returns conversations
// where the user is either an org member of org_id (transparency model — sees
// all org conversations) OR an active participant. Ordered by last message
// time DESC.
//
// Soft-deleted conversations are filtered. Soft-deleted messages are still
// returned in last_message_preview but blanked to '[deleted]' (Q6 / 9.4B).
export async function listConversationsForOrgUser(opts: {
  orgId: string;
  userId: string;
  projectId?: string | null;
}): Promise<ConversationListItem[]> {
  const conditions = [
    eq(conversations.orgId, opts.orgId),
    isNull(conversations.deletedAt),
  ];
  if (opts.projectId === null) {
    conditions.push(isNull(conversations.projectId));
  } else if (opts.projectId !== undefined) {
    conditions.push(eq(conversations.projectId, opts.projectId));
  }

  const rows = await db
    .select({
      id: conversations.id,
      type: conversations.type,
      name: conversations.name,
      projectId: conversations.projectId,
      projectNumber: projects.projectNumber,
      projectSiteAddress: projects.siteAddress,
      lastReadAt: conversationParticipants.lastReadAt,
      lastMessageAt: sql<Date | null>`(
        SELECT MAX(${messages.createdAt}) FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
      )`,
      lastMessageBody: sql<string | null>`(
        SELECT ${messages.body} FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
        ORDER BY ${messages.createdAt} DESC
        LIMIT 1
      )`,
      lastMessageDeletedAt: sql<Date | null>`(
        SELECT ${messages.deletedAt} FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
        ORDER BY ${messages.createdAt} DESC
        LIMIT 1
      )`,
      unreadCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
          AND (${conversationParticipants.lastReadAt} IS NULL OR ${messages.createdAt} > ${conversationParticipants.lastReadAt})
          AND NOT (${messages.senderType} = 'user' AND ${messages.senderId} = ${opts.userId})
          AND ${messages.deletedAt} IS NULL
      )`,
    })
    .from(conversations)
    .leftJoin(projects, eq(projects.id, conversations.projectId))
    .leftJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, conversations.id),
        eq(conversationParticipants.participantType, 'user'),
        eq(conversationParticipants.participantId, opts.userId),
        isNull(conversationParticipants.leftAt),
      ),
    )
    .where(
      and(
        ...conditions,
        // Visible if (a) the caller is an active participant or (b) they are
        // an org member of orgId — which they are, since this query is
        // already scoped to their orgId. So we just include all org
        // conversations.
      ),
    );

  if (rows.length === 0) return [];

  // Fetch participants for each conversation (small N at our scale; per-row
  // subquery would also work but a single follow-up query is cheaper).
  const convIds = rows.map((r) => r.id);
  const participantRows = await db
    .select({
      conversationId: conversationParticipants.conversationId,
      participantType: conversationParticipants.participantType,
      participantId: conversationParticipants.participantId,
      userName: users.name,
      clientName: clients.name,
    })
    .from(conversationParticipants)
    .leftJoin(
      users,
      and(
        eq(users.id, conversationParticipants.participantId),
        eq(conversationParticipants.participantType, 'user'),
      ),
    )
    .leftJoin(
      clients,
      and(
        eq(clients.id, conversationParticipants.participantId),
        eq(conversationParticipants.participantType, 'client'),
      ),
    )
    .where(
      and(
        inArray(conversationParticipants.conversationId, convIds),
        isNull(conversationParticipants.leftAt),
      ),
    );

  const namesByConv = new Map<string, string[]>();
  for (const p of participantRows) {
    const list = namesByConv.get(p.conversationId) ?? [];
    const display =
      p.participantType === 'user'
        ? p.userName ?? 'Team member'
        : p.clientName ?? 'Stakeholder';
    list.push(display);
    namesByConv.set(p.conversationId, list);
  }

  const items: ConversationListItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type as ConversationKind,
    name: r.name,
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    projectSiteAddress: r.projectSiteAddress,
    lastMessageAt: r.lastMessageAt,
    lastMessagePreview:
      r.lastMessageDeletedAt !== null
        ? DELETED_PLACEHOLDER
        : r.lastMessageBody,
    unreadCount: r.unreadCount ?? 0,
    participantNames: namesByConv.get(r.id) ?? [],
  }));

  items.sort((a, b) => {
    const aT = a.lastMessageAt?.getTime() ?? 0;
    const bT = b.lastMessageAt?.getTime() ?? 0;
    return bT - aT;
  });

  return items;
}

// Same shape as listConversationsForOrgUser but scoped to a stakeholder's
// client_id. Only conversations the stakeholder actively participates in.
export async function listConversationsForStakeholder(opts: {
  clientId: string;
  projectId?: string | null;
}): Promise<ConversationListItem[]> {
  // Find conversations the client participates in.
  const myConvIdsRows = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.participantType, 'client'),
        eq(conversationParticipants.participantId, opts.clientId),
        isNull(conversationParticipants.leftAt),
      ),
    );
  const myConvIds = myConvIdsRows.map((r) => r.conversationId);
  if (myConvIds.length === 0) return [];

  const conditions = [
    inArray(conversations.id, myConvIds),
    isNull(conversations.deletedAt),
  ];
  if (opts.projectId === null) {
    conditions.push(isNull(conversations.projectId));
  } else if (opts.projectId !== undefined) {
    conditions.push(eq(conversations.projectId, opts.projectId));
  }

  const rows = await db
    .select({
      id: conversations.id,
      type: conversations.type,
      name: conversations.name,
      projectId: conversations.projectId,
      projectNumber: projects.projectNumber,
      projectSiteAddress: projects.siteAddress,
      lastReadAt: conversationParticipants.lastReadAt,
      lastMessageAt: sql<Date | null>`(
        SELECT MAX(${messages.createdAt}) FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
      )`,
      lastMessageBody: sql<string | null>`(
        SELECT ${messages.body} FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
        ORDER BY ${messages.createdAt} DESC
        LIMIT 1
      )`,
      lastMessageDeletedAt: sql<Date | null>`(
        SELECT ${messages.deletedAt} FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
        ORDER BY ${messages.createdAt} DESC
        LIMIT 1
      )`,
      unreadCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${messages}
        WHERE ${messages.conversationId} = ${conversations.id}
          AND (${conversationParticipants.lastReadAt} IS NULL OR ${messages.createdAt} > ${conversationParticipants.lastReadAt})
          AND NOT (${messages.senderType} = 'client' AND ${messages.senderId} = ${opts.clientId})
          AND ${messages.deletedAt} IS NULL
      )`,
    })
    .from(conversations)
    .leftJoin(projects, eq(projects.id, conversations.projectId))
    .leftJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, conversations.id),
        eq(conversationParticipants.participantType, 'client'),
        eq(conversationParticipants.participantId, opts.clientId),
        isNull(conversationParticipants.leftAt),
      ),
    )
    .where(and(...conditions));

  if (rows.length === 0) return [];

  const convIds = rows.map((r) => r.id);
  const participantRows = await db
    .select({
      conversationId: conversationParticipants.conversationId,
      participantType: conversationParticipants.participantType,
      participantId: conversationParticipants.participantId,
      userName: users.name,
      clientName: clients.name,
    })
    .from(conversationParticipants)
    .leftJoin(
      users,
      and(
        eq(users.id, conversationParticipants.participantId),
        eq(conversationParticipants.participantType, 'user'),
      ),
    )
    .leftJoin(
      clients,
      and(
        eq(clients.id, conversationParticipants.participantId),
        eq(conversationParticipants.participantType, 'client'),
      ),
    )
    .where(
      and(
        inArray(conversationParticipants.conversationId, convIds),
        isNull(conversationParticipants.leftAt),
      ),
    );

  const namesByConv = new Map<string, string[]>();
  for (const p of participantRows) {
    const list = namesByConv.get(p.conversationId) ?? [];
    const display =
      p.participantType === 'user'
        ? p.userName ?? 'Team member'
        : p.clientName ?? 'Stakeholder';
    list.push(display);
    namesByConv.set(p.conversationId, list);
  }

  const items: ConversationListItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type as ConversationKind,
    name: r.name,
    projectId: r.projectId,
    projectNumber: r.projectNumber,
    projectSiteAddress: r.projectSiteAddress,
    lastMessageAt: r.lastMessageAt,
    lastMessagePreview:
      r.lastMessageDeletedAt !== null
        ? DELETED_PLACEHOLDER
        : r.lastMessageBody,
    unreadCount: r.unreadCount ?? 0,
    participantNames: namesByConv.get(r.id) ?? [],
  }));

  items.sort((a, b) => {
    const aT = a.lastMessageAt?.getTime() ?? 0;
    const bT = b.lastMessageAt?.getTime() ?? 0;
    return bT - aT;
  });

  return items;
}

export type ConversationParticipant = {
  participantType: 'user' | 'client';
  participantId: string;
  displayName: string;
  joinedAt: Date;
};

export type ConversationDetail = {
  id: string;
  type: ConversationKind;
  name: string | null;
  orgId: string;
  projectId: string | null;
  projectNumber: string | null;
  projectSiteAddress: string | null;
  createdBy: string | null;
  createdAt: Date;
  participants: ConversationParticipant[];
};

// Detail fetch for a single conversation. Includes participant list with
// resolved display names. Caller must verify visibility — this query doesn't
// scope by user/client (the page-level guards do).
export async function getConversationDetail(
  conversationId: string,
): Promise<ConversationDetail | null> {
  const convRows = await db
    .select({
      id: conversations.id,
      type: conversations.type,
      name: conversations.name,
      orgId: conversations.orgId,
      projectId: conversations.projectId,
      projectNumber: projects.projectNumber,
      projectSiteAddress: projects.siteAddress,
      createdBy: conversations.createdBy,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .leftJoin(projects, eq(projects.id, conversations.projectId))
    .where(
      and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)),
    )
    .limit(1);
  if (convRows.length === 0) return null;
  const conv = convRows[0];

  const participantRows = await db
    .select({
      participantType: conversationParticipants.participantType,
      participantId: conversationParticipants.participantId,
      joinedAt: conversationParticipants.joinedAt,
      userName: users.name,
      clientName: clients.name,
    })
    .from(conversationParticipants)
    .leftJoin(
      users,
      and(
        eq(users.id, conversationParticipants.participantId),
        eq(conversationParticipants.participantType, 'user'),
      ),
    )
    .leftJoin(
      clients,
      and(
        eq(clients.id, conversationParticipants.participantId),
        eq(conversationParticipants.participantType, 'client'),
      ),
    )
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        isNull(conversationParticipants.leftAt),
      ),
    );

  const participants: ConversationParticipant[] = participantRows.map((p) => ({
    participantType: p.participantType as 'user' | 'client',
    participantId: p.participantId,
    displayName:
      p.participantType === 'user'
        ? p.userName ?? 'Team member'
        : p.clientName ?? 'Stakeholder',
    joinedAt: p.joinedAt,
  }));

  return {
    id: conv.id,
    type: conv.type as ConversationKind,
    name: conv.name,
    orgId: conv.orgId,
    projectId: conv.projectId,
    projectNumber: conv.projectNumber,
    projectSiteAddress: conv.projectSiteAddress,
    createdBy: conv.createdBy,
    createdAt: conv.createdAt,
    participants,
  };
}

export type MessageRow = {
  id: string;
  conversationId: string;
  senderType: 'user' | 'client' | 'system';
  senderId: string | null;
  senderName: string | null;
  body: string;
  displayBody: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

// Initial server-side message fetch (the realtime hook does the same query
// client-side then patches via subscription). Body-blanked '[deleted]'
// projection lives here too.
export async function listMessagesForConversation(
  conversationId: string,
  opts?: { limit?: number },
): Promise<MessageRow[]> {
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      userName: users.name,
      clientName: clients.name,
    })
    .from(messages)
    .leftJoin(
      users,
      and(eq(users.id, messages.senderId), eq(messages.senderType, 'user')),
    )
    .leftJoin(
      clients,
      and(eq(clients.id, messages.senderId), eq(messages.senderType, 'client')),
    )
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(opts?.limit ?? 200);

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    senderType: r.senderType as MessageRow['senderType'],
    senderId: r.senderId,
    senderName:
      r.senderType === 'user'
        ? r.userName
        : r.senderType === 'client'
          ? r.clientName
          : null,
    body: r.body,
    displayBody: r.deletedAt !== null ? DELETED_PLACEHOLDER : r.body,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
    deletedAt: r.deletedAt,
  }));
}

// Aggregate unread count across all conversations the caller (org user OR
// stakeholder) participates in. Used to render the nav-bar badge in the
// (org) and /portal layouts. Cheap — one indexed scan per active
// participant row joined to their unread messages.
export async function totalUnreadForOrgUser(opts: {
  orgId: string;
  userId: string;
}): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(unread.cnt), 0)::int`,
    })
    .from(
      sql`(
        SELECT COUNT(*)::int AS cnt
        FROM ${conversationParticipants} cp
        JOIN ${messages} m ON m.conversation_id = cp.conversation_id
        JOIN ${conversations} c ON c.id = cp.conversation_id
        WHERE cp.participant_type = 'user'
          AND cp.participant_id = ${opts.userId}
          AND cp.left_at IS NULL
          AND c.org_id = ${opts.orgId}
          AND c.deleted_at IS NULL
          AND m.deleted_at IS NULL
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
          AND NOT (m.sender_type = 'user' AND m.sender_id = ${opts.userId})
        GROUP BY cp.id
      ) unread`,
    );
  return rows[0]?.total ?? 0;
}

export async function totalUnreadForStakeholder(opts: {
  clientId: string;
}): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(unread.cnt), 0)::int`,
    })
    .from(
      sql`(
        SELECT COUNT(*)::int AS cnt
        FROM ${conversationParticipants} cp
        JOIN ${messages} m ON m.conversation_id = cp.conversation_id
        JOIN ${conversations} c ON c.id = cp.conversation_id
        WHERE cp.participant_type = 'client'
          AND cp.participant_id = ${opts.clientId}
          AND cp.left_at IS NULL
          AND c.deleted_at IS NULL
          AND m.deleted_at IS NULL
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
          AND NOT (m.sender_type = 'client' AND m.sender_id = ${opts.clientId})
        GROUP BY cp.id
      ) unread`,
    );
  return rows[0]?.total ?? 0;
}

// For the new-conversation modal: lists active org users + clients linked to
// the org via client_org_memberships. Used to build participant pickers.
export async function listOrgPickableParticipants(orgId: string): Promise<{
  users: { id: string; name: string | null; role: string }[];
  clients: { id: string; name: string | null; email: string }[];
}> {
  const userRows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));

  const clientRows = await db
    .select({ id: clients.id, name: clients.name, email: clients.email })
    .from(clients)
    .innerJoin(
      clientOrgMemberships,
      eq(clientOrgMemberships.clientId, clients.id),
    )
    .where(
      and(eq(clientOrgMemberships.orgId, orgId), isNull(clients.deletedAt)),
    );

  return { users: userRows, clients: clientRows };
}
