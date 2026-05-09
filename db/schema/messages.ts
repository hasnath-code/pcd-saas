import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

// Phase 1c §12.3. A single message in a conversation. sender_type discriminates
// user / client / system. system messages have sender_id NULL — used in Session
// 9 for participant-change events ("X added Y", "X removed Y"). Stage-change /
// file-upload / milestone system messages defer to Session 11 when
// project_activity ships (ADR-027 + S4b sub-decision).
//
// Soft-delete via deleted_at. SELECT policy does NOT filter deleted_at —
// soft-deleted rows remain visible to participants but the action/query
// projection layer replaces body with '[deleted]' (Decision 9.4B / Q6).
//
// edited_at: set when the sender edits the body. Visible to all participants.
// Markdown rendering is the UI's concern; action layer only validates length.
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderType: text('sender_type').notNull(),
    senderId: uuid('sender_id'),
    body: text('body').notNull(),
    attachments: jsonb('attachments').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'messages_sender_type_check',
      sql`sender_type IN ('user', 'client', 'system')`,
    ),
    // System messages have sender_id NULL; non-system messages must have a sender_id.
    check(
      'messages_sender_id_consistency',
      sql`(sender_type = 'system' AND sender_id IS NULL) OR (sender_type <> 'system' AND sender_id IS NOT NULL)`,
    ),
    // Reverse-chronological scroll: SELECT messages WHERE conversation_id = ? ORDER BY created_at DESC.
    // Partial on deleted_at IS NULL kept off — soft-deleted rows still need to render '[deleted]' inline.
    index('idx_messages_conversation_created').on(
      table.conversationId,
      sql`created_at DESC`,
    ),
    // For "edit/delete my own messages" lookups by sender (UI only shows own-sender controls).
    index('idx_messages_sender').on(table.senderType, table.senderId),
  ],
);
