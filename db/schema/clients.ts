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
import { organizations } from './organizations';

// External stakeholders (homeowners, architect-firm contacts, etc.). RLS ENABLED.
// Soft-delete via deleted_at. auth_user_id is OPTIONAL — populated when the
// stakeholder accepts a magic-link invitation and signs up; NULL before then.
// Cross-schema FK to auth.users(id) declared in migration 0007 below the divider.
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey(),
    authUserId: uuid('auth_user_id'),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    phone: text('phone'),
    companyName: text('company_name'),
    companyType: text('company_type'),
    billingAddress: text('billing_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'clients_company_type_check',
      sql`company_type IS NULL OR company_type IN ('architect_firm', 'contractor', 'homeowner', 'engineer', 'developer', 'other')`,
    ),
    index('idx_clients_auth_user')
      .on(table.authUserId)
      .where(sql`deleted_at IS NULL`),
    index('idx_clients_email')
      .on(table.email)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Many-to-many: clients <-> orgs. A single client can belong to multiple orgs
// (same homeowner working with two surveyor firms, etc.). RLS ENABLED.
// first_added_at = when this client was first attached to this org.
// last_active_at = informational only (Phase 1 doesn't gate access on it).
export const clientOrgMemberships = pgTable(
  'client_org_memberships',
  {
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    firstAddedAt: timestamp('first_added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  },
  (table) => [
    unique('client_org_memberships_client_org_uniq').on(table.clientId, table.orgId),
    index('idx_client_org_memberships_org').on(table.orgId),
    index('idx_client_org_memberships_client').on(table.clientId),
  ],
);
