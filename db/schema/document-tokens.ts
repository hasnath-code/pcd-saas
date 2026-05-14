import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';

// Phase 2 §2 — public-page tokens for documents. One row per (document, type)
// pair; the type is duplicated on the token row so the lookup query can match
// on (token, document_type) without first resolving the document. Format
// follows ARCHITECTURE-saas.md §25 with the receipt_initial/receipt_final
// split collapsed to a single 'receipt' — Phase 2's receipt model is one
// peer object, not the split V2 had (see phase-2-scope.md §2.5).
//
// `token` is uuid v4 (gen_random_uuid()) — random, not time-sortable. §25
// rationale: "randomness is the only property that matters" for a
// public-route gate; v7's time-prefix would let attackers narrow the search
// space.
//
// `id` stays uuid v7 (app-generated) for index locality, per the project-wide
// PK convention.
//
// No revocation in this session (matches Apps Script). A future `revoked_at`
// column is the natural additive shape if revocation is needed.
//
// RLS: see migration 0024. Four per-command policies (ADR-016). All four
// gate on org-membership of the underlying document's org — stakeholders
// don't list tokens, they reach docs via the public URL.
export const documentTokens = pgTable(
  'document_tokens',
  {
    id: uuid('id').primaryKey(),
    token: uuid('token').notNull().default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentType: text('document_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'document_tokens_document_type_check',
      sql`document_type IN ('quote', 'invoice', 'receipt')`,
    ),
    uniqueIndex('idx_document_tokens_token').on(table.token),
    index('idx_document_tokens_document').on(table.documentId),
  ],
);
