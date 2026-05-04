import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orgTypes } from './org-types';
import { plans } from './plans';

// Tenant — RLS ENABLED. Soft-delete via deleted_at.
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => orgTypes.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    customEmailDomain: text('custom_email_domain'),
    customEmailVerifiedAt: timestamp('custom_email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_organizations_type')
      .on(table.typeId)
      .where(sql`deleted_at IS NULL`),
    index('idx_organizations_plan')
      .on(table.planId)
      .where(sql`deleted_at IS NULL`),
  ],
);
