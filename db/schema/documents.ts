import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { projects } from './projects';
import { users } from './users';

// Phase 2 §2 — `documents` is one table discriminated by `type`. This session
// exercises type='quote' only; invoice + receipt columns ride the same shape
// and are exercised in Sessions 13–14 (additive — no new migration needed for
// the columns already declared here; future sessions add invoice_subtype etc.
// as additive nullable columns under Hard Rule 1).
//
// Status enum is draft/sent/superseded/void. Acceptance is the boolean
// `accepted_at IS NOT NULL`, NOT a status value (per the kickoff spec —
// matches V2's `quote_accepted` boolean flip).
//
// Money math (see lib/documents/vat.ts):
//   - subtotal       = sum of line totals (pre-discount, pre-VAT)
//   - vat_amount     = vat_applicable ? round((subtotal - discount_amount) * 0.20) : 0
//   - total          = subtotal - discount_amount + vat_amount
//   - discount_amount is DERIVED on read = round(subtotal * discount_pct / 100)
//     (not stored — exact reconstruction from stored discount_pct + subtotal).
//
// Document numbering: project-scoped sequence per type. Helper in
// lib/documents/numbering.ts does SELECT FOR UPDATE on the projects row, counts
// existing rows for the (project_id, type) pair, formats document_number as
// `{project.projectNumber}-Q{sequence}` for quotes. UNIQUE (project_id, type,
// sequence) is the belt-and-braces.
//
// supersedes_document_id is the revision chain self-FK: revising a sent quote
// inserts a new row with `supersedes_document_id` pointing at the old, and
// the old's status flips to 'superseded'. ON DELETE SET NULL — admin-recovery
// hard-delete of the parent shouldn't take the child with it.
//
// RLS: see migration 0023. Four per-command policies (ADR-016, never FOR ALL).
// SELECT branches on (a) org-member of the project's org, OR (b) accepted
// stakeholder of the project whose can_view_financials = true (the §14 +
// §26-stub case). INSERT/UPDATE limited to org-members. acceptQuote
// (token-authorized, no auth.uid()) writes through the Drizzle pooler which
// bypasses RLS — see ADR-034 for the pattern.
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status').notNull().default('draft'),
    documentNumber: text('document_number').notNull(),
    sequence: integer('sequence').notNull(),
    lineItems: jsonb('line_items').notNull().default(sql`'[]'::jsonb`),
    discountPct: numeric('discount_pct', {
      precision: 5,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),
    vatApplicable: boolean('vat_applicable').notNull().default(false),
    subtotal: numeric('subtotal', {
      precision: 12,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),
    vatAmount: numeric('vat_amount', {
      precision: 12,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),
    total: numeric('total', { precision: 12, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    currency: text('currency').notNull().default('GBP'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByName: text('accepted_by_name'),
    supersedesDocumentId: uuid('supersedes_document_id').references(
      (): AnyPgColumn => documents.id,
      { onDelete: 'set null' },
    ),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'documents_type_check',
      sql`type IN ('quote', 'invoice', 'receipt')`,
    ),
    check(
      'documents_status_check',
      sql`status IN ('draft', 'sent', 'superseded', 'void')`,
    ),
    check(
      'documents_discount_pct_range',
      sql`discount_pct >= 0 AND discount_pct <= 100`,
    ),
    check('documents_sequence_positive', sql`sequence >= 1`),
    check(
      'documents_amounts_non_negative',
      sql`subtotal >= 0 AND vat_amount >= 0 AND total >= 0`,
    ),
    unique('documents_project_type_sequence_uniq').on(
      table.projectId,
      table.type,
      table.sequence,
    ),
    index('idx_documents_project')
      .on(table.projectId)
      .where(sql`deleted_at IS NULL`),
    index('idx_documents_org')
      .on(table.orgId)
      .where(sql`deleted_at IS NULL`),
  ],
);
