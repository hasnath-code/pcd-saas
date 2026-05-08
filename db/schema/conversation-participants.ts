import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

// Phase 1c §12.2 + ADR-028. Polymorphic participant link — participant_id
// references either users.id or clients.id depending on participant_type.
// No FK on participant_id (polymorphic). UNIQUE prevents duplicate
// participation rows.
//
// last_read_at: when the participant last opened the conversation.
//   markConversationRead bumps this to now(). Unread count is computed as
//   `messages.created_at > last_read_at AND sender != self`.
//
// left_at (ADR-028): soft-leave column. removeConversationParticipant sets
//   left_at = now() and inserts a system message in the same transaction.
//   Default queries filter `left_at IS NULL`.
export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    participantType: text('participant_type').notNull(),
    participantId: uuid('participant_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'conversation_participants_participant_type_check',
      sql`participant_type IN ('user', 'client')`,
    ),
    unique('conversation_participants_conversation_participant_uniq').on(
      table.conversationId,
      table.participantType,
      table.participantId,
    ),
    index('idx_conversation_participants_conversation')
      .on(table.conversationId)
      .where(sql`left_at IS NULL`),
    index('idx_conversation_participants_participant').on(
      table.participantType,
      table.participantId,
    ),
  ],
);
