import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { orgTypes } from './org-types';

// Reference data — RLS DISABLED. 8 rows seeded (4 tiers × 2 org types).
// price_monthly_pence: integer in pence (so £22.00/mo = 2200).
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey(),
    orgTypeId: uuid('org_type_id')
      .notNull()
      .references(() => orgTypes.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    priceMonthlyPence: integer('price_monthly_pence').notNull().default(0),
    featureFlags: jsonb('feature_flags').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('plans_org_type_slug_uniq').on(table.orgTypeId, table.slug),
    index('idx_plans_org_type').on(table.orgTypeId),
  ],
);
