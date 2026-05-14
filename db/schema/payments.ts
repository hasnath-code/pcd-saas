import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { projects } from './projects';
import { users } from './users';

// Phase 2 §2.3 / Session 13 — payments table.
//
// Each `recordPayment` call inserts one row. The running total for a project
// is a SUM(amount) WHERE deleted_at IS NULL — never a stored column. Payment
// target for the derived payment-status axis is the ACCEPTED QUOTE's total,
// not the sum of invoice amounts (invoices are independent slices of the
// contract value; see lib/documents/payment-status.ts).
//
// `correction_log_payload` is the UI-visible history of `amount` mutations
// performed by `correctPayment`. Each entry:
//   { previous_amount, new_amount, corrected_at, corrected_by, reason }
// `audit_logs` is the system-of-record for the correction event itself
// (Hard Rule 4); the JSON column is a denormalized read-side convenience.
//
// RLS (migration 0025): four per-command policies (ADR-016). SELECT mirrors
// documents_select — gates stakeholders on can_view_financials=true.
// INSERT/UPDATE limited to org members. DELETE org admins only.
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    amount: numeric('amount', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }).notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    correctionLogPayload: jsonb('correction_log_payload')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('payments_amount_positive', sql`amount > 0`),
    index('idx_payments_project')
      .on(table.projectId)
      .where(sql`deleted_at IS NULL`),
    index('idx_payments_org')
      .on(table.orgId)
      .where(sql`deleted_at IS NULL`),
  ],
);
