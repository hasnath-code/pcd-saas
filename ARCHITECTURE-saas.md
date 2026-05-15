# PCD Portal SaaS — Architecture Reference

**Version:** 0.20 (Phase 3 strategy decision shipped 16 May 2026 — docs-only renumber. Original Phase 3 ("Client portal — stakeholder-facing UI") collapsed: /portal/* shipped early via Phase 1b/1c and lit up further by S14. Renumbered 4→3 (Architect lifecycle), 5→4 (Native kanban + public docs + upsells), 6→5 (Stripe billing + plan switching + polish). Pre-launch UX polish sprint scoped separately, NOT a numbered phase. ~25 textual `Phase N` references swept across §2 / §6 / §10 / §13 / §15 / §16 / §17 / §18 / §19 / §24 / §31 / §34 / §35. Stale `(client)/` route group reference in §6 replaced with the real `portal/` entry. New §35.DECISION-PHASE-3-RENUMBER carryover entry modelled on the §35.HOTFIX / §35.MINI pattern. No code / schema / test / migration changes. v0.19 → v0.20.)
**Last updated:** 16 May 2026
**Maintainer:** Hasnath
**Codebase status:** **Phase 2 Session 14 shipped — Phase 2 CLOSED** 15 May 2026. New surfaces: `/dashboard/projects/[id]/receipts/[receiptId]` (org-side receipt detail with revise-recipient + Download PDF), `/r/[token]` public receipt view (read-only, token-gated, Download PDF), Receipts + Profitability ("Coming Soon") cards on the project detail page (Coming Soon org-side ONLY per kickoff §2.11), Download PDF buttons on quote/invoice/receipt org-side detail pages and on `/q/[token]` `/i/[token]` `/r/[token]` public pages. Portal `/portal/projects/[id]` financial sections lit up (Quotes / Invoices / Payments / Receipts read-only, gated on `can_view_financials` — was the S13 short-circuit-to-`[]`). PaymentsSection renders R{n} link to receipt detail (bidirectional payment↔receipt UI link); ReceiptsSection has its own card. Schema-forever (Hard Rule 1) holds — additive only: two nullable columns on existing tables, no new tables, no changes to existing rows, RLS, actions, or tests. **Phase 2 ends here.** **Phase 3 strategy resolved 16 May 2026** — see §35.DECISION-PHASE-3-RENUMBER. Original Phase 3 framing collapsed (portal shipped early via 1b/1c/2); renumbered: 4→3 (Architect lifecycle), 5→4 (Native kanban + upsells), 6→5 (Stripe billing + polish). Pre-launch UX polish sprint scoped separately, not a numbered phase. Next: pre-launch sprint scope doc + new Phase 3 (Architect lifecycle) kickoff.
**Production URL:** https://pcd-saas.vercel.app
**Repo:** https://github.com/hasnath-code/pcd-saas

---

## 0. Document Status

This document specifies the SaaS rebuild of the PCD Portal. It is the source of truth for:
- Schema design (Phases 1a, 1b, 1c)
- Architectural conventions (auth, RLS, server actions, storage, email, webhooks)
- Build checklists for Phase 1 Claude Code sessions

This document does **not** cover:
- The live Apps Script portal — see `ARCHITECTURE.md` (still source of truth for that product)
- One-time data migration from Apps Script to Postgres — see `MIGRATION-MAP.md`
- Phase 2+ feature specs — to be added as those phases begin

**Audience:** dual. Reasoning sections target the maintainer (Hasnath) for decision review. Specifics, schemas, and conventions target the Claude Code sessions executing the build.

**When to update:** every time a Phase 1 session ships, append the actual implementation deltas. After Phase 1c is complete, freeze the schema sections — additive-only thereafter.

---

## 1. Product Overview

PCD is a project-management SaaS for UK measured-survey and architecture firms. Two org types share one platform:

- **Surveyor firms** — short-cycle projects (2–8 weeks): quote → survey → drawings → delivery.
- **Architect firms** — long-cycle projects (6 months – 3 years): RIBA stages 0–7, drawing packages, multiple revisions, multiple stakeholders per project.

Both share a common spine: multi-tenancy, project lifecycle, stakeholder collaboration, document workflows, billing.

Each project has multiple **stakeholders** (clients, collaborators, observers) with distinct visibility profiles. A homeowner sees progress and schedule but not fees; a billing contact sees fees but not chat. The org user (surveyor or architect employee) is the project owner; stakeholders are invited collaborators.

### Phase tracker

| Phase | Status | Description |
|---|---|---|
| 1a | **✓ Complete** (S1 + S2 + S3 + S4 shipped) | Foundation: auth, multi-tenancy, RLS, settings, webhooks, email |
| 1b | **✓ Complete** (S5 + S6 + S7 + S8 shipped) | Project core: workflows, clients, projects, stakeholders |
| 1c | **✓ Complete** (S9 + S10 + S11 shipped 14 May 2026) | Communication: conversations, files, notifications, activity |
| 2 | **✓ Complete** (S12 + S13 + S14 shipped 15 May 2026) | Surveyor lifecycle (quote/invoice/receipt) ported from Apps Script + PDF generation + portal financial visibility |
| 3 | Pending | Architect lifecycle (RIBA stages, drawing packages) |
| 4 | Pending | Native kanban, public docs, upsells |
| 5 | Pending | Stripe billing, plan switching, polish |

**Pre-launch UX polish sprint** is scoped separately from numbered phases — runs between Phase 2 close and Phase 3 kickoff. Phases are product-shaped bodies of work; polish doesn't anchor a phase. Sprint scope and operational pre-launch items (retention worker, data export, Resend prod domain, Upstash prod split, migration of Hasnath's existing 10 projects) tracked outside the phase tracker. See §35.DECISION-PHASE-3-RENUMBER.

---

## 2. Stack

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Frontend framework | Next.js | 15.x (App Router) | Server actions for all mutations |
| Hosting | Vercel | — | Pro plan once paid customers exist |
| Database | Supabase Postgres | 15.x | RLS-first, pgbouncer transaction-mode pooler |
| Auth | Supabase Auth | latest | Email + magic link; OAuth providers later |
| File storage | Supabase Storage | latest | RLS-mirrored bucket policies, signed URLs |
| Realtime | Supabase Realtime | latest | Broadcast channels per conversation |
| Transactional email | Resend | latest | Inbound webhooks → `email_events` |
| Rate limiting | Upstash Redis | latest | Per-IP and per-org sliding windows |
| Error tracking | Sentry | latest | Free tier in dev, paid tier post-launch |
| UI framework | shadcn/ui + Tailwind | latest | Radix primitives under the hood |
| Form validation | Zod | latest | Shared between client and server actions |
| ORM | Drizzle | latest | Type-safe, SQL-close; not Prisma |
| Billing | Stripe | latest | Phase 5 |
| SMS (later) | Twilio | latest | Phase 3+, gated behind paid plans |

**Why Drizzle over Prisma:** Drizzle's schema is closer to actual SQL, plays well with Supabase's RLS-first model, and doesn't need a separate generation step that fights with Supabase migrations. Prisma's RLS support is awkward.

**Why Supabase Auth over Clerk:** see Item 2 of pre-draft decisions. Hard problem (stakeholder model) gets zero help from Clerk; Supabase Auth + RLS is a single source of truth.

**Why server actions over API routes:** all mutations go through server actions. They get auth context for free, work with progressive enhancement, and avoid an arbitrary HTTP boundary inside our own app. API routes are reserved for webhooks and public token-gated endpoints.

---

## 3. (Reserved)

This section number is reserved. Hard Rules (Section 4) and Naming Conventions (Section 5) come first because they govern every decision in Sections 6+.

---

## 4. Hard Rules

These rules apply to every change in this codebase. The Phase 1a Claude Code session must enforce them; later sessions inherit them. Any rule violation is a blocking review issue.

### Universal rules

1. **Schema is forever (additive after launch).** Once Phase 1c is complete and the first paying customer exists, schema changes are additive only. No column drops, no rename, no type narrowing. New nullable columns or new tables are fine.

2. **RLS first.** Every new table requires:
   - RLS enabled at table creation
   - Policies for SELECT, INSERT, UPDATE, DELETE
   - At least one cross-org isolation test in the RLS test suite
   - Merging without all three is blocked.

3. **Soft-delete by default.** Every domain table has `deleted_at timestamptz`. Default queries filter `WHERE deleted_at IS NULL`. Hard deletes only via the retention worker (post-launch).

4. **Audit on writes.** Every mutation on financial, stakeholder, document, billing, or org-membership data writes one row to `audit_logs`. Reads are not logged.

5. **Stakeholder ≠ user.** `clients` and `users` are separate primitives. Never conflate in queries, RLS, or UI logic. They share an `auth_user_id` only as identity glue.

6. **Org-type parity.** Features must work for both surveyor and architect orgs unless explicitly gated by a `feature_flag`. No code path branches on org type silently.

7. **No client-side writes.** All mutations through Next.js server actions. Direct Supabase writes from the browser are forbidden — even with RLS, the surface area is too easy to misuse.

8. **Signed URLs only.** Storage access via short-lived signed URLs (default 5 minutes). No public buckets, ever.

9. **Idempotent webhooks.** Every inbound webhook handler is idempotent via the `webhook_events.external_event_id` UNIQUE constraint. Duplicate deliveries are no-ops.

10. **Feature flags are not RLS.** Feature gating happens in server actions via a helper function, not in RLS policies. RLS exists to enforce hard security boundaries; feature flags are negotiable product boundaries.

11. **Owner cannot orphan.** An org's owner cannot delete their own `users` row. Ownership must be transferred first. Application-level check.

12. **The `deleted_at IS NULL` filter is non-negotiable.** Every RLS policy that resolves the current user's org membership filters out soft-deleted rows. Without this filter, soft-deleted users retain access until cache expiry.

### Carryover rules from Apps Script (still relevant)

13. **Don't touch V1.** The legacy V1 Apps Script project remains independent and untouched.

14. **Public token-gated routes don't get auth-walled.** Token-gated routes (quotes, invoices, receipts) must be accessible without login. Token validation, not auth, gates them.

15. **Commit before each significant change.** `git add -A && git commit -m "before <feature>"` before starting work. Commits are save points.

16. **Never re-ask documented functionality.** Before asking a clarifying question, check this doc and `ARCHITECTURE.md`. If the answer is documented, reference it and ask the forward-looking question instead.

---

## 5. Naming & Type Conventions

These conventions apply uniformly across the schema. Session 1 sets them; all later sessions inherit. Style decisions made here are not revisited in later sessions.

### Tables

- **Plural, snake_case:** `organizations`, `project_stakeholders`, `webhook_events`.
- **Join tables:** combined names, no `_join` suffix: `client_org_memberships`, `conversation_participants`.
- **Projection tables:** named after the domain concept, not the source: `email_events`, not `resend_events`.

### Columns

- **snake_case:** `org_id`, `created_at`, `payment_reference`.
- **Booleans prefixed `is_` or `can_` or `has_`:** `is_system_template`, `can_view_financials`, `has_completed_onboarding`. Defaults to `false` unless the negative is more meaningful (e.g. `is_active` defaults to `true`).
- **Timestamps suffixed `_at`:** `created_at`, `accepted_at`, `deleted_at`. Type is always `timestamptz`. Stored in UTC.
- **Foreign keys:** `<referenced_table_singular>_id`. Example: `org_id` references `organizations.id`. The same column name is used everywhere it appears (no `parent_org_id` style — confuses queries).
- **JSON columns:** suffixed `_payload`, `_metadata`, or `_overrides` based on intent. Type is `jsonb`, never `json`.

### IDs

- **UUID v7 for all primary keys.** Generated via the `uuidv7` extension or via app-side generation. UUID v7 is time-sortable, which matters for index locality and cursor-based pagination.
- **Column type:** `uuid PRIMARY KEY DEFAULT gen_uuid_v7()`.
- **Never use bigserial or integer IDs.** They leak business volume and complicate cross-region replication later.

### Timestamps

- **Type:** `timestamptz` everywhere, no exceptions. Even for "date-only" concepts like `scheduled_at` — store as timestamptz, render as date in UI.
- **Default:** `DEFAULT now()` on `created_at` columns.
- **Never store local time.** Times are UTC in DB; UI handles conversion.

### Enums

**Decision: text columns with CHECK constraints, not Postgres enums.**

Rationale:
- Postgres enums require a migration to add a value (`ALTER TYPE ... ADD VALUE`). For frequently-evolving enums (event types, role types), this is friction.
- Text + CHECK gives the same constraint with no enum-versioning headache.
- Drizzle handles text + CHECK cleanly; enum support is workable but uneven.

**Convention:**

```sql
event_type text NOT NULL CHECK (event_type IN (
  'message.created',
  'project.stage_changed',
  'document.sent'
))
```

The CHECK constraint is updated via additive migrations. The application uses TypeScript union types as the single source of truth, mirrored by the constraint.

**Exception:** `org_types` and `plans` are reference data with their own tables (not enums) because they have associated data (display names, default workflow IDs, prices, feature flags).

### Boolean defaults

- Default to `false` unless the negative is the failure mode (e.g. `is_active DEFAULT true`).
- All booleans `NOT NULL` — no nullable booleans. If the state has three meanings, use a text status column.

### Foreign key conventions

- **All FKs explicit:** `REFERENCES table(id) ON DELETE <action>`.
- **ON DELETE rules:**
  - `RESTRICT` for FKs that must not cascade (e.g. `users.org_id` — deleting an org with active users is wrong)
  - `CASCADE` only for tightly-owned children (e.g. `workflow_stages.workflow_id`)
  - `SET NULL` for optional references (e.g. `audit_logs.user_id` when user is hard-deleted)
- **Indexes:** every FK column gets an index unless explicitly justified otherwise.

### Naming for RLS policies

- **Format:** `<table>_<operation>_<scope>`. Examples: `projects_select_org_members`, `messages_insert_participants`, `clients_select_self`.
- One policy per operation per scope. Avoid `FOR ALL` policies — they hide intent.

### File naming (TypeScript)

- **Server actions:** `actions/<resource>.ts`, exporting named functions: `createProject`, `updateProject`, `softDeleteProject`.
- **DB queries:** `db/queries/<resource>.ts`, exporting named functions: `getProjectById`, `listProjectsForOrg`.
- **RLS tests:** `__tests__/rls/<table>.test.ts`. One file per table.
- **Migrations:** `db/migrations/NNNN_<description>.sql`, zero-padded sequence.

### Migrations naming

- **Sequence:** `0001_initial.sql`, `0002_add_org_settings.sql`, etc.
- **Description:** verb-noun, snake_case. `add_`, `create_`, `alter_`, `backfill_`.
- **One migration per logical change.** Don't batch unrelated changes.

---

## 6. Project Layout

```
pcd-saas/
├── app/                              # Next.js App Router
│   ├── (auth)/                       # Public auth routes
│   │   ├── login/
│   │   ├── signup/
│   │   └── magic-link/
│   ├── (org)/                        # Org user surfaces
│   │   ├── dashboard/
│   │   ├── projects/
│   │   ├── settings/
│   │   └── team/
│   ├── portal/                       # Stakeholder portal (live since Phase 1b; conversations/files/notifications added Phase 1c; financial surfaces added Phase 2)
│   │   ├── projects/
│   │   └── conversations/
│   ├── api/
│   │   └── webhooks/
│   │       └── [source]/             # Generic webhook ingestion
│   ├── q/[token]/                    # Public quote pages (Phase 2)
│   ├── i/[token]/                    # Public invoice pages (Phase 2)
│   ├── r/[token]/                    # Public receipt pages (Phase 2)
│   └── layout.tsx
├── actions/                          # Server actions (mutations only)
│   ├── auth.ts
│   ├── orgs.ts
│   ├── invitations.ts
│   ├── projects.ts                   # Phase 1b
│   ├── stakeholders.ts               # Phase 1b
│   ├── messages.ts                   # Phase 1c
│   └── files.ts                      # Phase 1c
├── db/
│   ├── schema/                       # Drizzle schema definitions
│   │   ├── orgs.ts
│   │   ├── users.ts
│   │   ├── audit.ts
│   │   ├── webhooks.ts
│   │   ├── projects.ts               # Phase 1b
│   │   ├── workflows.ts              # Phase 1b
│   │   ├── stakeholders.ts           # Phase 1b
│   │   ├── conversations.ts          # Phase 1c
│   │   └── files.ts                  # Phase 1c
│   ├── queries/                      # Read-only queries (no mutations)
│   ├── migrations/                   # Numbered SQL migrations
│   └── seed/
│       ├── org_types.sql
│       ├── plans.sql
│       └── system_workflows.sql
├── lib/
│   ├── auth.ts                       # Auth helpers (current user, current org)
│   ├── rls.ts                        # RLS context helpers
│   ├── audit.ts                      # logAudit() helper
│   ├── features.ts                   # checkFeature() helper
│   ├── webhooks/
│   │   ├── verify.ts                 # Per-source signature verification
│   │   ├── resend.ts                 # Resend processor
│   │   ├── stripe.ts                 # Phase 5
│   │   └── twilio.ts                 # Phase 3+
│   ├── email/
│   │   ├── resend-client.ts
│   │   └── templates/
│   ├── storage/
│   │   └── signed-urls.ts            # Phase 1c
│   └── ratelimit.ts                  # Upstash wrapper
├── components/
│   ├── ui/                           # shadcn/ui components
│   └── ...
├── __tests__/
│   ├── rls/                          # RLS policy tests
│   │   ├── _setup.ts                 # Two-user-two-org fixtures
│   │   ├── orgs.test.ts
│   │   ├── users.test.ts
│   │   └── ...
│   └── integration/
└── env.ts                            # Validated env vars (Zod)
```

**Conventions:**

- **Server actions only do mutations.** Reads happen in `db/queries/`, called directly from React Server Components.
- **No Supabase client in `components/`.** Components receive data as props or via server-side fetches.
- **One schema file per domain area.** `db/schema/projects.ts` exports `projects`, `projectMilestones`, etc. Shared FKs are imported across files.
- **`env.ts` is the only place env vars are read.** Everything else imports from there. Validated with Zod at startup.

---

## 7. Environment Configuration

All env vars live in `env.ts`, validated with Zod at startup. Missing or malformed values fail fast.

### Required for Phase 1a

| Variable | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase | **Pooler URL** (port 6543, transaction mode). Used by app at runtime. |
| `DIRECT_URL` | Supabase | Direct connection (port 5432). Used by migrations only. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Public project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Anon key (RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Service role (bypasses RLS) — used only by server-side admin operations |
| `RESEND_API_KEY` | Resend | Sending emails |
| `RESEND_WEBHOOK_SECRET` | Resend | Verifying inbound webhook signatures |
| `UPSTASH_REDIS_REST_URL` | Upstash | Rate limiting backing store |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | |
| `SENTRY_DSN` | Sentry | Error tracking |
| `SENTRY_AUTH_TOKEN` | Sentry | Source map uploads (Vercel build only) |
| `NEXT_PUBLIC_APP_URL` | self | e.g. `https://app.pcdportal.com` — production custom-domain override consumed by `lib/get-app-url.ts:getAppUrl()` (never read directly outside the helper — see ADR-032) |
| `INTERNAL_CRON_SECRET` | self-generated | Bearer token for internal cron jobs (Vercel cron) |

### Reserved for later phases

| Variable | Phase | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | 6 | Billing |
| `STRIPE_WEBHOOK_SECRET` | 6 | |
| `TWILIO_ACCOUNT_SID` | 4+ | SMS |
| `TWILIO_AUTH_TOKEN` | 4+ | |

### Local dev vs Vercel

- **Local:** `.env.local` (gitignored). Use a separate Supabase project for dev.
- **Vercel:** environment variables set per-environment (Preview, Production). Production uses prod Supabase project.
- **Never:** share Supabase service role keys outside server-side env. Never expose in `NEXT_PUBLIC_*`.

### env.ts shape

```ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  RESEND_WEBHOOK_SECRET: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  SENTRY_DSN: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  INTERNAL_CRON_SECRET: z.string().min(32),
});

export const env = schema.parse(process.env);
```

### App-public URL construction

All app-public URLs (magic-link `emailRedirectTo`, signup/reset redirect targets, invitation accept URLs, notification email bodies — anything that needs to point a browser back at the running deployment) are built via `lib/get-app-url.ts:getAppUrl()`. The helper resolves origin per environment using a VERCEL_ENV-aware priority:

- Production on Vercel: `NEXT_PUBLIC_APP_URL` (custom domain override) → `https://${VERCEL_URL}` (project production alias).
- Preview/dev on Vercel: `https://${VERCEL_URL}` always (defeats the localhost-leak class of bugs where a stale `NEXT_PUBLIC_APP_URL` in preview env produces broken magic links).
- Local: `NEXT_PUBLIC_APP_URL` → `http://localhost:3000`.

`getAppUrl()` reads `process.env` directly (not via `env`) — a deliberate exception so `VERCEL_URL` / `VERCEL_ENV` don't bloat the Zod startup schema and tests can stub via `vi.stubEnv`. Direct `process.env.NEXT_PUBLIC_APP_URL` reads for URL construction are forbidden outside the helper. See ADR-032 + SKILL.md Hard Rule 26.

---

## 8. Auth Model

The canonical statement of identity in this system. Three primitives, one auth identity.

### The three primitives

```
auth.users          ← Supabase Auth identity (email, password, magic link sessions)
   │
   ├── users        ← Org member (one row per (auth_user, org) pair)
   │
   └── clients      ← Stakeholder identity (one row globally, multi-org collaboration)
```

- **`auth.users`** — managed by Supabase Auth. One row per email. Source of truth for `auth.uid()` in RLS.
- **`users`** — application-level row representing an employee of an org. `(auth_user_id, org_id)` is unique.
- **`clients`** — application-level row representing a person who collaborates with one or more orgs as an external stakeholder.

A single `auth_user_id` may appear in zero, one, or many `users` rows AND in zero or one `clients` row. The system distinguishes contexts at login.

### Sarah's full lifecycle

**T+0 — Sarah is invited as a stakeholder by Architect Firm A**

1. Firm A's owner adds Sarah to a project: `sarah@example.com`, name "Sarah".
2. App creates `clients` row: `{id: c1, auth_user_id: NULL, email: 'sarah@example.com', name: 'Sarah'}`.
3. App creates `client_org_memberships` row: `{client_id: c1, org_id: firm_a}`.
4. App creates `project_stakeholders` row: `{project_id: p1, client_id: c1, role: 'primary_client', visibility_profile: 'full'}`.
5. App creates `invitations` row with magic-link token, sends email via Resend.

**T+1 — Sarah clicks the magic link**

6. Supabase Auth handles the magic link, creates `auth.users` row: `{id: auth1, email: 'sarah@example.com'}`.
7. Post-auth callback: app finds `clients` row by email, sets `auth_user_id = auth1`.
8. Marks invitation as accepted.
9. Redirects Sarah to client portal placeholder. She sees Project P1.

**T+6 months — Sarah's firm signs up**

10. Sarah visits marketing site, clicks "Sign up — Architect", enters `sarah@example.com`.
11. Supabase Auth: email exists → sends magic link / password challenge.
12. Sarah authenticates (existing `auth1` identity).
13. Post-login: signup wizard detects she has no `users` row.
14. "Create your firm" wizard: name "Sarah Architecture Ltd", type architect, plan Solo Free.
15. App creates `organizations` row: `{id: org_sarah, type: architect, plan: solo_free}`.
16. App creates `users` row: `{id: u1, auth_user_id: auth1, org_id: org_sarah, role: 'owner'}`.
17. Seeds default workflows for the org (see Section 11).

**T+6m+1d — Sarah logs in**

18. Sarah lands at `/login`, authenticates.
19. App queries: does `auth1` have a `users` row? Yes → context switcher available.
    - "Sarah Architecture Ltd" (her org as owner)
    - "Stakeholder portal" (her client identity, all orgs that invited her)
20. She picks. Session stores chosen context (`active_org_id` for users, `client_mode = true` for stakeholder context).

### Login flow decision tree

```
User authenticates via Supabase Auth → has session with auth.uid()
                │
                ├── Has users row(s)? ──── No ─── Has clients row?
                │                                     │
                │                                     ├── Yes → /portal/projects (stakeholder portal)
                │                                     │
                │                                     └── No → /onboarding (orphan auth — allow new org creation)
                │
                ├── Yes, one row → set active_org, redirect to /dashboard
                │
                └── Yes, multiple rows OR has clients row too → /select-context (Phase 1c — DEBT-041; pre-Phase-1c default is /dashboard)
```

**Implementation contract (post-DEBT-037, ADR-031):** This decision tree is implemented exclusively in `lib/auth/postAuthResolve.ts:pickDestination` (or its successor — there must be exactly one routing helper, per SKILL.md Hard Rule 25). The auth callback (`app/auth/callback/route.ts`), password sign-in (`actions/auth.ts:signIn`), root page (`app/page.tsx`), and dashboard guard (`app/(org)/dashboard/page.tsx`) all resolve identity via `resolvePostAuthIdentity` and route via `pickDestination` — no auth action emits `redirect(safeNext(...))` directly. `createOrganization` requires `intent: z.literal('wizard_signup')` to be invokable; this guards against silent invocation by anything other than the wizard form. Sarah Step 2 (a stakeholder choosing to create her own firm via the wizard) is a legitimate path; the action's dual-context probe writes `metadata.dual_context_signup=true` for observability without blocking. The auth callback is responsible for backfilling `clients.auth_user_id` on first sign-in (Sarah Step 7) — idempotent via `WHERE auth_user_id IS NULL`, with anti-hijack guard against overwriting a different auth_user_id. The §8 link helper is shared between this callback path and `acceptStakeholderInvitation` (which still owns the literal-invitation-URL flow).

### Context resolution in server actions

Every server action that operates in org context resolves `active_org_id` from session. RLS policies use this via a session-set GUC variable:

```sql
-- Set at start of each request:
SET LOCAL app.active_org_id = '<uuid>';

-- Read in policies:
USING (org_id = current_setting('app.active_org_id', true)::uuid)
```

This is more robust than re-deriving org from `auth.uid()` in every policy (which works but is slower and lets ambiguity slip through when a user has multiple `users` rows).

### Owner-orphan prevention

Application logic blocks:
- Soft-deleting a `users` row where `role = 'owner'` and that org has no other owner.
- Owner role transfer must complete before the original owner is removed.

Enforced in `actions/team.ts`. Not enforceable in RLS (would require subqueries that are messy at scale).

---

## 9. Multi-Tenancy & RLS Conventions

The universal rules every table follows. RLS is the primary security boundary in this system. Bugs here are data leaks.

### The cardinal rule

**Cross-org data isolation is non-negotiable.** No SELECT, INSERT, UPDATE, or DELETE on any domain table may return or affect rows from another org. Every table has a test asserting this.

### Policy shape convention

**All RLS policies use per-command shape (`FOR SELECT` / `FOR INSERT` / `FOR UPDATE` / `FOR DELETE`) — never `FOR ALL`.** See SKILL.md Hard Rule 23 for rationale. Migration 0010 originally shipped `FOR ALL` policies on `project_stakeholders` and `project_milestones`; migration 0012 converted them to the canonical per-command shape after the soft-delete leak surfaced in tests. All future tables must follow per-command from creation.

### Matrix testing convention (Session 7)

For tables with stakeholder-visible RLS branches, RLS coverage uses a **parameterized matrix** in `tests/rls/visibility-matrix.test.ts` (template). The matrix iterates the 5 visibility profiles (`full / progress_only / documents_only / schedule_only / custom`) × the protected tables × the 4 operations (SELECT positive / INSERT denial / UPDATE denial / DELETE denial). Every assertion derives expected behavior from the canonical SECURITY DEFINER gate (`auth_user_stakeholder_project_visibility(uuid)`) — tests do not query `project_stakeholders` directly to "check what flags are set." When Phase 1c adds `messages` and `project_files`, extend the same matrix file rather than duplicating the structure.

Shared assertion helpers live in `tests/rls/_helpers.ts` (`assertVisibleIds`, `assertNotVisible`, `assertWriteDenied`, `assertRpcReturns`); the 7 fixture builders in `tests/fixtures/stakeholder-fixtures.ts` cover the happy path + 6 edge-case states (pending, removed, soft-deleted client, expired invitation, multi-org stakeholder, owner+stakeholder dual-context).

### Standard policy patterns

**Pattern A: Org-scoped table (most common)**

For tables with `org_id`:

```sql
-- SELECT
CREATE POLICY "<table>_select_org_members" ON <table>
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- INSERT
CREATE POLICY "<table>_insert_org_members" ON <table>
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- Similar for UPDATE, DELETE
```

The `deleted_at IS NULL` filter is mandatory (Hard Rule 12).

**Pattern B: Stakeholder-accessible table**

For tables visible to both org users AND stakeholders (e.g. `messages`, `project_files`):

```sql
CREATE POLICY "<table>_select_org_or_stakeholder" ON <table>
  FOR SELECT USING (
    -- Org member access
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (
        SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
      )
    )
    OR
    -- Stakeholder access (subject to visibility profile — see Section 12)
    project_id IN (
      SELECT project_id FROM project_stakeholders ps
      JOIN clients c ON c.id = ps.client_id
      WHERE c.auth_user_id = auth.uid()
        AND c.deleted_at IS NULL
        AND ps.deleted_at IS NULL
        AND ps.accepted_at IS NOT NULL
    )
  );
```

**Pattern C: Self-only table (e.g. `notification_preferences`)**

```sql
CREATE POLICY "<table>_select_self" ON <table>
  FOR SELECT USING (
    (user_id IS NOT NULL AND user_id IN (
      SELECT id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
    ))
    OR
    (client_id IS NOT NULL AND client_id IN (
      SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
    ))
  );
```

### Service role usage

The service role key bypasses RLS. It's used **only** for:
- Migrations
- Seeding system data
- The webhook ingestion endpoint (which writes to `webhook_events` cross-org)
- Internal cron jobs (retention, scheduled notifications)

**Never** used in user-facing server actions. Server actions use the user's session-bound client.

### Helper functions

`lib/rls.ts` exports:

```ts
// Set active org for the request (called in middleware after auth)
setActiveOrg(orgId: string): Promise<void>

// Get current user's org membership (server-side)
getCurrentUserOrg(): Promise<{ userId: string; orgId: string; role: string } | null>

// Get current stakeholder identity (server-side, client portal)
getCurrentStakeholder(): Promise<{ clientId: string; memberships: string[] } | null>
```

### Anti-patterns (never do these)

- **Using `auth.uid()` directly in app code** to filter queries. Always go through RLS or the helpers above.
- **Disabling RLS on a domain table.** Only reference tables (`org_types`, `plans`) and append-only system tables (`webhook_events`) may have RLS disabled, and only after explicit review.
- **Conditional policies based on org_type.** Use feature flags instead.
- **Subqueries on `auth.users` directly.** Always go through `users` or `clients`.

---

## 10. Schema — Phase 1a Tables

Ten tables ship in Phase 1a (10.1–10.9 plus 10.10 `outbound_emails` added in Session 4). SQL is the source of truth. Drizzle schema mirrors this.

### 10.1 `org_types`

Reference data. Two rows seeded at install.

```sql
CREATE TABLE org_types (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  slug text NOT NULL UNIQUE CHECK (slug IN ('surveyor', 'architect')),
  name text NOT NULL,
  default_workflow_slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_types DISABLE ROW LEVEL SECURITY;  -- public reference data
```

**Seed data:**
```sql
INSERT INTO org_types (slug, name, default_workflow_slug) VALUES
  ('surveyor', 'Surveyor Firm', 'simple'),
  ('architect', 'Architect Firm', 'simple');
```

### 10.2 `plans`

Reference data. One row per (org_type × plan tier).

```sql
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_type_id uuid NOT NULL REFERENCES org_types(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  name text NOT NULL,
  price_monthly_pence integer NOT NULL DEFAULT 0,
  feature_flags jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_type_id, slug)
);

ALTER TABLE plans DISABLE ROW LEVEL SECURITY;
```

**Seed data (Phase 1a — placeholder feature_flags, real values set in Phase 5):**
```sql
-- Surveyor plans
INSERT INTO plans (org_type_id, slug, name, price_monthly_pence, feature_flags) VALUES
  ((SELECT id FROM org_types WHERE slug = 'surveyor'), 'solo_free', 'Solo Free', 0, '{"max_projects": 3}'),
  ((SELECT id FROM org_types WHERE slug = 'surveyor'), 'studio', 'Studio', 2200, '{"max_projects": 50}'),
  ((SELECT id FROM org_types WHERE slug = 'surveyor'), 'practice', 'Practice', 3800, '{"max_projects": null, "dual_org_type": true}'),
  ((SELECT id FROM org_types WHERE slug = 'surveyor'), 'enterprise', 'Enterprise', 5500, '{"max_projects": null, "dual_org_type": true, "custom_email_domain": true}');

-- Architect plans (mirror, different pricing)
INSERT INTO plans (org_type_id, slug, name, price_monthly_pence, feature_flags) VALUES
  ((SELECT id FROM org_types WHERE slug = 'architect'), 'solo_free', 'Solo Free', 0, '{"max_projects": 3}'),
  ((SELECT id FROM org_types WHERE slug = 'architect'), 'studio', 'Studio', 3500, '{"max_projects": 25}'),
  ((SELECT id FROM org_types WHERE slug = 'architect'), 'practice', 'Practice', 5800, '{"max_projects": null, "dual_org_type": true}'),
  ((SELECT id FROM org_types WHERE slug = 'architect'), 'enterprise', 'Enterprise', 8500, '{"max_projects": null, "dual_org_type": true, "custom_email_domain": true}');
```

### 10.3 `organizations`

The tenant.

```sql
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  name text NOT NULL,
  type_id uuid NOT NULL REFERENCES org_types(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  custom_email_domain text,
  custom_email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_organizations_type ON organizations(type_id) WHERE deleted_at IS NULL;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizations_select_members" ON organizations
  FOR SELECT USING (
    id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "organizations_update_owners" ON organizations
  FOR UPDATE USING (
    id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role = 'owner')
  );
-- INSERT happens via service role during signup; no user-level INSERT policy needed
-- DELETE is soft-delete only; no hard DELETE policy
```

### 10.4 `users`

Org member.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (auth_user_id, org_id)
);

CREATE INDEX idx_users_auth_user ON users(auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_org ON users(org_id) WHERE deleted_at IS NULL;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_org_members" ON users
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users u WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL)
  );

CREATE POLICY "users_update_self_or_admin" ON users
  FOR UPDATE USING (
    auth_user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM users u
      WHERE u.auth_user_id = auth.uid() AND u.deleted_at IS NULL AND u.role IN ('owner', 'admin')
    )
  );
```

### 10.5 `org_settings`

Flexible per-org config.

```sql
CREATE TABLE org_settings (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE INDEX idx_org_settings_org ON org_settings(org_id);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_settings_select_members" ON org_settings
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "org_settings_modify_admins" ON org_settings
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role IN ('owner', 'admin')
    )
  );
```

**Standard keys (Phase 1a):**
- `company.name`, `company.address`, `company.vat_number`, `company.company_number`
- `bank.account_name`, `bank.account_number`, `bank.sort_code`
- `documents.terms_and_conditions`, `documents.footer_text`
- `branding.logo_url`, `branding.primary_color`

### 10.6 `invitations`

Generic invitation primitive — used by team invites (1a) and stakeholder invites (1b).

```sql
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  invitation_type text NOT NULL CHECK (invitation_type IN ('team_member', 'stakeholder')),
  role text,
  -- For stakeholder invites:
  project_id uuid,  -- FK added in Phase 1b
  stakeholder_role text,
  visibility_profile text,
  -- Token & state:
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_token ON invitations(token) WHERE accepted_at IS NULL;
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_org ON invitations(org_id);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitations_select_admins" ON invitations
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role IN ('owner', 'admin')
    )
  );
-- INSERT via service role during invitation creation
-- Acceptance updates accepted_at via service role (no user policy needed)
```

### 10.7 `audit_logs`

Append-only audit trail.

```sql
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id uuid,  -- FK added in Phase 1b
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select_admins" ON audit_logs
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role IN ('owner', 'admin')
    )
  );
-- INSERT only via service role (logAudit() helper)
```

**Standard actions:** `create`, `update`, `soft_delete`, `restore`, `permission_change`, `invite_sent`, `invite_accepted`, `login`, `password_changed`.

### 10.8 `webhook_events`

Generic inbound webhook log + idempotency.

```sql
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  source text NOT NULL CHECK (source IN ('resend', 'stripe', 'twilio')),
  event_type text NOT NULL,
  external_event_id text NOT NULL,
  payload jsonb NOT NULL,
  signature_verified boolean NOT NULL,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_event_id)
);

CREATE INDEX idx_webhook_events_source_created ON webhook_events(source, created_at DESC);
CREATE INDEX idx_webhook_events_unprocessed ON webhook_events(source) WHERE processed_at IS NULL;

ALTER TABLE webhook_events DISABLE ROW LEVEL SECURITY;
-- This table is system-only; user-facing access is through projection tables (email_events, etc.)
-- Service role only.
```

### 10.9 `email_events`

Projection of Resend webhook events.

```sql
CREATE TABLE email_events (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  webhook_event_id uuid NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  message_id text NOT NULL,
  recipient text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'
  )),
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_events_message ON email_events(message_id);
CREATE INDEX idx_email_events_org_recipient ON email_events(org_id, recipient);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_events_select_admins" ON email_events
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role IN ('owner', 'admin')
    )
  );
```

### 10.10 `outbound_emails` (added Session 4)

Lookup table written by `lib/email/send.ts` at send time and read by `lib/webhooks/resend.ts` to resolve `email_events.org_id` from the inbound `message_id`. Resend webhook tags are best-effort (not always echoed in every event type), so a deterministic lookup table is the resolution path of record.

```sql
CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  template text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbound_emails_message ON outbound_emails(message_id);
ALTER TABLE outbound_emails DISABLE ROW LEVEL SECURITY;  -- system table, service-role only
REVOKE ALL ON public.outbound_emails FROM anon, authenticated;
```

### 10.11 (placeholder counter)

Phase 1a ships ten domain tables (10.1–10.10). The `clients` table (used in `audit_logs.client_id` FK) is created in Phase 1b. `audit_logs.client_id` is added without FK constraint in 1a, FK added in 1b's first migration.

### Helper function: `gen_uuid_v7()`

If the `uuidv7` extension isn't available in Supabase, ship this fallback in Migration 0001:

```sql
CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  uuid_bytes = set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes = set_byte(uuid_bytes, 8, (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;
```

Verify availability of native `uuidv7()` in current Supabase Postgres before falling back to this.


---

## 11. Schema — Phase 1b Tables

Seven tables ship in Phase 1b. Each must follow Phase 1a's RLS conventions.

### 11.1 `workflows`

```sql
CREATE TABLE workflows (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  org_type_id uuid REFERENCES org_types(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  is_system_template boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (
    (is_system_template = true AND org_id IS NULL)
    OR (is_system_template = false AND org_id IS NOT NULL)
  )
);

CREATE INDEX idx_workflows_org ON workflows(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_workflows_templates ON workflows(org_type_id) WHERE is_system_template = true;

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflows_select_org_or_template" ON workflows
  FOR SELECT USING (
    is_system_template = true
    OR org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
  );

CREATE POLICY "workflows_modify_org_admins" ON workflows
  FOR ALL USING (
    is_system_template = false
    AND org_id IN (
      SELECT org_id FROM users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role IN ('owner', 'admin')
    )
  );
```

### 11.2 `workflow_stages`

```sql
CREATE TABLE workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  requires_action boolean NOT NULL DEFAULT false,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, slug),
  UNIQUE (workflow_id, position)
);

CREATE INDEX idx_workflow_stages_workflow ON workflow_stages(workflow_id);

ALTER TABLE workflow_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_stages_select" ON workflow_stages
  FOR SELECT USING (
    workflow_id IN (SELECT id FROM workflows)  -- inherits workflow visibility via parent RLS
  );

CREATE POLICY "workflow_stages_modify_org_admins" ON workflow_stages
  FOR ALL USING (
    workflow_id IN (
      SELECT w.id FROM workflows w
      WHERE w.is_system_template = false
        AND w.org_id IN (
          SELECT org_id FROM users
          WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND role IN ('owner', 'admin')
        )
    )
  );
```

### 11.3 `clients`

```sql
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  phone text,
  company_name text,
  company_type text CHECK (company_type IN (
    'architect_firm', 'contractor', 'homeowner', 'engineer', 'developer', 'other'
  )),
  billing_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_clients_auth_user ON clients(auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_email ON clients(email) WHERE deleted_at IS NULL;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_self_or_org_member" ON clients
  FOR SELECT USING (
    auth_user_id = auth.uid()
    OR id IN (
      SELECT client_id FROM client_org_memberships
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );

CREATE POLICY "clients_update_self" ON clients
  FOR UPDATE USING (auth_user_id = auth.uid());
-- INSERT via service role during invitation creation
```

### 11.4 `client_org_memberships`

```sql
CREATE TABLE client_org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_added_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz,
  UNIQUE (client_id, org_id)
);

CREATE INDEX idx_client_org_memberships_org ON client_org_memberships(org_id);
CREATE INDEX idx_client_org_memberships_client ON client_org_memberships(client_id);

ALTER TABLE client_org_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_org_memberships_select" ON client_org_memberships
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    OR client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
  );
```

### 11.5 `projects`

```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_number text NOT NULL,
  site_address text NOT NULL,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  current_stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE RESTRICT,
  scope_summary text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, project_number)
);

CREATE INDEX idx_projects_org ON projects(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_stage ON projects(current_stage_id) WHERE deleted_at IS NULL;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_org_or_stakeholder" ON projects
  FOR SELECT USING (
    -- Org members
    org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    OR
    -- Accepted stakeholders
    id IN (
      SELECT ps.project_id FROM project_stakeholders ps
      JOIN clients c ON c.id = ps.client_id
      WHERE c.auth_user_id = auth.uid()
        AND c.deleted_at IS NULL
        AND ps.deleted_at IS NULL
        AND ps.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "projects_modify_org_members" ON projects
  FOR ALL USING (
    org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
  );
```

### 11.6 `project_stakeholders`

```sql
CREATE TABLE project_stakeholders (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN (
    'primary_client', 'collaborator', 'observer', 'billing_contact'
  )),
  visibility_profile text NOT NULL CHECK (visibility_profile IN (
    'full', 'progress_only', 'documents_only', 'schedule_only', 'custom'
  )),
  can_message boolean NOT NULL DEFAULT true,
  can_upload_files boolean NOT NULL DEFAULT true,
  can_view_financials boolean NOT NULL DEFAULT false,
  can_view_drawings boolean NOT NULL DEFAULT true,
  can_view_schedule boolean NOT NULL DEFAULT true,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, client_id)
);

CREATE INDEX idx_project_stakeholders_project ON project_stakeholders(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_project_stakeholders_client ON project_stakeholders(client_id) WHERE deleted_at IS NULL;

ALTER TABLE project_stakeholders ENABLE ROW LEVEL SECURITY;

-- Per-command shape (see §9 "Policy shape convention" — FOR ALL is forbidden).
-- SELECT keeps deleted_at filtering; modify policies intentionally omit it so re-invite-via-undelete works.

CREATE POLICY "project_stakeholders_select" ON project_stakeholders
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      -- Org members of the project's org
      project_id IN (
        SELECT id FROM projects
        WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
      )
      OR
      -- The stakeholder themselves
      client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );

CREATE POLICY "project_stakeholders_insert_org_members" ON project_stakeholders
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );

CREATE POLICY "project_stakeholders_update_org_members" ON project_stakeholders
  FOR UPDATE USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  ) WITH CHECK (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );

CREATE POLICY "project_stakeholders_delete_org_members" ON project_stakeholders
  FOR DELETE USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );
```

### 11.7 `project_milestones`

```sql
CREATE TABLE project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  scheduled_at timestamptz,
  completed_at timestamptz,
  visible_to_stakeholders boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_project_milestones_project ON project_milestones(project_id) WHERE deleted_at IS NULL;

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;

-- Per-command shape (see §9 "Policy shape convention" — FOR ALL is forbidden).
-- SELECT enforces deleted_at filtering and the visibility-flag gate; modify policies are org-scoped only.

CREATE POLICY "project_milestones_select" ON project_milestones
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      project_id IN (
        SELECT id FROM projects
        WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
      )
      OR (
        visible_to_stakeholders = true
        AND project_id IN (
          SELECT ps.project_id FROM project_stakeholders ps
          JOIN clients c ON c.id = ps.client_id
          WHERE c.auth_user_id = auth.uid()
            AND ps.can_view_schedule = true
            AND ps.deleted_at IS NULL
            AND ps.accepted_at IS NOT NULL
        )
      )
    )
  );

CREATE POLICY "project_milestones_insert_org_members" ON project_milestones
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );

CREATE POLICY "project_milestones_update_org_members" ON project_milestones
  FOR UPDATE USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  ) WITH CHECK (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );

CREATE POLICY "project_milestones_delete_org_members" ON project_milestones
  FOR DELETE USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
  );
```

### Phase 1b backfills

After 1b tables exist, add the deferred FKs:

```sql
ALTER TABLE invitations
  ADD CONSTRAINT invitations_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_client_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
```

---

## 12. Schema — Phase 1c Tables

Seven tables ship in Phase 1c.

### 12.1 `conversations`

```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,  -- NULL for general threads
  type text NOT NULL CHECK (type IN ('one_to_one', 'group', 'general')),
  name text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_conversations_project ON conversations(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_conversations_org ON conversations(org_id) WHERE deleted_at IS NULL;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select_participants" ON conversations
  FOR SELECT USING (
    -- Org members of the conversation's org
    org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    OR
    -- Conversation participants (stakeholders)
    id IN (
      SELECT cp.conversation_id FROM conversation_participants cp
      WHERE (
        cp.participant_type = 'client'
        AND cp.participant_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
      )
    )
  );
```

### 12.2 `conversation_participants`

```sql
CREATE TABLE conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  participant_type text NOT NULL CHECK (participant_type IN ('user', 'client')),
  participant_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  UNIQUE (conversation_id, participant_type, participant_id)
);

CREATE INDEX idx_conversation_participants_conversation ON conversation_participants(conversation_id);
CREATE INDEX idx_conversation_participants_participant ON conversation_participants(participant_type, participant_id);

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_participants_select" ON conversation_participants
  FOR SELECT USING (
    conversation_id IN (SELECT id FROM conversations)  -- inherits via conversations RLS
  );
```

### 12.3 `messages`

```sql
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'client', 'system')),
  sender_id uuid,  -- NULL for system messages
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  edited_at timestamptz
);

CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_participants" ON messages
  FOR SELECT USING (
    conversation_id IN (SELECT id FROM conversations)
  );

CREATE POLICY "messages_insert_participants" ON messages
  FOR INSERT WITH CHECK (
    conversation_id IN (
      SELECT cp.conversation_id FROM conversation_participants cp
      WHERE (
        (cp.participant_type = 'user' AND cp.participant_id IN (
          SELECT id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
        ))
        OR
        (cp.participant_type = 'client' AND cp.participant_id IN (
          SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
        ))
      )
    )
    AND (
      -- For client senders, must have can_message = true on the project
      sender_type != 'client'
      OR (
        SELECT can_message FROM project_stakeholders ps
        WHERE ps.client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
          AND ps.project_id = (SELECT project_id FROM conversations WHERE id = conversation_id)
        LIMIT 1
      ) = true
    )
  );
```

### 12.4 `project_files`

```sql
CREATE TABLE project_files (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by_type text NOT NULL CHECK (uploaded_by_type IN ('user', 'client')),
  uploaded_by_id uuid NOT NULL,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('surveyor_upload', 'client_upload', 'document_artifact')),
  visibility text NOT NULL DEFAULT 'org_and_stakeholders'
    CHECK (visibility IN ('org_only', 'org_and_stakeholders')),
  thumbnail_path text,                              -- nullable; reserved for a future preview-generation pipeline (DEBT-032)
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_project_files_project ON project_files(project_id) WHERE deleted_at IS NULL;

ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_files_select" ON project_files
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
    OR (
      visibility = 'org_and_stakeholders'
      AND project_id IN (
        SELECT ps.project_id FROM project_stakeholders ps
        WHERE ps.client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
          AND ps.can_view_drawings = true
          AND ps.deleted_at IS NULL
          AND ps.accepted_at IS NOT NULL
      )
    )
  );
```

**Server-query visibility filter (DEBT-R006, MINI-SESSION-DEBT-059).** The Drizzle pooler client (`@/db`) connects as the postgres role and bypasses the SELECT policy above. The canonical pattern for stakeholder-reachable file queries is a REQUIRED `visibleOnly: boolean` parameter on the query function: when `true`, the WHERE ANDs in `visibility = 'org_and_stakeholders'`; when `false`, no extra filter. Required (not optional with default) so TypeScript fails any missed caller. Stakeholder-context callers (under `app/portal/**`) pass `true`; org-context callers (under `app/(org)/**`) pass `false`. Implementation: `db/queries/files.ts:listFilesForProject` (the fix); reference parallel for activity rows: `db/queries/project-activity.ts:listProjectActivity` (Session 11 Phase 9 — same flag shape on the `visible_to_stakeholders` boolean). The RLS policy above remains the canonical gate at the database boundary and re-applies if a future caller routes through the Supabase REST/authenticated client — the query-layer flag is defense-in-depth, not a replacement.

### 12.5 `notification_preferences`

```sql
CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'in_app', 'push', 'sms')),
  event_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  CHECK ((user_id IS NOT NULL) <> (client_id IS NOT NULL)),  -- exactly one set
  UNIQUE (user_id, channel, event_type),
  UNIQUE (client_id, channel, event_type)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_self" ON notification_preferences
  FOR ALL USING (
    (user_id IS NOT NULL AND user_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL))
    OR
    (client_id IS NOT NULL AND client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL))
  );
```

### 12.6 `notifications`

```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  recipient_type text NOT NULL CHECK (recipient_type IN ('user', 'client')),
  recipient_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'in_app', 'push', 'sms')),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_type, recipient_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_unsent ON notifications(channel) WHERE sent_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_self" ON notifications
  FOR SELECT USING (
    (recipient_type = 'user' AND recipient_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL))
    OR
    (recipient_type = 'client' AND recipient_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL))
  );

CREATE POLICY "notifications_update_self_read" ON notifications
  FOR UPDATE USING (
    (recipient_type = 'user' AND recipient_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL))
    OR
    (recipient_type = 'client' AND recipient_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL))
  );
```

### 12.7 `project_activity`

```sql
CREATE TABLE project_activity (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'client', 'system')),
  actor_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  visible_to_stakeholders boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_activity_project_created ON project_activity(project_id, created_at DESC);

ALTER TABLE project_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_activity_select" ON project_activity
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    )
    OR (
      visible_to_stakeholders = true
      AND project_id IN (
        SELECT ps.project_id FROM project_stakeholders ps
        WHERE ps.client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
          AND ps.deleted_at IS NULL
          AND ps.accepted_at IS NOT NULL
      )
    )
  );
```


---

## 12.P2. Schema — Phase 2 Tables

Three tables ship in Phase 2: `documents` (S12), `document_tokens` (S12), `payments` (S13). Plus additive columns:
- Session 13 (migration 0026): `payment_id`, `invoice_subtype`, `revision_number`, `revision_log_payload` on `documents`.
- Session 14 (migration 0028): `recipient_name` on `documents` (receipt-only "addressed to") + `source_document_id` FK on `project_files` (lookup for cached PDF artifacts).

**Receipts** ride the existing `documents` shape — no new table. Each receipt is a `documents` row with `type='receipt'`, `payment_id` pointing at the linked `payments` row, and `recipient_name` snapshotted from the project's primary client. **PDFs** are stored as `project_files` rows with `source='document_artifact'` (existing enum value) + `source_document_id` (Session 14 FK) — no parallel file system. **Portal-side financial visibility** uses the same `db/queries/{documents,payments}.ts` functions with the `visibleOnly: true` branch + `stakeholderAuthUserId` for query-layer defense-in-depth (DEBT-059 / DEBT-R006 pattern).

### 12.P2.1 `documents`

```sql
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('quote','invoice','receipt')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','superseded','void')),
  document_number text NOT NULL,
  sequence int NOT NULL CHECK (sequence >= 1),
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  vat_applicable boolean NOT NULL DEFAULT false,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name text,
  supersedes_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  -- Session 13 additive columns (migration 0026) ─────────────────────────
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,                  -- receipt-only; populated in S14
  invoice_subtype text CHECK (invoice_subtype IS NULL OR invoice_subtype IN ('initial','final')),
  revision_number int NOT NULL DEFAULT 0,
  revision_log_payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Session 14 additive column (migration 0028) ────────────────────────
  recipient_name text,                                                          -- receipt-only "addressed to" field; revisable via reviseReceipt
  -- ─────────────────────────────────────────────────────────────────────
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, type, sequence),
  CHECK (subtotal >= 0 AND vat_amount >= 0 AND total >= 0)
);

CREATE INDEX idx_documents_project ON documents(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_org ON documents(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_payment_id ON documents(payment_id) WHERE deleted_at IS NULL AND payment_id IS NOT NULL;
```

**Session 13 column invariants:**
- `invoice_subtype` is set for `type='invoice'` rows (`'initial'` or `'final'`), NULL for quotes/receipts. **No CHECK enforces initial-before-final** — V2 doesn't, scope doesn't, and the surveyor practice (deposit / mobilisation only, no final invoice) is legitimate.
- `revision_number` + `revision_log_payload` track revise calls. For invoices, `reviseInvoice` (V1 port) appends one entry per call: `{ rev, previous_amount, new_amount, fields_changed: string[], reason, revised_at, revised_by }`. The diff is **semantic** — `lib/documents/revise-diff.ts:diffInvoiceFields` compares line items as structs (per-position equality across `description / quantity / unitPrice / category`) so a no-op resave returns `{error:'conflict', reason:'no_changes'}` rather than logging a phantom revision. For receipts (Session 14), `reviseReceipt` appends an entry with the same shape plus `previous_recipient_name` / `new_recipient_name` (recipient-only field); a no-op recipient resave also returns `conflict/no_changes`.
- `payment_id` is **receipt-only** (Session 14 populates). The column lands in Session 13 because the FK target (`payments`) is created in 0025; splitting it across two migrations would be pointless. Quotes/invoices keep it NULL.

**Session 14 column invariants:**
- `recipient_name` is **receipt-only** in current use. Snapshotted from the project's primary client at `recordPayment` time (same client lookup shape as `sendInvoice` uses for the email recipient). Revisable independently via `reviseReceipt` so the surveyor can correct a recipient name without touching the underlying clients row. Quotes/invoices keep it NULL — the column is universal but only receipts populate it.
- The **receipt-payment consistency model** is "snapshot kept in lockstep" (Session 14 Plan Q2): receipts populate `subtotal=amount, vat_amount=0, total=amount, line_items=[{description: 'Payment received', quantity: 1, unitPrice: amount}]` at creation; `correctPayment` updates these in the same tx that mutates `payments.amount`. Both rows always agree, so the receipt PDF/page renders straight from the documents row with no JOIN. Cached PDFs (project_files rows with `source='document_artifact' AND source_document_id=receipt.id`) are soft-deleted post-commit so the next download regenerates from the corrected total.

**Key invariants:**
- **One table discriminated by `type`.** Phase 2 ships `quote` only; Sessions 13–14 exercise `invoice` and `receipt` on the same shape.
- **Status enum is `draft`/`sent`/`superseded`/`void`.** Acceptance is the boolean `accepted_at IS NOT NULL`, NOT a status value (matches V2's `quote_accepted` flip).
- **Money columns:** `subtotal` is the pre-discount line-item sum; `vat_amount` is computed on the discounted subtotal; `total = subtotal − discount_amount + vat_amount`. `discount_amount` is derived on read from `discount_pct + subtotal` (exact reconstruction, not stored). See `lib/documents/vat.ts:calculateTotals` for the rounding cascade.
- **Numbering:** `document_number` follows `{projects.project_number}-{TYPE_CHAR}{sequence}` (TYPE_CHAR = Q/I/R). Allocated by `lib/documents/numbering.ts:allocateDocumentNumber` under a `SELECT FOR UPDATE` on the projects row. The UNIQUE constraint on `(project_id, type, sequence)` is the belt-and-braces.
- **Revision chain:** `supersedes_document_id` self-FK supports "revise a sent quote = new row + old row.status flips to 'superseded'". `ON DELETE SET NULL` so admin-recovery of the parent doesn't take the child with it.
- **Soft-delete via `deleted_at`.** Soft-deleted rows count toward the sequence — no number recycling.

**RLS (migration 0023, four per-command policies — ADR-016):**
- `documents_select`: `deleted_at IS NULL AND (project_id IN (auth_user_org_project_ids()) OR COALESCE((SELECT can_view_financials FROM auth_user_stakeholder_project_visibility(project_id)), false))`. This is the §14/§26 financial-visibility branch made live.
- `documents_insert_org_members`: project_id in caller's org-project set AND `created_by` matches caller's `public.users.id`.
- `documents_update_org_members`: org-members of the project's org. The token-authorized `acceptQuote` write does NOT pass through this policy — it routes through the Drizzle pooler (RLS-bypass) per ADR-034.
- `documents_delete_org_admins`: admin-recovery hard-delete only.

### 12.P2.2 `document_tokens`

```sql
CREATE TABLE document_tokens (
  id uuid PRIMARY KEY,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('quote','invoice','receipt')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_document_tokens_token ON document_tokens(token);
CREATE INDEX idx_document_tokens_document ON document_tokens(document_id);
```

**Key invariants:**
- **`token` is uuid v4 (random), not v7.** §25 rationale: a public-route gate needs randomness, not time-sortability. `id` stays uuid v7 (app-generated) for index locality per the project-wide PK convention.
- **`document_type` is duplicated on the token row** so the public-route lookup can match `(token, document_type)` in a single index probe without first resolving the document. Token-type mismatch (e.g. an invoice token hitting `/q/`) returns 404 — part of the ADR-034 security envelope.
- **No revocation in Phase 2** (matches Apps Script ADR-001). A future additive `revoked_at` column is the natural shape if needed.

**RLS (migration 0024, four per-command policies):**
All four gate on org-membership of the underlying document's project via the subquery `document_id IN (SELECT id FROM documents WHERE project_id IN (auth_user_org_project_ids()))`. Stakeholders don't list tokens (they reach docs by URL); the `can_view_financials` branch of `documents`' RLS is intentionally NOT propagated here.

### 12.P2.3 Helpers + actions

- **`lib/documents/vat.ts:calculateTotals`** — pure-math VAT/discount/total computer. Integer-pennies internally, rounds per-line then discount then VAT separately. Used by the org-side form for live totals AND by every server-side create/update/revise path.
- **`lib/documents/numbering.ts:allocateDocumentNumber`** — tx-bound, `SELECT FOR UPDATE` on projects row + count + format (`{projectNumber}-{Q|I|R}{sequence}`). Caller must INSERT the document inside the same tx; otherwise the next allocator sees the same count and reuses the sequence (the UNIQUE constraint catches it but is the belt, not the braces).
- **`lib/documents/payment-status.ts:derivePaymentStatus`** *(Session 13)* — pure function over `{ hasAnyQuoteSent, acceptedQuoteTotal, hasInitialInvoiceSent, hasFinalInvoiceSent, paymentsTotal }`. Returns one of 7 labels (`no_quote → quote_sent → quote_accepted → initial_invoice_sent → partially_paid → paid_in_full → overpaid`). Computed on read every project-detail render — **nothing stored**. Payment target is the **accepted quote's `total`**, not the invoice sum. A 0.005-tolerance epsilon absorbs sub-penny float drift on the `paid_in_full` boundary. Refunds are out of scope (`payments.amount > 0` CHECK precludes negative rows — see DEBT-065).
- **`lib/documents/revise-diff.ts:diffInvoiceFields`** *(Session 13)* — semantic comparator over invoice fields. Returns `{ fieldsChanged: string[], hasChanges: boolean }`. Line items compared positionally as structs (trim-equal description/category, 2dp-tolerance numeric quantity/unitPrice). A no-op resave returns `hasChanges: false`; `reviseInvoice` rejects with `{error:'conflict', reason:'no_changes'}` rather than logging a phantom revision.
- **`actions/documents.ts`** — `createQuote` / `updateQuoteDraft` / `sendQuote` / `acceptQuote` (S12) + `createInvoice` / `updateInvoiceDraft` / `sendInvoice` / `reviseInvoice` (S13) + `reviseReceipt` (S14). All except `acceptQuote` follow §20's `requireOrgUser` shape. `acceptQuote` follows ADR-034 (token-authorized public write). `sendQuote` / `sendInvoice` dispatch the direct client Resend email post-commit per ADR-033; **all five S13-wired actions** (`sendQuote` / `acceptQuote` / `sendInvoice` / `recordPayment` / `correctPayment`) also fan out via `dispatchNotification` to org members + accepted financial-visible stakeholders (except `correctPayment` which dispatches to org members ONLY — administrative event, per Q2 decision). `createInvoice` rejects `subtype='final'` without an accepted quote on the project (`{error:'conflict', reason:'no_accepted_quote'}`); `subtype='initial'` is allowed without one (deposit/mobilisation flow). `reviseReceipt` (S14) edits `recipient_name` only — money mirrors the linked payment via `correctPayment` — and appends a revision-log entry; status='sent' precondition; activity row is `visibleToStakeholders=false` (recipient relabel is org-internal); cached PDF invalidated post-commit.
- **`actions/payments.ts`** *(Session 13 + 14)* — `recordPayment` (insert payment + auto-create receipt as `documents` row of type='receipt' linked via payment_id + mint receipt's `document_tokens` row + activity rows for both `payment.recorded` AND `receipt.generated` (both `visibleToStakeholders=true`) + audit both rows + post-commit dispatch to org + financial-visible stakeholders for `payment.recorded` only — receipt.generated is activity-only since recipients overlap and a second fan-out would be notification spam). `correctPayment` (mutate `amount` in place + append `correction_log_payload` entry + UPDATE the linked receipt's `subtotal/total/lineItems` in the same tx (Session 14 lockstep) + activity `visibleToStakeholders=false` + audit + dispatch to org members only + post-commit invalidate the receipt's cached PDF).
- **`actions/document-pdf.ts`** *(Session 14)* — `generateDocumentPdf({documentId})` (org-side, requireOrgUser) + `generateDocumentPdfFromToken({token})` (public-side, ADR-034 envelope: rate-limited, no auth, cross-type 404). Find-or-create model: looks up `project_files` rows WHERE `source_document_id=docId AND source='document_artifact' AND deleted_at IS NULL` (single index probe via 0028's partial index); if found, signs a fresh 1-hour download URL; if not, renders the PDF buffer via `lib/pdf/render`, uploads to `org-files` bucket at `org/{orgId}/projects/{projectId}/documents/{fileId}.pdf` (mirrors `actions/files.ts:buildStoragePath`), inserts a `project_files` row with `source='document_artifact'` + `source_document_id` + `visibility='org_only'` (PDF artifacts aren't drawings — they're shared via the document_tokens link, not via the stakeholder file list), and signs the URL. Re-export `invalidateDocumentPdfCache` for back-compat with the original Plan reference.
- **`lib/pdf/{document-template.tsx,render.ts,cache.ts}`** *(Session 14)* — One parameterised React-PDF template covering quote/invoice/receipt (per-type variation is conditional inside the template — Quote shows acceptance block when accepted; Invoice shows subtype label + revision count; Receipt shows PAID stamp + recipient + payment-recorded date). `render.ts:renderDocumentPdf` returns a Node Buffer for upload. `cache.ts:invalidateDocumentPdfCache` is a leaf module (no @react-pdf imports) so action callers (`reviseInvoice` / `reviseReceipt` / `correctPayment`) can soft-delete cached PDFs without pulling the renderer into their import graphs.
- **`db/queries/documents.ts`** — `listQuotesForProject({ visibleOnly, stakeholderAuthUserId? })`, `listInvoicesForProject(...)` *(S13)*, `listReceiptsForProject(...)` *(S14)*, `getDocumentById`, `getDocumentByToken`, `hasStakeholderFinancialAccess({ projectId, authUserId })` *(S14)*. The base `DocumentRow` shape now includes `invoiceSubtype`, `revisionNumber`, `revisionLogPayload`, `paymentId`, `recipientName` (defaulted on quote/invoice rows). `InvoiceRow` and `ReceiptRow` are semantic aliases. The list queries' `visibleOnly: true` branch verifies `stakeholderAuthUserId` has `can_view_financials=true` access via `hasStakeholderFinancialAccess` and returns `[]` otherwise (DEBT-059 / DEBT-R006 defense-in-depth pattern); they also filter to `sentAt IS NOT NULL` rows for stakeholder callers (drafts are org-internal).
- **`db/queries/payments.ts`** *(Session 13 + 14)* — `getPaymentsForProject({ visibleOnly, stakeholderAuthUserId? })` returns `{ rows, runningTotal }`. Same `visibleOnly: true` defense-in-depth as the document queries. `PaymentRow` now carries `receiptId` and `receiptNumber` populated by a LEFT JOIN on `documents.payment_id`; the bidirectional payment↔receipt UI link reads these. `getProjectPaymentSnapshot(projectId)` aggregates the four primitives the payment-status function needs in one helper, then derives the label. The project detail page calls this in its `Promise.all` block.

### 12.P2.4 Public routes

- `/q/[token]` — live (Session 12). Token validation → `publicDoc` rate-limit → `getDocumentByToken` → render quote with AcceptForm (only when status='sent' and not yet accepted). Session 14: `DownloadPdfButton` (token mode) added.
- `/i/[token]` — live (Session 13). Read-only invoice view. No AcceptForm (invoices aren't accepted; payments are org-side). Same UUID gate + rate-limit shape as `/q/`. Cross-type tokens 404 per ADR-034. Session 14: `DownloadPdfButton` added.
- `/r/[token]` — live (Session 14). Read-only receipt view. PAID badge, recipient name (when set), single-line totals, `DownloadPdfButton`. Same UUID gate + `publicDoc` rate-limit + cross-type 404 shape as `/q/` and `/i/`. No token-authorized writes from this page (receipts record what happened, not what's about to).

### 12.P2.5 `payments` *(Session 13)*

```sql
CREATE TABLE payments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correction_log_payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_payments_project ON payments(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_org ON payments(org_id) WHERE deleted_at IS NULL;
```

**Key invariants:**
- Each `recordPayment` call inserts one row. The running total for a project is `SUM(amount) WHERE deleted_at IS NULL` — never a stored field.
- Payment target for the derived payment-status axis is the **accepted quote's `total`**, not the sum of invoice amounts. Invoices are independent slices of the contract value; the quote total is the contract.
- `amount > 0` CHECK precludes negative rows. Refund modelling needs a separate shape (DEBT-065).
- `correction_log_payload` is the UI-visible history of `amount` mutations performed by `correctPayment`. Each entry: `{ previous_amount, new_amount, corrected_at, corrected_by, reason }`. `audit_logs` is the system-of-record (Hard Rule 4); the JSON column is a denormalized read-side convenience.

**RLS (migration 0025, four per-command policies — ADR-016):**
- `payments_select`: `deleted_at IS NULL AND (org member of the project's org OR can_view_financials stakeholder)`. Mirrors `documents_select` exactly — the §14 financial-visibility gate applied to payments.
- `payments_insert_org_members`: project_id in caller's org-project set AND `recorded_by` matches caller's `public.users.id` (closes the cross-user `recorded_by` hole).
- `payments_update_org_members`: org members of the project's org (UPDATE required for amount corrections).
- `payments_delete_org_admins`: hard-delete is admin-recovery only.

### 12.P2.6 DEBT-064 backfill *(Session 13)*

Migration 0027 idempotently seeds `notification_preferences` rows for all existing identities (users + clients-with-org-membership) × 6 new event types (`quote.sent`, `quote.accepted`, `invoice.sent`, `invoice.revised`, `payment.recorded`, `payment.corrected`) × 4 channels (`in_app` + `email` enabled by default; `push` + `sms` disabled). Two `INSERT … SELECT … ON CONFLICT DO NOTHING` blocks (one per identity type) hit the two existing UNIQUE constraints — re-running the migration is a verified no-op. New identities continue to get rows via `lib/notifications/seed-defaults.ts:seedNotificationDefaultsTx` at create time. Without this backfill, dispatch fan-out to existing identities would silently return 0 enabled-channels (operationally surprising; not a data leak).

### 12.P2.7 Receipts *(Session 14)*

**No new table.** Receipts are `documents` rows with `type='receipt'`, populating the `payment_id` FK that S13 added. The full receipt shape:
- `type='receipt'`, `status='sent'` (auto-created in the sent state — there's no draft receipt; the payment IS the trigger).
- `document_number` allocated by `lib/documents/numbering.ts:allocateDocumentNumber` as `{projectNumber}-R{seq}`. The same `SELECT FOR UPDATE` lock works inside `recordPayment`'s tx.
- `payment_id` set to the just-inserted payment's id; `documents_payment_id_payments_id_fk` makes this an explicit referential link.
- `recipient_name` snapshotted from the project's primary client at creation time. Revisable via `reviseReceipt` (see §12.P2.3).
- `subtotal/total = payment.amount`, `vat_amount = 0`, `discount_pct = 0`, `vat_applicable = false`, `line_items = [{description: 'Payment received', quantity: 1, unitPrice: payment.amount, category: 'payment'}]`. The lockstep maintained by `correctPayment` keeps these in sync with the underlying payment.
- A `document_tokens` row is also minted in the same tx (random uuid v4, `document_type='receipt'`).

**Receipt invariant:** exactly one non-soft-deleted receipt per payment. Enforced operationally — `recordPayment` is the only path that creates a receipt, and it creates one receipt atomically with the payment. Tested in `tests/actions/receipts.test.ts`.

### 12.P2.8 PDF generation subsystem *(Session 14)*

**Library:** `@react-pdf/renderer` v4. Pure JS, no native deps, runs on Vercel serverless out of the box (no special configuration needed). Resolves the §34 "Document generation backend" deferred decision.

**Template:** one parameterised React-PDF component (`lib/pdf/document-template.tsx:DocumentPdfTemplate`) covering all three document types. Per-type variation lives as conditional renders inside the template:
- Quote: shows acceptance block when `acceptedAt` is set (with `acceptedByName` + date).
- Invoice: shows `{Initial|Final}` subtype label; revision count if `revisionNumber > 0`.
- Receipt: shows PAID stamp; "Received from {recipient_name}"; payment-recorded date in the header.

**Render path:** `lib/pdf/render.ts:renderDocumentPdf(data) → { buffer, sizeBytes, mimeType }`. Uses React-PDF's `renderToBuffer` to collect chunks into a Node Buffer.

**Storage:** PDFs are stored as `project_files` rows with `source='document_artifact'` (existing enum) + `source_document_id` (S14 FK) + `visibility='org_only'` (artifact, not a drawing). Storage path: `org/{orgId}/projects/{projectId}/documents/{fileId}.pdf` — mirrors `actions/files.ts:buildStoragePath`.

**Lookup + caching:** `actions/document-pdf.ts:generateDocumentPdf` uses a find-or-create model. The 0028 partial index `idx_project_files_source_document_id WHERE deleted_at IS NULL AND source_document_id IS NOT NULL` makes the lookup a single index probe.

**Cache invalidation:** `lib/pdf/cache.ts:invalidateDocumentPdfCache(documentId)` soft-deletes any active cached PDF rows. Called post-commit by `reviseInvoice`, `reviseReceipt`, and `correctPayment` so the next `generateDocumentPdf` regenerates from the post-mutation state.

**Two callable surfaces:**
- `generateDocumentPdf({documentId})` — org-side, `requireOrgUser`, scopes documentId to ctx.orgId.
- `generateDocumentPdfFromToken({token})` — public-side, no auth, `publicDoc` rate-limited (keyed by `pdf:{token}`), resolves the document via `document_tokens`, applies the same draft/void status guards as the public read pages. Token-context audit row carries `metadata.via='public_token'` (matches `acceptQuote`'s ADR-034 pattern).

Both return `{ downloadUrl, filename, mimeType, expiresInSeconds }` with a 1-hour signed URL (matches `actions/files.ts:DOWNLOAD_TTL_SECONDS`).

### 12.P2.9 Portal-side financial visibility *(Session 14)*

**Defense-in-depth helper:** `db/queries/documents.ts:hasStakeholderFinancialAccess({ projectId, authUserId })` mirrors the SECURITY DEFINER `auth_user_stakeholder_project_visibility(uuid)`. Drizzle pooler bypasses RLS (DEBT-059 / DEBT-R006 pattern), so this query layer enforces the §14 financial-visibility gate explicitly. Returns true iff the auth user is an accepted stakeholder of the project with `can_view_financials=true`.

**`visibleOnly: true` branches** (Session 14 wired — was a S13 short-circuit-to-`[]`):
- `listQuotesForProject({ visibleOnly: true, stakeholderAuthUserId })` → real rows when access granted, `[]` otherwise. Also filters to `sentAt IS NOT NULL` rows for stakeholder callers (drafts are org-internal).
- `listInvoicesForProject({ visibleOnly: true, stakeholderAuthUserId })` → same shape.
- `listReceiptsForProject({ visibleOnly: true, stakeholderAuthUserId })` → same shape.
- `getPaymentsForProject({ visibleOnly: true, stakeholderAuthUserId })` → `{ rows, runningTotal }` when access granted, `{ rows: [], runningTotal: 0 }` otherwise.

Without `stakeholderAuthUserId` the queries also return `[]` / 0 — preserves the safe S13 default for any caller that hasn't been migrated.

**Portal page:** `/portal/projects/[id]/page.tsx` renders `<QuotesSection viewer="stakeholder" stakeholderAuthUserId={ctx.authUserId} />`, `<InvoicesSection ... />`, `<PaymentsSection ... />`, `<ReceiptsSection ... />` only when `view.flags.canViewFinancials === true`. Each section's stakeholder mode hides write affordances (Create / Record / Correct / Revise / Open), making the surface read-only.

**Coming Soon profitability:** `components/projects/ProfitabilityComingSoon.tsx` renders an org-side ONLY card on `/dashboard/projects/[id]` (after PaymentsSection / ReceiptsSection, before ActivityTimeline). Per kickoff §2.11: never rendered under `/portal`. The placeholder signals "this view is queued, not abandoned" to the in-house team and serves as the self-imposed contract that the Phase 2 schema leaves a clean seam for the deferred financial model (income breakdown / expenses / profit / people / AW snapshot — phase-2-scope.md §3.1).

---

## 13. Workflow System

How workflows are defined, seeded, cloned, and used.

### Concept

A `workflow` is a named, ordered set of `workflow_stages`. Every project is assigned exactly one workflow at creation. The project's `current_stage_id` references one stage in that workflow.

### Two flavors

- **System templates** (`is_system_template = true`, `org_id = NULL`): seeded by migration. Never assigned to projects directly. Read-only via RLS for everyone. Used as cloning sources.
- **Org workflows** (`is_system_template = false`, `org_id = <some_org>`): cloned from a template at signup, then editable by org admins. Assigned to projects.

### Seed: "Simple" template

Universal default. Cloned for every new org, regardless of org type.

```sql
INSERT INTO workflows (slug, name, description, is_system_template, org_type_id) VALUES
  ('simple', 'Simple', 'Five-stage default workflow for any project', true, NULL);

-- Stages
INSERT INTO workflow_stages (workflow_id, slug, name, position, is_terminal, color) VALUES
  ((SELECT id FROM workflows WHERE slug = 'simple' AND is_system_template = true), 'new', 'New', 1, false, '#94a3b8'),
  ((SELECT id FROM workflows WHERE slug = 'simple' AND is_system_template = true), 'in_progress', 'In Progress', 2, false, '#3b82f6'),
  ((SELECT id FROM workflows WHERE slug = 'simple' AND is_system_template = true), 'on_hold', 'On Hold', 3, false, '#f59e0b'),
  ((SELECT id FROM workflows WHERE slug = 'simple' AND is_system_template = true), 'completed', 'Completed', 4, true, '#10b981'),
  ((SELECT id FROM workflows WHERE slug = 'simple' AND is_system_template = true), 'cancelled', 'Cancelled', 5, true, '#ef4444');
```

### Seed: "PCD Surveyor" template (Hasnath's org only)

Mirrors the Apps Script status enum for migration parity. Seeded only on Hasnath's org via the standalone idempotent script `scripts/seed-hasnath-pcd-surveyor.ts` (npm: `db:seed-pcd-surveyor`) — NOT a SQL migration. The script finds Hasnath's org via `org_settings` (key=`company.company_number`, value=`"16240187"`) and inserts a non-template `workflows` row + 8 stages.

```
Stages (1-indexed, terminal=true on the last only):
  Quoted          #94a3b8 (slate)
  Quote Accepted  #06b6d4 (cyan)
  Invoice Sent    #3b82f6 (blue)
  Confirmed       #8b5cf6 (violet)
  Survey Booked   #a855f7 (purple)
  Drawing In Progress #f59e0b (amber)
  QA              #fb923c (orange)
  Completed       #10b981 (emerald, terminal)
```

Why a script and not a migration: this template is intentionally org-specific. Seeding it as a system template would clone it for every new org by default — wrong, as it only fits Hasnath's surveyor business flow. Run the script post-signup once Hasnath's org exists with `company_number` populated in settings. Idempotent: re-running on an already-seeded org exits cleanly. Aborts loudly if multiple orgs match.

### Cloning on signup

When a new org is created (in `actions/orgs.ts`):

```ts
async function cloneSystemTemplateForOrg(orgId: string, templateSlug: string) {
  // 1. Find system template
  const template = await db.query.workflows.findFirst({
    where: and(eq(workflows.slug, templateSlug), eq(workflows.isSystemTemplate, true))
  });

  // 2. Insert new workflow row for the org
  const newWorkflow = await db.insert(workflows).values({
    orgId,
    slug: template.slug,
    name: template.name,
    description: template.description,
    isSystemTemplate: false,
    isDefault: true,
  }).returning();

  // 3. Clone stages
  const templateStages = await db.query.workflowStages.findMany({
    where: eq(workflowStages.workflowId, template.id)
  });

  await db.insert(workflowStages).values(
    templateStages.map(s => ({
      workflowId: newWorkflow.id,
      slug: s.slug,
      name: s.name,
      position: s.position,
      isTerminal: s.isTerminal,
      color: s.color,
    }))
  );
}
```

### Stage transitions

Stage changes happen via `actions/projects.ts → moveProjectToStage(projectId, stageId)`:

1. Verify caller has org access to the project (cross-org → not_found)
2. Verify target stage belongs to project's workflow (else `validation_error/stage_not_in_project_workflow`)
3. Update `projects.current_stage_id` (single-row UPDATE; no transaction needed)
4. Insert `audit_logs` row with `action = 'stage_changed'`, `resource_type = 'project'`, and metadata locked to a 9-field schema (Phase 1b destination — see note below)
5. *(Phase 1c)* Trigger notifications to stakeholders (subject to their visibility profiles)
6. *(Phase 1c)* Insert `project_activity` row mirroring the audit log

Forward and backward transitions are both allowed (mistakes happen — UI surfaces a confirm() prompt for backward, server doesn't block). No automatic transitions in Phase 1. Future phases may add rules ("when invoice marked paid, advance to next stage") but Phase 1 keeps it manual.

**Phase 1b destination for stage_changed events:** `audit_logs` table (§10.7). The dedicated `project_activity` table lands in Phase 1c (Session 11) and notification dispatch reads from there — but for Phase 1b we route stage_changed to `audit_logs` with a forward-compatible metadata schema so Phase 1c can backfill `project_activity` from `audit_logs` rows if needed. The locked metadata fields are: `from_stage_id`, `from_stage_name`, `from_stage_position`, `to_stage_id`, `to_stage_name`, `to_stage_position`, `workflow_id`, `is_backward_transition`, `is_terminal_destination`. **Do not narrow this schema** — Phase 1c notification dispatch consumes all 9 fields and any narrowing requires a migration of historical rows.

---

## 14. Stakeholder Visibility Model

How `project_stakeholders.visibility_profile` controls what stakeholders see.

### Profile presets

Set when inviting a stakeholder. Org users can override individual permissions after invite.

| Profile | can_view_financials | can_view_drawings | can_view_schedule | can_message | can_upload_files |
|---|---|---|---|---|---|
| `full` | true | true | true | true | true |
| `progress_only` | false | true | true | true | true |
| `documents_only` | false | true | false | false | true |
| `schedule_only` | false | false | true | false | false |
| `custom` | (per individual flags) | | | | |

When `custom` is selected, the org user toggles each flag manually.

### How RLS uses these flags

Each stakeholder-accessible table checks the relevant flag in its policy. Examples already shown:

- `project_files` policy checks `can_view_drawings`
- `project_milestones` policy checks `can_view_schedule`
- `messages` insert policy checks `can_message`
- `project_activity` policy checks the per-row `visible_to_stakeholders` boolean (NOT a per-stakeholder profile flag — see below)
- `documents` policy (Phase 2 Session 12) checks `can_view_financials` via `auth_user_stakeholder_project_visibility(project_id)`. A `progress_only` stakeholder gets zero rows; a `full` profile sees the project's quotes.

### Activity timeline visibility model (Session 11)

`project_activity` differs from the other stakeholder-accessible tables: visibility is gated by a per-ROW boolean (`visible_to_stakeholders`), not a per-stakeholder profile flag. The writing server action decides at log time whether the event should surface to stakeholders. Defaults locked in by Phase 5:

- `project.stage_changed` → `true` (stakeholders always see stage transitions)
- `file.uploaded` → mirrors `project_files.visibility` (`true` only when `org_and_stakeholders`)
- `milestone.scheduled` → mirrors `project_milestones.visibleToStakeholders`
- `stakeholder.added_to_project` → `false` (org-internal — stakeholders don't see "X joined")
- `message.new` → NOT logged (per ADR-027 spirit; conversation events live in `messages`)

The timeline server query (`db/queries/project-activity.ts:listProjectActivity`) takes an explicit `visibleOnly: boolean` flag and adds `WHERE visible_to_stakeholders = true` for portal callers — defense-in-depth on top of the RLS policy because the Drizzle pooler bypasses RLS. Org-side callers pass `false` (they see internal rows too).

The timeline UI on both project detail pages surfaces a fixed hint: *"Activity timeline starts at Session 11 launch; earlier project history in the audit log."* (Portal side drops the audit-log reference since stakeholders don't see audit_logs.) This documents the cutover-without-backfill choice locked in by Session 11 Decision 2 — `audit_logs` preserves history losslessly; backfilled `project_activity` rows would have required synthetic `actor_id` inference between schemas (the kind of correctness work that breaks silently).

### Notification preference interaction

Visibility profile gates **what they can see**. Notification preferences gate **how they're told about it**. A stakeholder with `can_view_financials = false` never sees an invoice, regardless of notification preferences. A stakeholder with `can_view_drawings = true` but `notifications.new_file = false` sees the file in-portal but doesn't get an email.

### Runtime override pattern

When org user invites a stakeholder:

1. Pick a preset (e.g. `progress_only`)
2. Optionally toggle individual flags before sending invite
3. The chosen preset is recorded as `visibility_profile`. Individual flags reflect the actual values.
4. Later edits (e.g. enabling `can_upload_files` mid-project) flip the profile to `custom` automatically.

This way the profile is a documentation aid, not a constraint.

---

## 15. Webhook Ingestion Pattern

Generic, idempotent, used by Resend (1a), Stripe (Phase 5), Twilio (Phase 3+).

### Route shape

```
POST /api/webhooks/[source]
```

Source is `resend`, `stripe`, or `twilio` (extensible via CHECK constraint addition).

### Handler flow

```ts
// app/api/webhooks/[source]/route.ts
export async function POST(req: Request, { params }: { params: { source: string } }) {
  const source = params.source;
  
  // 1. Rate limit (per source IP)
  const limited = await rateLimit(`webhook:${source}:${getClientIp(req)}`);
  if (limited) return new Response('Rate limited', { status: 429 });

  // 2. Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get('webhook-signature') ?? '';
  
  // 3. Verify signature (per-source logic)
  const verified = await verifyWebhookSignature(source, rawBody, signature);
  
  // 4. Parse payload + extract idempotency key
  const payload = JSON.parse(rawBody);
  const externalEventId = extractEventId(source, payload);
  const eventType = extractEventType(source, payload);
  
  // 5. Idempotent insert
  const inserted = await db.insert(webhookEvents).values({
    source,
    eventType,
    externalEventId,
    payload,
    signatureVerified: verified,
  }).onConflictDoNothing({ target: [webhookEvents.source, webhookEvents.externalEventId] }).returning();
  
  if (inserted.length === 0) {
    // Already processed (duplicate delivery)
    return new Response('OK (duplicate)', { status: 200 });
  }
  
  // 6. Reject unverified signatures (after recording)
  if (!verified) {
    await markProcessingError(inserted[0].id, 'Signature verification failed');
    return new Response('Invalid signature', { status: 401 });
  }
  
  // 7. Dispatch to source-specific processor
  try {
    await processWebhook(source, inserted[0].id, payload);
    await markProcessed(inserted[0].id);
    return new Response('OK', { status: 200 });
  } catch (error) {
    await markProcessingError(inserted[0].id, String(error));
    Sentry.captureException(error);
    return new Response('Processing error', { status: 500 });  // triggers source retry
  }
}
```

### Per-source modules

```
lib/webhooks/
  ├── verify.ts           # verifyWebhookSignature(source, body, sig)
  ├── extract.ts          # extractEventId, extractEventType per source
  ├── resend.ts           # processResendEvent(payload) — populates email_events
  ├── stripe.ts           # Phase 5
  └── twilio.ts           # Phase 3+
```

### Resend processor (Phase 1a)

Maps Resend webhook events to `email_events`:

```ts
// lib/webhooks/resend.ts
export async function processResendEvent(webhookEventId: string, payload: any) {
  const eventType = mapResendEventType(payload.type);  // e.g. 'email.bounced' → 'bounced'
  
  await db.insert(emailEvents).values({
    webhookEventId,
    messageId: payload.data.email_id,
    recipient: payload.data.to,
    eventType,
    metadata: { ... },
    occurredAt: new Date(payload.created_at),
    orgId: await resolveOrgFromMessageId(payload.data.email_id),  // looked up via outbound message log
  });
}
```

`resolveOrgFromMessageId` looks up the outbound email's org via tags or a separate `outbound_emails` table (tiny, just message_id → org_id mapping at send time).

### Resend webhook configuration

In Resend dashboard, configure webhook to `https://<APP_URL>/api/webhooks/resend` with events:
- `email.sent`
- `email.delivered`
- `email.bounced`
- `email.complained`
- `email.opened` (optional, for analytics)
- `email.clicked` (optional)

Signing secret stored as `RESEND_WEBHOOK_SECRET`.

---

## 16. Email System

Resend wiring for Phase 1a.

### Email types in Phase 1a

| Type | Trigger | Recipients |
|---|---|---|
| Auth confirmation | Supabase Auth signup | Signing-up user |
| Magic link | Supabase Auth or app-issued | User or stakeholder |
| Team invitation | Org owner/admin invites teammate | Invited email |
| Stakeholder invitation | (Phase 1b — included in 1c counter) | Invited email |
| Bounce notification | Resend webhook reports bounce | Org admins (in-app, not email) |

### From-address strategy

- **Default:** `noreply@<APP_DOMAIN>` (e.g. `noreply@pcdportal.com`)
- **Phase 4+:** if org has `custom_email_verified_at IS NOT NULL`, send as `<configured>@<custom_email_domain>` with proper SPF/DKIM/DMARC

Phase 1a only ships the default. The columns exist (`organizations.custom_email_domain`, `organizations.custom_email_verified_at`) but no verification logic yet.

### Templates

```
lib/email/templates/
  ├── auth-magic-link.tsx
  ├── team-invitation.tsx
  ├── stakeholder-invitation.tsx     # Phase 1b
  ├── notification.tsx                # Phase 1c (generic notification email)
  └── _layout.tsx                     # shared header/footer
```

Templates are React Email components. Rendered server-side, sent via Resend's API.

### Sending pattern

```ts
// lib/email/send.ts
export async function sendEmail(opts: {
  to: string;
  template: 'team_invitation' | 'magic_link' | ...;
  data: Record<string, any>;
  orgId?: string;  // for tagging in email_events
}) {
  const { html, text, subject } = await renderTemplate(opts.template, opts.data);
  
  const result = await resend.emails.send({
    from: getFromAddress(opts.orgId),
    to: opts.to,
    subject,
    html,
    text,
    tags: opts.orgId ? [{ name: 'org_id', value: opts.orgId }] : [],
  });
  
  // Record outbound for later org resolution from webhooks
  await db.insert(outboundEmails).values({
    messageId: result.id,
    orgId: opts.orgId,
    recipient: opts.to,
    template: opts.template,
    sentAt: new Date(),
  });
  
  return result;
}
```

### `outbound_emails` table

Small lookup table for webhook → org resolution. Phase 1a includes this:

```sql
CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  message_id text NOT NULL UNIQUE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  template text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbound_emails_message ON outbound_emails(message_id);

ALTER TABLE outbound_emails DISABLE ROW LEVEL SECURITY;  -- service role only
```

This is the tenth Phase 1a table. Total Phase 1a: 10 tables.

---

## 17. Notifications System

Per-user × per-channel × per-event preferences. Dispatched via the notification system.

### Event types (Phase 1c starting set)

```
auth.password_changed
team.invited
team.invitation_accepted
project.created
project.stage_changed
project.completed
stakeholder.invited
stakeholder.added_to_project
message.new
file.uploaded
milestone.scheduled
milestone.completed
```

Extensible via additive migrations on the `notifications.event_type` CHECK (or kept as plain text).

### Channels

Phase 1c implements: `in_app`, `email`.
Phase 3+ adds: `push`, `sms`.

The schema supports all four from day one (CHECK constraint includes them); only the dispatcher is incrementally expanded.

### Preferences default

When a user/client is created, notification preferences are auto-seeded with sensible defaults:

- All `in_app` events: enabled
- All `email` events: enabled
- All `push` events: disabled (not implemented yet anyway)
- All `sms` events: disabled

Users edit via Settings → Notifications matrix UI.

### Dispatcher pattern (post-commit; ADR-033)

```ts
// lib/notifications/dispatch.ts
export async function dispatchNotification(opts: {
  recipientType: 'user' | 'client';
  recipientId: string;
  eventType: NotificationEventType;
  payload: NotificationPayload;
  tx?: DbOrTx; // optional; defaults to top-level db
}): Promise<DispatchResult> {
  // 1. Validate event_type against the locked vocabulary.
  // 2. Look up enabled channels in notification_preferences for the
  //    (recipient_type, recipient_id, event_type) triple.
  // 3. Insert one notifications row per enabled channel.
  // 4. Drive delivery row-by-row:
  //    - in_app: insert only — supabase_realtime publication broadcasts on INSERT.
  //    - email: render via getAppUrl() + notificationGenericEmail; call
  //      sendEmail(); stamp sent_at on success or failed_at + failure_reason
  //      on Resend exception (and Sentry breadcrumb).
  //    - push / sms: insert + immediately stamp failed_at = NOW(),
  //      failure_reason = 'channel_not_implemented'. Schema supports them;
  //      dispatcher rejects until Phase 3+.
}
```

**Calling convention (ADR-033 + Hard Rule 27):** `dispatchNotification` runs AFTER the action's `db.transaction(...)` commits — NEVER inside it. The transaction holds only DB-level writes (the action's domain mutation plus `logActivityTx` rows; both atomic-with-action is desirable). Anything that calls an external HTTPS service moves outside the tx.

Five Session 11 wired actions follow this pattern: `sendMessage` → `message.new`, `moveProjectToStage` → `project.stage_changed`, `confirmUpload` → `file.uploaded`, `inviteStakeholder` → `stakeholder.added_to_project`, `createMilestone` → `milestone.scheduled` (only when `scheduledAt` is set). Recipient-list queries also move outside the transaction — read-only lookups don't need to hold the pooled connection.

**Per-recipient failure isolation:** each `dispatchNotification` call site is wrapped in its own `try/catch`. Failures are captured to Sentry with `scope: 'notification_dispatch'` + action/event/org tags but do NOT re-throw. One Resend hiccup doesn't kill the rest of the fan-out, and no notification failure ever rolls back a committed domain write.

**Why post-commit (DEBT-049):** Session 11 Phase 5 originally wired the dispatcher inside transactions per the then-current kickoff Hard Rule 6 ("all atomic"). Phase F's first stakeholder-invite request hit Vercel 504 because each Resend call inside the dispatcher loop held the tx open for ~1-2s, exceeding the 10s function limit on a 2-3 person test org. ADR-033 enshrines the post-commit carveout; Session 11 hotfix commit refactored all 5 actions in one pass.

### In-app delivery via Realtime (with polling fallback)

When an `in_app` notification is INSERTed, Supabase Realtime broadcasts on channel `notifications:<recipientType>:<recipientId>` via the publication added in migration 0021. The frontend hook (`hooks/use-notifications.ts`) subscribes to `postgres_changes` INSERT + UPDATE events filtered by `recipient_id=eq.<id>`.

**Belt-and-braces polling fallback:** the same hook polls every 30 seconds when `document.visibilityState === 'visible'`. DEBT-029 / DEBT-058 surfaced that Realtime subscriptions transition to `CLOSED` immediately on local Supabase (same pattern observed for messages and notifications channels); the polling fallback silently fills the gap so the inbox UX has at most 30s lag even when Realtime is broken. Both delivery paths upsert by id so a row arriving via both channels dedupes to one UI entry. Local read-state mutations are preserved across polls so optimistic mark-read doesn't get reverted by a stale refresh.

---

## 18. Storage System

Supabase Storage with RLS-mirrored bucket policies.

### Bucket structure

Single bucket: `org-files`. Path prefixes enforce isolation.

```
org-files/
  └── org/{org_id}/
      └── projects/{project_id}/
          ├── client-uploads/        # uploaded by stakeholders
          ├── surveyor-uploads/       # uploaded by org users
          └── documents/              # generated documents (Phase 2)
```

### Storage RLS

Supabase Storage policies apply to bucket access. Mirror the application-level RLS on `project_files`:

```sql
-- SELECT (download/list)
CREATE POLICY "org-files_select_org_or_stakeholder" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'org-files'
    AND (
      -- Org members
      (storage.foldername(name))[2] IN (
        SELECT org_id::text FROM users
        WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
      )
      OR
      -- Stakeholders with can_view_drawings
      (storage.foldername(name))[4] IN (
        SELECT ps.project_id::text FROM project_stakeholders ps
        WHERE ps.client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
          AND ps.can_view_drawings = true
          AND ps.deleted_at IS NULL
          AND ps.accepted_at IS NOT NULL
      )
    )
  );

-- Similar for INSERT (upload) — checks can_upload_files for stakeholders
```

### Signed URLs

All client-side file access goes through signed URLs:

- **Download:** server action issues a signed URL with **1-hour TTL** (`createSignedUrl(path, 3600)`).
- **Upload:** server action issues an upload URL via `createSignedUploadUrl(path)`. **TTL is fixed at 2 hours** by `@supabase/storage-js` v2.105 — the SDK does not expose an `expiresIn` option for upload URLs. ADR-030 documents the resulting divergence from the original 5-minute placeholder.
- **No anonymous access ever.** All signed URLs are minted with the service-role client; storage RLS still applies to SELECT/UPDATE/DELETE so direct stakeholder/user JWT access remains gated.

### Plan-gated quotas

Phase 1c quotas (Session 10 / ADR-029 — supersedes the original placeholder by adding per-file caps; tier totals unchanged):

| Plan | Per-file cap (`max_upload_size_bytes`) | Total org cap (`max_storage_bytes`) |
|---|---|---|
| `solo_free`  | 25 MB  | 100 MB     |
| `studio`     | 100 MB | 5 GB       |
| `practice`   | 500 MB | 50 GB      |
| `enterprise` | 1 GB   | unlimited (`null`) |

Both caps are stored in `plans.feature_flags` JSONB and resolved via `lib/features.ts` `checkFeature(orgId, 'upload_file', { sizeBytes })` — a compound check evaluating per-file cap + a single `SUM(size_bytes)` query across `project_files JOIN projects ON org_id = ?` (filtered to non-deleted rows on both sides). Both must pass for the upload to be permitted. The same compound check is invoked by `confirmUpload` to close the create→confirm race window — if a concurrent upload pushed the org over between createUploadUrl and confirmUpload, the orphan storage object is deleted and a `quota_exceeded` error is returned.

Migration to a cached counter on `organizations` (eliminating the SUM scan) is deferred until EXPLAIN ANALYZE on real data shows the SUM dominating upload latency — pre-launch perf pass at the earliest. Phase 5 will make quotas enforceable against real billing state.

---

## 19. Realtime Channels

Supabase Realtime for live updates.

### Channel naming

| Channel | Subscribers | Events |
|---|---|---|
| `conversation:<id>` | Conversation participants | New messages, edits, typing indicators |
| `project:<id>:activity` | Org members + stakeholders (filtered by visibility) | Activity log entries |
| `notifications:<recipientId>` | Single recipient | New in-app notifications |
| `org:<id>:presence` | Org members | Who's online (Post-launch+ — after polish sprint, if requested) |

### Subscription authorization

Supabase Realtime authorization uses RLS on the source table. To subscribe to `conversation:<id>`, the user must have SELECT access on that row in `conversations`.

This means RLS policies on `conversations`, `messages`, `notifications`, etc. directly control subscription rights. No separate channel ACL needed.

### Frontend subscription pattern

```ts
// In a client component
useEffect(() => {
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${conversationId}`
    }, (payload) => {
      addMessage(payload.new);
    })
    .subscribe();
  
  return () => { supabase.removeChannel(channel); };
}, [conversationId]);
```

### Broadcast vs postgres_changes

- **`postgres_changes`** for actual data changes (new message rows, etc.)
- **`broadcast`** for ephemeral signals (typing indicators, presence)

---

## 20. Server Actions Convention

All mutations go through server actions. This is the standard shape.

### Standard action structure

```ts
'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth';
import { checkFeature } from '@/lib/features';
import { logAudit } from '@/lib/audit';
import { db } from '@/db';

const inputSchema = z.object({
  projectId: z.string().uuid(),
  newStageId: z.string().uuid(),
});

export async function moveProjectToStage(input: z.infer<typeof inputSchema>) {
  // 1. Validate input
  const parsed = inputSchema.parse(input);
  
  // 2. Auth check
  const ctx = await auth.requireOrgUser();  // throws if not authed or no active org
  
  // 3. Feature flag check (if applicable)
  // (none for stage moves — example shown for completeness)
  // const check = await checkFeature(ctx.orgId, 'custom_workflows');
  // if (!check.allowed) return { error: 'feature_gated', upgradeTo: check.upgradeTo };
  
  // 4. Authorization (RLS handles, but explicit check for clearer errors)
  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, parsed.projectId),
      eq(projects.orgId, ctx.orgId),
      isNull(projects.deletedAt)
    )
  });
  if (!project) return { error: 'not_found' };
  
  // 5. Business logic
  const previousStageId = project.currentStageId;
  await db.update(projects)
    .set({ currentStageId: parsed.newStageId })
    .where(eq(projects.id, parsed.projectId));
  
  // 6. Activity log
  await db.insert(projectActivity).values({
    projectId: parsed.projectId,
    actorType: 'user',
    actorId: ctx.userId,
    eventType: 'project.stage_changed',
    payload: { from: previousStageId, to: parsed.newStageId },
  });
  
  // 7. Audit log
  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'project',
    resourceId: parsed.projectId,
    metadata: { stage_changed: { from: previousStageId, to: parsed.newStageId } },
  });
  
  // 8. Notifications
  await dispatchProjectNotifications(parsed.projectId, 'project.stage_changed', { ... });
  
  return { success: true };
}
```

### Auth helpers

```ts
// lib/auth.ts
export const auth = {
  requireOrgUser: async (): Promise<{ userId: string; orgId: string; role: string }> => { ... },
  requireOrgAdmin: async (): Promise<{ userId: string; orgId: string; role: 'owner' | 'admin' }> => { ... },
  requireStakeholder: async (): Promise<{ clientId: string }> => { ... },
  optional: async (): Promise<...> => { ... },  // for context-aware actions
};
```

### Error returns

Server actions return `{ success: true, ... }` or `{ error: '<code>', ...details }`. Never throw to client — caller handles structured errors.

Standard error codes:
- `not_authenticated`
- `not_authorized`
- `not_found`
- `validation_error`
- `feature_gated`
- `quota_exceeded`
- `conflict`
- `internal_error`
- `rate_limited` (Session 4)

### Token-authorized public writes — separate pattern (ADR-034)

A class of server actions cannot use `requireOrgUser()` because they are reached from public token-gated routes (`/q/[token]`, `/i/[token]`, `/r/[token]`) where `auth.uid()` is null. The first instance is `acceptQuote` in `actions/documents.ts` (Phase 2 Session 12). See **ADR-034** for the full pattern; the short form is: Zod validation → `publicDoc` rate-limit by IP → token resolution against `document_tokens` with `document_type` match → status preconditions → idempotent UPDATE through the Drizzle pooler (bypasses RLS) → activity row with `actor_type='client', actor_id=null` → audit row with null actor + `metadata.via='public_token'`. Post-commit dispatch (ADR-033) still applies for any notification fan-out.

---

## 21. Feature Flags

Helper-function pattern. Not RLS, not middleware.

### Flag definitions

Flags live in `lib/features.ts` as TypeScript:

```ts
export const FEATURES = {
  max_projects: { type: 'quota' },
  custom_workflows: { type: 'boolean' },
  custom_email_domain: { type: 'boolean' },
  dual_org_type: { type: 'boolean' },
  // ...
} as const;

export type FeatureFlag = keyof typeof FEATURES;
```

Each plan's `feature_flags` jsonb stores values for these:

```json
{
  "max_projects": 50,
  "custom_workflows": true,
  "custom_email_domain": false,
  "dual_org_type": false
}
```

### Helper

```ts
// lib/features.ts
export async function checkFeature(
  orgId: string,
  flag: FeatureFlag,
  context?: { count?: number }  // for quota checks
): Promise<{ allowed: boolean; reason?: string; upgradeTo?: string }> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    with: { plan: true }
  });
  
  if (!org) return { allowed: false, reason: 'no_org' };
  
  const flagValue = (org.plan.featureFlags as any)[flag];
  
  if (FEATURES[flag].type === 'boolean') {
    return flagValue === true
      ? { allowed: true }
      : { allowed: false, reason: 'plan_required', upgradeTo: suggestUpgrade(org, flag) };
  }
  
  if (FEATURES[flag].type === 'quota') {
    if (flagValue === null) return { allowed: true };  // unlimited
    if (context?.count === undefined) throw new Error('Quota check requires count');
    return context.count < flagValue
      ? { allowed: true }
      : { allowed: false, reason: 'quota_exceeded', upgradeTo: suggestUpgrade(org, flag) };
  }
  
  return { allowed: false, reason: 'unknown_flag' };
}
```

### Usage pattern

In server actions:

```ts
const check = await checkFeature(ctx.orgId, 'custom_workflows');
if (!check.allowed) return { error: 'feature_gated', upgradeTo: check.upgradeTo };
```

In React components (server side):

```tsx
const { allowed } = await checkFeature(orgId, 'custom_email_domain');
return (
  <div>
    {allowed ? <CustomEmailDomainSettings /> : <UpgradePrompt feature="custom_email_domain" />}
  </div>
);
```

### ESLint rule (recommended)

A custom rule flags server actions on gated resource types missing a `checkFeature` call. List of gated resources lives in the rule config:

```js
// .eslintrc.js
{
  rules: {
    'pcd/check-feature-on-gated-action': ['error', {
      gatedResources: ['workflow', 'custom_email', 'project_quota_check'],
    }]
  }
}
```

Phase 1a ships the convention; the ESLint rule itself is optional (manual code review for now).

---

## 22. Audit Logging

Append-only trail for who-changed-what.

### What to log

- All mutations on financial data (Phase 2: documents, payments)
- All mutations on stakeholder data (project_stakeholders changes, invitations)
- All mutations on team membership (users role changes, soft-deletes)
- All mutations on org settings
- All authentication events (login, password change, magic link issued)
- Feature flag override (if/when admin overrides happen)

### What NOT to log

- Reads (too noisy, not security-relevant in Phase 1)
- Internal system reads (cron jobs)
- Realtime subscription events
- Notification dispatches (logged in `notifications` table separately)

### `logAudit()` helper

```ts
// lib/audit.ts
export async function logAudit(opts: {
  orgId?: string;
  userId?: string;
  clientId?: string;
  action: 'create' | 'update' | 'soft_delete' | 'restore' | 'permission_change' | 'invite_sent' | 'invite_accepted' | 'login' | 'password_changed';
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}) {
  await db.insert(auditLogs).values({
    orgId: opts.orgId,
    userId: opts.userId,
    clientId: opts.clientId,
    action: opts.action,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    metadata: opts.metadata ?? {},
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
}
```

Called at end of every mutation in server actions. Service-role insert (bypasses RLS).

### Retention strategy

Audit logs are append-only. No deletes, no soft-deletes. Retention worker (post-launch) hard-deletes audit logs older than the legal retention period (default 7 years for UK). Configurable per-plan if needed.


---

## 23. Soft-Delete Convention

Every domain table has `deleted_at timestamptz`. Default queries filter it out.

### Tables with `deleted_at`

All in Phase 1a/1b/1c except:
- Reference data: `org_types`, `plans`
- System tables: `webhook_events`, `audit_logs`, `email_events`, `outbound_emails`
- Append-only logs: `project_activity`, `notifications`
- Read-through joins: `client_org_memberships` (delete is allowed because the relationship itself is the data)

### Query patterns

```ts
// Default: exclude soft-deleted
const projects = await db.query.projects.findMany({
  where: and(eq(projects.orgId, orgId), isNull(projects.deletedAt))
});

// Recycle bin view: include only soft-deleted
const deletedProjects = await db.query.projects.findMany({
  where: and(eq(projects.orgId, orgId), isNotNull(projects.deletedAt))
});
```

### Soft-delete + restore actions

```ts
// Soft-delete
async function softDeleteProject(projectId: string) {
  await db.update(projects)
    .set({ deletedAt: new Date() })
    .where(eq(projects.id, projectId));
  await logAudit({ ..., action: 'soft_delete', resourceType: 'project', resourceId: projectId });
}

// Restore
async function restoreProject(projectId: string) {
  await db.update(projects)
    .set({ deletedAt: null })
    .where(eq(projects.id, projectId));
  await logAudit({ ..., action: 'restore', resourceType: 'project', resourceId: projectId });
}
```

### Retention worker (deferred)

Pre-launch task: cron job that hard-deletes rows where `deleted_at < now() - retention_period`. Default retention: 90 days for projects, 30 days for messages, 365 days for documents (Phase 2).

Schema-side: `-- TODO: retention_worker hard-deletes deleted_at < now() - INTERVAL '90 days'` comments on each table.

### Cascade considerations

`ON DELETE CASCADE` cascades on hard delete only, not soft-delete. Soft-deleting a project does NOT soft-delete its child rows (messages, files, etc.) automatically. Two patterns:

- **Lazy:** child tables remain, queries filter via parent's `deleted_at`. Simpler but error-prone.
- **Eager:** soft-delete cascade in application code, walking the dependency tree. More work but cleaner.

**Phase 1 choice:** lazy. Soft-deleted projects hide all their children via the project's deleted state in joins. If a hard delete (after retention) occurs, FK CASCADE handles cleanup.

---

## 24. Rate Limiting

Upstash Redis sliding-window limits.

### Routes covered (Phase 1a)

| Route pattern | Limit | Key |
|---|---|---|
| `/api/webhooks/[source]` | 100/min per source IP | `webhook:<source>:<ip>` |
| `/q/[token]`, `/i/[token]`, `/r/[token]` | 60/min per IP | `public_doc:<ip>` |
| `/login`, `/api/magic-link` | 10/min per IP | `auth:<ip>` |
| Server actions on writes | 300/min per user | `action:<userId>` |

Stripe IPs (Phase 5) get whitelisted — Stripe's retry behavior with 429s is messy.

### Helper

```ts
// lib/ratelimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export const limiters = {
  webhook: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 m') }),
  publicDoc: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m') }),
  auth: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 m') }),
  action: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(300, '1 m') }),
};

export async function rateLimit(key: string, limiter: keyof typeof limiters): Promise<boolean> {
  const { success } = await limiters[limiter].limit(key);
  return !success;  // returns true if rate-limited
}
```

### 429 response shape

```ts
return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 60 }), {
  status: 429,
  headers: { 'Retry-After': '60', 'Content-Type': 'application/json' }
});
```

---

## 25. Public Token-Gated Routes

Phase 1a ships **the pattern only**. Token generation lives in Phase 2 with quotes/invoices.

### Routes reserved

```
/q/[token]    — Quote view (Phase 2 populates)
/i/[token]    — Invoice view (Phase 2 populates)
/r/[token]    — Receipt view (Phase 2 populates)
```

### Phase 1a / Phase 2 deliverables for this section

1. **Route handlers exist** at `app/q/[token]/page.tsx` (Phase 2 Session 12 — live for quotes), `app/i/[token]/page.tsx` (Phase 2 Session 13), `app/r/[token]/page.tsx` (Phase 2 Session 14). Phase 1a was supposed to ship the 404 stubs but deferred them entirely to Phase 2 — the `publicDoc` rate limiter was wired in Phase 1a Session 4 and waited for a consumer.
2. **Validation middleware:** validates token format (UUID), rate-limits by IP via `lib/ratelimit.ts:publicDoc`.
3. **Lookup:** queries the `document_tokens` table created in Phase 2 Session 12 (migration 0024). `/q/[token]` is live; the other two routes 404 until their sessions ship.
4. **Token format choice:** UUID v4 (random, not v7). Tokens are not time-sortable in usage; randomness is the only property that matters.

### Token model (Phase 2 Session 12 — shipped)

The `document_tokens` table as it exists today (migration 0024):

```sql
CREATE TABLE document_tokens (
  id uuid PRIMARY KEY,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('quote', 'invoice', 'receipt')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_document_tokens_token ON document_tokens(token);
```

Note: the §25-original `document_type` sketch enumerated `('quote', 'invoice_initial', 'invoice_final', 'receipt_initial', 'receipt_final')` — Phase 2 scope §2.5 collapsed receipts into one peer object, and §2.4 keeps invoice initial/final as a `subtype` field on the document itself (Session 13 additive column), not as separate token types. The route discriminator stays at the doc-type level (`quote`/`invoice`/`receipt`).

Token validation logic (Phase 2 Session 12):

```ts
// app/q/[token]/page.tsx
export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  // publicDoc rate-limit by IP (lib/ratelimit.ts).
  const result = await getDocumentByToken(token);
  if (!result) notFound();
  if (result.tokenDocumentType !== 'quote') notFound();
  if (result.document.status === 'draft' || result.document.status === 'void') notFound();

  // Render quote — no auth required.
}
```

Writes from this public-route context (e.g. the Accept button on a quote) follow ADR-034 — see §20's "Token-authorized public writes" note.

### Token vs auth

- **Token-gated routes** never check `auth.uid()`. Stakeholders shouldn't have to log in to view a quote.
- **Auth-gated routes** never check tokens. Org users access via the dashboard, not via shared links.
- **No hybrid:** a route is one or the other, never both.

### Token security model (carryover from Apps Script)

The Apps Script rule "no token = allow, token mismatch = reject" was a backwards-compat measure for old emails. SaaS doesn't need this — every document URL has a token from day one.

**SaaS rule:** missing token = 404. Mismatched/invalid token = 404 (not 401, to avoid leaking which tokens exist). No expiry, no revocation in Phase 2 (matches Apps Script). Revocation can be added later via a `revoked_at` column.

---

## 26. RLS Test Framework

Vitest + Supabase test client. Two-user-two-org fixture pattern.

### Setup

```
__tests__/rls/
  ├── _setup.ts           # Fixture creation: two orgs, two users, two clients
  ├── _helpers.ts         # asUserA(), asUserB(), asAnonymous()
  ├── orgs.test.ts
  ├── users.test.ts
  ├── projects.test.ts    # Phase 1b
  ├── messages.test.ts    # Phase 1c
  └── ...
```

### Fixture pattern

```ts
// __tests__/rls/_setup.ts
import { createClient } from '@supabase/supabase-js';

export async function createTestOrgs() {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Create two auth users
  const { data: userA } = await admin.auth.admin.createUser({ email: 'a@test.local', password: 'test1234' });
  const { data: userB } = await admin.auth.admin.createUser({ email: 'b@test.local', password: 'test1234' });
  
  // Create two orgs
  const orgA = await admin.from('organizations').insert({ name: 'Org A', ... }).select().single();
  const orgB = await admin.from('organizations').insert({ name: 'Org B', ... }).select().single();
  
  // Create users tied to auth_user_ids
  await admin.from('users').insert({ auth_user_id: userA.id, org_id: orgA.id, role: 'owner', ... });
  await admin.from('users').insert({ auth_user_id: userB.id, org_id: orgB.id, role: 'owner', ... });
  
  return { userA, userB, orgA, orgB };
}

export function asUser(authUserId: string) {
  // Returns a Supabase client signed in as the given user
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${signedJwtFor(authUserId)}` } }
  });
}
```

### Standard tests every domain table must pass

```ts
// __tests__/rls/<table>.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { createTestOrgs, asUser } from './_setup';

describe('<table> RLS', () => {
  let fixtures;
  beforeAll(async () => { fixtures = await createTestOrgs(); });
  
  test('Org A user cannot SELECT Org B rows', async () => {
    const clientA = asUser(fixtures.userA.id);
    // Insert a row for Org B via service role
    // Try to select it as User A
    const { data } = await clientA.from('<table>').select('*').eq('id', orgBRowId);
    expect(data).toEqual([]);
  });
  
  test('Org A user cannot INSERT into Org B', async () => { ... });
  test('Org A user cannot UPDATE Org B rows', async () => { ... });
  test('Org A user cannot DELETE Org B rows', async () => { ... });
  test('Anonymous user cannot SELECT any row', async () => { ... });
  test('Soft-deleted user loses access immediately', async () => { ... });
});
```

### Stakeholder visibility tests (Phase 1b+)

The Phase 2-anticipated stakeholder-financial-visibility test is now live as `tests/rls/documents.test.ts` (Session 12). Pattern:

```ts
test('Stakeholder with can_view_financials=false (progress_only) SEES NOTHING', async () => {
  await f.service
    .from('project_stakeholders')
    .update({ can_view_financials: false, visibility_profile: 'progress_only' })
    .eq('id', stakeholderRowId);
  const c = await asUser(stakeholderAuth.email, stakeholderAuth.password);
  await assertVisibleIds(c, 'documents', { column: 'id', values: [docAId] }, []);
});

test('Stakeholder with can_view_financials=true SEES the project document', async () => {
  // ...stakeholder has full profile
  await assertVisibleIds(c, 'documents', { column: 'id', values: [docAId] }, [docAId]);
});
```

Both branches exercise `auth_user_stakeholder_project_visibility(project_id).can_view_financials` from migration 0023's SELECT policy.

### Running tests

```bash
# Local: against a test Supabase project
npm run test:rls

# CI: against ephemeral Supabase project (Supabase CLI can spin up local instance)
```

### Test database cleanup

Each test file resets via `beforeAll` / `afterAll`. Use a separate Supabase project for tests (never run against dev or prod).

---

## 27. Migrations

Supabase CLI manages migrations. SQL-first, version-controlled, deterministic order.

### Tooling

- **`supabase migration new <name>`** — creates `db/migrations/NNNNNNNNNNNNNN_<name>.sql` with timestamp prefix
- **`supabase db push`** — applies migrations to remote
- **`supabase db diff`** — generates migration from local schema changes (use sparingly, prefer hand-written)

### Naming

Convention overrides Supabase default to use sequential numbering for clarity:

```
0001_initial.sql                         # Phase 1a Session 2
0002_seed_org_types_and_plans.sql        # Phase 1a Session 2
0003_create_invitations.sql              # Phase 1a Session 3
0004_create_audit_and_email_events.sql   # Phase 1a Session 3
0005_create_webhook_events.sql           # Phase 1a Session 4
...
```

### Migration discipline

**Pre-launch (Phase 1a–1c):** breaking changes are fine. Drop columns, rename tables, redo schemas.

**Post-launch:** additive only.

- New tables: fine
- New nullable columns: fine
- New indexes: fine (use `CREATE INDEX CONCURRENTLY` for hot tables)
- New CHECK constraint values: fine (extend the IN list)
- Drop column: forbidden — deprecate, stop using, leave in place
- Rename column: forbidden — add new column, dual-write, drop later (post-deprecation period)
- Type narrowing: forbidden
- New NOT NULL on existing column: forbidden without migration that backfills

### Connection used for migrations

Migrations always run against `DIRECT_URL` (port 5432), not the pooler. Pooler in transaction mode breaks migration tools that use session-scoped state.

### Migration ordering across sessions

Each Claude Code session creates migrations in sequence. The session's first action is to check `db/migrations/` for the highest-numbered migration and continue from there. Conflicts between branches are resolved manually before merge.

---

## 28. Connection Pooling

Vercel serverless requires connection pooling. Without it, Postgres exhausts connection slots.

### Configuration

- **`DATABASE_URL`:** pooler at port 6543, transaction mode. Used by app at runtime.
- **`DIRECT_URL`:** direct at port 5432. Used by migrations only.

### Transaction mode caveats

- **Doesn't support `LISTEN/NOTIFY`** — Phase 1 doesn't use these.
- **Doesn't support session-scoped settings persisting across queries** — workaround for `SET LOCAL` is to use it within an explicit transaction (Drizzle handles this).
- **Doesn't support prepared statements across queries** — Drizzle ORM is compatible.

### Connection limits

- Supabase free tier: 60 connections (direct), 200 (pooler)
- Supabase pro: 200 (direct), 500 (pooler)

Vercel's per-deployment concurrent request handling can spike. Pooler keeps Postgres safe.

### Drizzle setup

```ts
// db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/env';

const queryClient = postgres(env.DATABASE_URL, {
  max: 1,  // Vercel functions are single-threaded
  prepare: false,  // Required for transaction-mode pooler
});

export const db = drizzle(queryClient, { schema });
```

For migrations:

```ts
// db/migrate.ts (run manually, not at runtime)
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '@/env';

const migrationClient = postgres(env.DIRECT_URL, { max: 1 });
await migrate(drizzle(migrationClient), { migrationsFolder: './db/migrations' });
await migrationClient.end();
```

---

## 29. Sentry

Error tracking across client, server, and edge.

### Wiring

Use the Next.js Sentry SDK:

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

This generates `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`.

### What to capture

- **Server actions:** wrap the action body in a try/catch that calls `Sentry.captureException`
- **API routes:** all `/api/*` routes have automatic instrumentation
- **React error boundaries:** Sentry Next.js SDK auto-wraps the root error boundary
- **Webhook processing failures:** explicit `Sentry.captureException` in the catch block

### What to suppress

- **Validation errors** (Zod failures) — these are user errors, not code errors. Return as `{ error: 'validation_error' }` without sending to Sentry.
- **`not_authorized` / `not_found`** — same reason.
- **Rate limit hits** — return 429, don't capture.

### Tagging

Every captured error tagged with `org_id` (if available) and `user_id`:

```ts
Sentry.withScope((scope) => {
  scope.setTag('org_id', orgId);
  scope.setUser({ id: userId });
  Sentry.captureException(error);
});
```

This makes filtering errors per-org trivial in the Sentry dashboard.

### Performance

Sentry tracing is **off** in Phase 1 (cost). Phase 5 enables sampled tracing for hot paths.

---

## 30. Hard Rules (SaaS-Specific)

Already covered in Section 4. This section is a reference pointer for navigation.

See **Section 4** for the full list of:
- Universal rules (1–12)
- Carryover rules (13–16)

---

## 31. Phase 1a Build Checklist

Four sessions. Each session has a "done" criterion. Don't move to the next session until criteria are met.

### Session 1: Project scaffold + auth — ✓ SHIPPED (04 May 2026)

**Tasks:**
- [x] Initialize Next.js 15 project (App Router, TypeScript, Tailwind)
- [x] Set up shadcn/ui base components (Button, Card, Input, Form, Toast, etc.)
- [x] Create Supabase project (dev environment)
- [x] Set up `.env.local` with all Phase 1a env vars
- [x] Create `env.ts` with Zod validation
- [x] Configure Supabase Auth (email + magic link providers)
- [x] Implement `/login`, `/signup`, `/magic-link` route handlers
- [x] Implement Supabase Auth middleware for protected routes
- [x] Set up Sentry (client + server + edge configs)
- [x] Configure Vercel deploy pipeline (Preview + Production environments)
- [x] Connect to Supabase via Drizzle ORM (with pooler `DATABASE_URL`)
- [x] Create `db/index.ts` with proper transaction-mode pooler config
- [x] Verify deploy: signup → login → see placeholder dashboard

**Done when:**
- [x] Production deploy on Vercel returns 200 for `/` (returns 307 → /login when no session — same intent, working as designed)
- [x] Signup with email works end-to-end (Supabase confirmation email arrives) — backend wired, full email round-trip QA pending
- [x] Magic link login works — backend wired, full QA pending
- [x] Sentry captures a manually thrown error (issue 117426189 captured, `vercel-production` env tag, release `93a29a8a36f9`)
- [x] Drizzle can query `auth.users` (read-only smoke test) — verified via `npm run db:smoke`

**Estimated time:** 1 session. (Actual: 1 session.) Carryover items in §35.

### Session 2: Multi-tenant schema + RLS framework — ✓ SHIPPED (05 May 2026)

**Tasks:**
- [x] Single migration `0001_initial.sql` — 9 Phase 1a tables + indexes + RLS helpers + policies (merged for atomicity)
- [x] Seed scripts in `db/seed/` (TypeScript, idempotent) — 2 org_types + 8 plans (4 tiers × 2 org types)
- [x] Drizzle schema files: `db/schema/{org-types,plans,organizations,users,org-settings,invitations,audit-logs,webhook-events,email-events}.ts`
- [x] App-side UUID v7 via `uuid` package (no `gen_uuid_v7()` SQL function — pre-Session-1 override honoured)
- [x] RLS policies for all 6 RLS-enabled tables (12 policies total). 3 tables stay disabled (`org_types`, `plans`, `webhook_events`) per spec §10.
- [x] 6 SECURITY DEFINER STABLE helper functions (expanded from brief's 4): `auth_user_orgs`, `is_org_member`, `is_org_admin`, `is_org_owner`, plus stubs `auth_user_stakeholder_orgs` and `auth_user_stakeholder_projects` for Phase 1b.
- [x] `lib/audit/log.ts`: `logAudit()` helper — Drizzle pooler insert (postgres role bypasses RLS) + Sentry breadcrumb
- [x] `lib/auth/requireAuth.ts`: filled `requireOrgUser` + `requireOrgAdmin` (single-org users only; multi-org throws until Session 3 wires context switcher); `requireStakeholder` documented stub until Phase 1b Session 6
- [x] RLS test framework: Vitest 4 + two-org fixture (`tests/fixtures/two-orgs.ts`). Setup file fetches local Supabase creds from `npx supabase status -o env` so tests can never accidentally touch cloud.
- [x] Cross-org isolation tests for every RLS-enabled table — 28 tests, all pass
- [x] Soft-delete column on every domain table (verified in users.test.ts: soft-deleted user loses access immediately)

**Done when:**
- [x] All 9 tables exist in dev Supabase, with RLS state matching plan (6 enabled / 3 disabled)
- [x] Seed scripts populate org_types (2) and plans (8) idempotently
- [x] RLS test suite passes (`npm run test:rls` — 28/28)
- [x] `logAudit()` writes to `audit_logs` via the pooler (postgres role bypass)
- [x] Drizzle types match SQL schema — `npx drizzle-kit check` + `npx drizzle-kit generate` report no drift

**Estimated time:** 1 session. (Actual: 1 session.) Carryover items in §35.2.

### Session 3: Onboarding + settings — ✓ SHIPPED (05 May 2026)

**Tasks:**
- [x] Signup wizard: pick org type → org creation → user becomes owner
- [x] `actions/orgs.ts`: `createOrganization` (`updateOrg` / `softDeleteOrg` / `getOrgWithPlan` deferred — `getMyOrg` query helper added in `db/queries/orgs.ts` instead)
- [x] `actions/users.ts`: `inviteTeamMember`, `acceptInvitation`, `removeUserFromOrg` (`updateRole` deferred to Phase 1b polish)
- [x] `actions/settings.ts`: `updateCompanyDetails`, `updateBankDetails`, `updateDefaultTerms` + `getOrgSettings` query helper
- [x] Settings page UI: company details, bank info, terms (branding deferred to Phase 4)
- [x] Team invitations UI: list, invite form, role select, pending state
- [x] Magic link invitation acceptance flow: token validation, account creation, redirect to dashboard
- [x] Dashboard placeholder: org name, settings + team links
- [x] Owner-orphan prevention: block last-owner soft-delete (ownership transfer UI is Phase 1b polish — error toast names the workaround)
- [x] Audit log entries for all mutations

**Done when:**
- [x] New user can sign up, pick org type, land in dashboard with their own org
- [x] Owner can invite a team member by email; invitee receives email (stubbed to console + email_events row); clicking link signs them up and joins org
- [x] Settings changes persist and are visible in the database
- [x] Owner cannot soft-delete themselves while sole owner
- [x] Audit logs show every mutation
- [x] RLS test: user from Org A cannot read Org B settings (regression — 28/28 still passing)

**Estimated time:** 1 session. (Actual: 1 session.) Carryover items in §35.3.

### Session 4: Webhook + email infrastructure — ✓ SHIPPED (05 May 2026)

**Tasks:**
- [x] Generic webhook ingestion route: `app/api/webhooks/[source]/route.ts`
- [x] `lib/webhooks/verify.ts`: signature verification per source (svix for Resend)
- [x] `lib/webhooks/extract.ts`: idempotency key extraction per source
- [x] `lib/webhooks/resend.ts`: Resend event processor (populates `email_events`)
- [x] `lib/email/send.ts`: real `sendEmail()` helper using Resend SDK (replaces Session 3 stub)
- [x] Migration 0004: REVOKE anon GRANTs on `webhook_events` + `email_events` (closes local-vs-cloud GRANT divergence Session 3 surfaced; tightens RLS test predicate)
- [x] Migration 0005: `outbound_emails` table (10th Phase 1a table per §16, deferred from S2)
- [ ] Email templates (React Email): `auth-magic-link`, `team-invitation` *(deferred — S3 ships plain HTML `team-invitation.ts`; React Email migration is Phase 4 polish)*
- [ ] Update Supabase Auth to use Resend for confirmation emails (custom SMTP) *(deferred to Phase 4 — Supabase's default SMTP works for Phase 1a internal use; custom SMTP requires verified domain)*
- [x] `lib/ratelimit.ts`: Upstash wrapper with limiters for webhook (100/min), publicDoc (30/min), auth (10/min), invite (20/hr)
- [x] Rate limiting wired on webhook route + signIn/signUp/sendMagicLink + inviteTeamMember
- [ ] Public token-gated route placeholders: `/q/[token]`, `/i/[token]`, `/r/[token]` (Section 25) *(deferred to Phase 2 — limiter `publicDoc` is ready; no consumer until then)*
- [x] Bounce handling: failed invitation emails surface in `/settings/team` Pending Invitations as a "Delivery failed" badge
- [x] Stub webhook_events cleanup (`db:cleanup-stubs` script — removes Session 3 stubs)
- [x] Action-shape tests: 19 cases across invite/accept/remove
- [ ] E2E test: invite team member → invitation email arrives → bounce simulation → bounce shows in UI *(deferred to post-deploy verification — requires Resend webhook endpoint configured in dashboard. Test plan in `SESSION-4-HANDOVER.md` §"Bounce simulation".)*

**Done when:**
- [x] Inbound Resend webhook hits `/api/webhooks/resend` and writes to `webhook_events` + `email_events` *(verified locally with bad-signature curl → forensic row; real signed flow goes live once user configures the Resend dashboard endpoint)*
- [x] Duplicate webhook delivery is no-op (idempotency works) *(verified: repeat POST returns "OK (duplicate)")*
- [x] Invalid signatures are rejected with 401 after recording *(verified)*
- [x] Rate limit returns 429 with `Retry-After` header on flood *(webhook route verified shape; auth/invite paths return `{ error: 'rate_limited', reason: 'retry_after_<n>s' }` — verified in test:actions mock)*
- [ ] Public token routes return 404 for invalid tokens *(no routes; deferred to Phase 2)*
- [x] Email events visible in Settings UI for org admins *(via the bounce-surfacing badge on Pending Invitations; per-event timeline UI is Phase 1b polish)*

**Estimated time:** 1 session. (Actual: 1 session.) Carryover items in §35.4.

### Phase 1a closure (2026-05-05)

All four sessions shipped. Phase 1a is **closed**. Exit criteria check (per below):
- ✓ All Session 1–4 done criteria met
- ✓ Full RLS test suite green (29/29)
- ✓ Sentry capturing errors with `org_id` tags (wired in webhook route)
- ✓ Manual smoke test still holds — Session 3's walkthroughs verified signup → invite → settings → re-auth → persistence; Session 4 didn't change those code paths

Phase 1b begins next session — see §32.

### Phase 1a exit criteria

Before moving to Phase 1b:
- All Session 1–4 done criteria met
- Full RLS test suite green
- Sentry capturing errors with org_id tags
- Manual smoke test: signup → invite team → settings change → sign out → sign in → all data persists correctly

---

## 32. Phase 1b Build Checklist

### Session 5: Workflows + clients + project shell ✓ SHIPPED 2026-05-06

**Tasks:**
- [x] Migration: `workflows`, `workflow_stages`, `clients`, `client_org_memberships` (0006 + 0007)
- [x] Seed: "Simple" system template + stages (0009)
- [x] Backfill FKs: `audit_logs.client_id` (0007), `invitations.project_id` (0008)
- [x] Migration: `projects` (0008)
- [x] Drizzle schema: `db/schema/workflows.ts`, `db/schema/clients.ts`, `db/schema/projects.ts`
- [x] RLS policies for all 5 new tables (with new SECURITY DEFINER helpers `auth_user_client_ids` + `auth_user_org_client_ids` to break clients↔memberships recursion; unstubs `auth_user_stakeholder_orgs`)
- [x] RLS tests for each table (17 new tests, all green)
- [x] `actions/orgs.ts`: REFACTORED to Drizzle `db.transaction(...)` so signup atomically creates org + user + workflow + 5 stages
- [x] `actions/projects.ts`: `createProject`, `updateProject`, `softDeleteProject`, `restoreProject`
- [x] `actions/clients.ts`: `findOrCreateClient` (idempotent, transactional), `updateClient`
- [x] Project list UI (org dashboard)
- [x] Project create form (assign workflow, enter project_number, site_address; optional client capture)
- [x] Project detail skeleton (stage progression view; soft-delete for owners/admins)

**Carryovers from Phase 1a (also shipped):**
- [x] Multi-org context switcher: `switchActiveOrg` action + cookie-aware `requireOrgUser` + `OrgSwitcher` header dropdown
- [x] Cancel pending invitation: `cancelInvitation` action + kebab UI + cancelled-invite landing state
- [x] `sendPasswordReset` rate limit
- [x] `'system_cleanup'` AuditAction verb + `cleanup-stub-webhook-events` script updated

**Done when:** new orgs auto-clone "Simple" workflow ✓; org users can create/edit/delete projects ✓; RLS isolates per org ✓.

### Session 6: Stakeholders + visibility profiles ✓ SHIPPED 2026-05-06

**Tasks:**
- [x] Migration: `project_stakeholders` (0010), `project_milestones` (0011)
- [x] Bug-fix migration `0012_per_command_modify_policies.sql` — drops the FOR ALL modify policies (which were OR'd with the FOR SELECT policy and leaked soft-deleted rows) and replaces with per-command INSERT/UPDATE/DELETE policies. Pattern matches 0008_projects.sql.
- [x] Migration `0013_auth_user_stakeholder_projects.sql` — unstubs the empty-set placeholder from 0001 with a real implementation querying project_stakeholders + clients filtered by auth.uid() + accepted_at NOT NULL + soft-delete-aware. Mirrors 0007's unstub of auth_user_stakeholder_orgs.
- [x] Two new SECURITY DEFINER helpers in 0010 (per Rule 20):
  - `auth_user_org_project_ids() → SETOF uuid`
  - `auth_user_stakeholder_project_visibility(p_project_id uuid) → TABLE(5 booleans)`
- [x] RLS tests for visibility profiles (full / progress_only / documents_only / schedule_only / custom × can_view_schedule × visible_to_stakeholders matrix in `tests/rls/projects-stakeholder-visibility.test.ts`)
- [x] `actions/stakeholders.ts`: `inviteStakeholder`, `acceptStakeholderInvitation` (renamed from spec's `acceptStakeholderInvite` to mirror existing `acceptInvitation`), `updateStakeholder`, `removeStakeholder`
- [x] `actions/milestones.ts`: `createMilestone`, `updateMilestone`, `softDeleteMilestone`
- [x] Stakeholder invite flow: send email, magic link, accept route dispatches on `invitation.invitationType` and redirects to `/portal/projects/{projectId}`
- [x] Visibility profile preset UI (with custom override) — `VisibilityProfilePicker` component
- [x] Project detail: stakeholder list panel + Edit/Remove dialogs + pending stakeholder invitations row
- [x] Client portal at `app/portal/*` (richer than the §32-original `/client/projects` placeholder — per-project pages with flag-gated conditional sections; portal layout requires `requireStakeholder`)
- [x] Project list adds "Client" column reading the primary_client stakeholder (decision: createProject extended to insert this row when clientId is provided)
- [x] `lib/visibility-profiles.ts` — pure-data module with `VISIBILITY_PROFILES` const, `applyVisibilityProfile`, `inferVisibilityProfile`
- [x] `requireStakeholder()` implemented (was a stub) returning `{ authUserId, clientId }`
- [x] `findOrCreateClientTx` extracted from `findOrCreateClient` for use inside outer transactions (Drizzle doesn't nest)
- [x] `actions/invitations.ts cancelInvitation` reused for stakeholder cancellation (type-agnostic; no new action)

**Done when:** stakeholders can be invited; magic link works; client portal shows correct projects + flag-gated sections per RLS. ✓

**Migrations applied:** 0010 (project_stakeholders), 0011 (project_milestones), 0012 (per-command RLS policy fix), 0013 (auth_user_stakeholder_projects unstub).

### Session 7: RLS hardening for stakeholder model ✓ SHIPPED 2026-05-06

**Tasks:**
- [x] Comprehensive RLS test matrix: 5 visibility profiles × 3 protected tables × 4 operations parameterized via `describe.each` / `it.each` in `tests/rls/visibility-matrix.test.ts`
- [x] Edge case tests in `tests/rls/edge-cases.test.ts` covering pending, removed, soft-deleted-client, expired-invitation, multi-org, and dual-context (owner + stakeholder) scenarios
- [x] Security-boundary regression tests in `tests/rls/security-boundary.test.ts` (anti-hijack already_accepted + client_already_linked, cross-org email_mismatch, service-role bypass intent, helper SET search_path safety)
- [x] Action-layer matrix: `tests/actions/visibility-runtime-override.test.ts` (5 tests for the auto-flip-to-custom logic) + `tests/actions/duplicate-stakeholder-actions.test.ts` (3 serial duplicate-detection tests)
- [x] Test infrastructure: `tests/rls/_helpers.ts` (4 shared assertion helpers) + `tests/fixtures/stakeholder-fixtures.ts` (7 fixture builders)
- [x] Hotfix: cascade-cancel pending invitations on `removeStakeholder` (Design C — preserves history for already-accepted invitations); introduced a Drizzle transaction in the action since none existed
- [x] CI gate: `.github/workflows/rls-gate.yml` runs `test:rls + test:actions + test:cloud-smoke` on every PR to main; cloud-smoke gracefully skips when secrets are not yet configured
- [→ S8] Performance review of query plans + index tuning — descoped from this session per the no-schema-changes constraint; carried into Session 8 (workflow management) or as a standalone follow-up
- [→ user] Branch protection rule on `main` requiring "RLS Gate / rls-tests" — manual UI step; document in handover

**Done when:** test suite has 100+ RLS assertions, all passing; cascade-cancel logic verified; CI gate landed. ✓ (136 RLS / 77 actions / 9 cloud-smoke = 222 total)

### Session 8: Workflow management ✓ shipped

**Tasks:**
- [x] Stage transitions: `actions/projects.ts → moveProjectToStage` (locked audit metadata for Phase 1c)
- [x] Custom workflow CRUD: `actions/workflows.ts` (5 actions — create/update/delete + addStage/removeStage; admin-gated; cross-org + system-template guards)
- [x] Workflow editor UI: page at `/settings/workflows` + Create/Edit dialogs (add/remove stages; reorder deferred to post-launch UX work)
- [x] ~~Workflow assignment dropdown in project create~~ — already shipped in Session 5 (`createProject` takes `workflowId` from input)
- [x] Activity log entry on stage change → `audit_logs.action='stage_changed'` (Phase 1b destination; `project_activity` arrives Session 11)
- [x] PCD Surveyor seed updated 8 → 10 stages: `scripts/seed-hasnath-pcd-surveyor.ts` (standalone script, not a migration; idempotent re-run)

**Plus** (descoped from Session 7 → §35.7 entry 10): Phase E performance audit. EXPLAIN ANALYZE on the 5 hot paths against cloud Supabase confirmed all queries are index-scan with sub-2ms execution. No new indexes shipped; one in-action tightening in `deleteWorkflow` (org_id + workflow_id) for clean idx_projects_org plan.

**Done.** Phase 1b is closed.

### Phase 1b exit criteria

- All Session 5–8 done criteria met
- Internal-only project tracker is usable end-to-end
- Hasnath's org has the PCD Surveyor workflow available
- RLS test count >= 80 assertions

---

## 33. Phase 1c Build Checklist

### Session 9: Conversations + messaging core

**Tasks:**
- [x] Migrations: 0014 conversations, 0015 conversation_participants, 0016 messages, 0017 conversation_helpers
- [x] Per-command RLS policies (ADR-016) + RLS tests in tests/rls/{conversations, conversation-participants, messages}.test.ts
- [x] Drizzle schemas: db/schema/{conversations, conversation-participants, messages}.ts
- [x] `actions/conversations.ts`: createGroupConversation, addConversationParticipant, removeConversationParticipant, markConversationRead, autoCreateOneToOneConversationTx, autoCreateGeneralConversationTx
- [x] `actions/messages.ts`: sendMessage (Zod 1..10000), editMessage (sender-only), deleteMessage (soft, sender-only)
- [x] Realtime subscription hook: hooks/use-conversation-messages.ts (postgres_changes filtered by conversation_id; messages table added to supabase_realtime publication in 0016)
- [x] Conversation UI: /conversations + /conversations/[id] org-side; /portal/conversations + /portal/conversations/[id] portal-side; ConversationsInbox / ConversationDetailClient / MessageBubble (react-markdown + rehype-sanitize allowlist) / MessageComposer / NewConversationDialog / ParticipantsManager
- [x] Auto-create hooks wired into `acceptStakeholderInvitation` (one_to_one) and `findOrCreateClient` + `inviteStakeholder` (general)
- [x] shadcn AlertDialog + ConfirmDialog wrapper; 3 native-confirm callsites migrated (ADR-025 supersedes ADR-024)
- [x] Inbox + per-conversation unread counts + nav badges (org + portal layouts)

**Done when:** surveyor and stakeholder can exchange messages in realtime; RLS isolates threads. **✓ shipped 09 May 2026.**

### Session 10: File uploads

**Tasks:**
- [x] Migration: `project_files` (0018) — per-command RLS reusing `auth_user_org_project_ids` + `auth_user_stakeholder_project_visibility` + `auth_user_client_ids`; soft-delete + admin-only DELETE; `thumbnail_path` column reserved nullable for future preview pipeline
- [x] RLS policies + tests — 12 RLS cases on `project_files` (cross-org, soft-delete, anon block, source/identity gating, stakeholder visibility profile matrix, `org_only` invisibility, uploader-self UPDATE)
- [x] Supabase Storage bucket: `org-files` with RLS-mirrored policies (0019) — 5 storage.objects policies; path-pattern checks via `storage.foldername`; subdir gating (org users → surveyor-uploads/documents; stakeholders → client-uploads only)
- [x] `actions/files.ts`: `createUploadUrl`, `confirmUpload`, `getDownloadUrl`, `softDeleteFile`, **`restoreFile`** (added per kickoff §C — org-admin-only)
- [x] Upload UI for org users and stakeholders — `FileUploadZone` (drag-drop + XHR progress) wired into `/dashboard/projects/[id]` and `/portal/projects/[id]` (gated by `can_upload_files`)
- [x] File list UI per project — `FileList` SSR component + `FileRow` client component with download + soft-delete (uses S9 `ConfirmDialog`); lucide mimetype icons (no thumbnails — DEBT-032)
- [x] Plan-gated quota enforcement — `lib/features.ts` `checkFeature(orgId, 'upload_file', { sizeBytes })` compound check; per-file + total via single SUM query; tiers per ADR-029
- [x] **Phase F manual QA executed against PR preview: 11 PASS / 1 SKIP / 1 N/A / 0 FAIL** — clean walk

**Done when:** ~~both sides can upload, files appear in project detail; quota enforcement works.~~ **✓ shipped 10 May 2026.**

### Session 11: Notifications + activity ✓ SHIPPED 14 May 2026

**Tasks:**
- [x] Migration: `notification_preferences`, `notifications`, `project_activity` (0020/0021/0022; applied to cloud 12 May 2026)
- [x] RLS policies + tests — 29 new RLS cases (192 → 221) covering self-only access, duck-typing safety, XOR enforcement, stakeholder visibility gating
- [x] Default notification preferences seeded on user/client creation — `lib/notifications/seed-defaults.ts` wired into 4 entry points (`createOrganization`, `acceptInvitation`, `findOrCreateClientTx`, `acceptStakeholderInvitation`); 48 rows per identity, idempotent
- [x] `lib/notifications/dispatch.ts`: `dispatchNotification` + content map (`lib/notifications/subjects.ts`) + generic email template (`lib/email/templates/notification-generic.ts`)
- [x] Notification preferences UI matrix (per channel × per event) — `/settings/notifications` (org) + `/portal/settings/notifications` (stakeholder); push + sms columns disabled with "Coming soon" badge
- [x] In-app notification inbox — `/notifications` + `/portal/notifications` with bell-icon nav badge; Realtime subscription + 30s polling fallback per ADR-033 / DEBT-058
- [x] Email notifications for `message.new`, `project.stage_changed`, `file.uploaded`, `stakeholder.added_to_project`, `milestone.scheduled` via Resend
- [x] Activity log writes throughout the codebase — `lib/activity/log.ts` `logActivityTx` wired into 4 actions (sendMessage excluded per ADR-027 spirit + scope decision)
- [x] Project activity timeline UI — `components/activity/ActivityTimeline.tsx` mounted on both project detail pages; per-stakeholder filtering via `visible_to_stakeholders` + explicit query-layer filter for pooler-bypass defense
- [x] **DEBT-049 hotfix during Phase F:** dispatcher fan-out + outbound Resend calls moved OUT of action transactions (ADR-033 + Hard Rule 27). All 5 wired actions refactored; transactions retain DB-only writes (domain + activity row); per-recipient dispatch failures captured to Sentry without rolling back. Closes the Vercel 504 footgun.
- [x] **Phase F manual QA executed against PR #12 preview (post-DEBT-049 re-walk): 19/19 PASS** — zero bugs found, the post-commit pattern holds across all 5 wired actions.

**Done.** Phase 1c is **CLOSED.** ~Session 12~ folded into a future-phase integration pass; Session 11 shipped the full notification + activity quartet and met the Phase 1c exit criteria.

### ~~Session 12: Integration test + polish~~ (descoped to future phase)

**Tasks:**
- [ ] Full E2E test: org signup → project create → stakeholder invite → message exchange → file upload → status change → notification → activity log entry
- [ ] RLS audit pass: re-verify every table
- [ ] Performance pass: `EXPLAIN ANALYZE` on hot paths
- [ ] Documentation pass: schema diagram (Mermaid or screenshot of Supabase studio), RLS policy summary doc
- [ ] Bug bash: spend half a session breaking the system intentionally
- [ ] Update `ARCHITECTURE-saas.md` with any drifts from the spec

**Done when:** E2E test passes; performance acceptable on dev data; bug bash finds <5 issues.

### Phase 1c exit criteria — ✓ MET 14 May 2026

- [x] Full two-sided product works end-to-end — Phase F walk 19/19 PASS across team-member / stakeholder / dual-context scenarios
- [x] 200+ RLS assertions passing — 221 green
- [x] Manual exploratory testing finds no critical bugs — DEBT-049 surfaced during Phase F, hotfixed in-session; zero bugs post-hotfix
- [→] Hasnath's existing 10 projects can be migrated using `MIGRATION-MAP.md` (test the script) — **descoped to a Phase 2 pre-launch task**; the SaaS product is feature-complete for the messaging + files + notifications + activity quartet, but the live Apps Script data migration is its own initiative independent of the Phase 1c shape.
- Phase 2 spec written before starting Phase 2

---

## 34. Open Questions / Deferred Decisions

Each tied to a concrete decide-by milestone.

| Question | Decide by | Trigger |
|---|---|---|
| Retention worker schedule (90 days for messages? 365 for documents?) | Pre-launch (before first paying customer) | First customer onboarded |
| Data export format (JSON dump? PDF report? CSV per resource?) | Pre-launch | First GDPR data request received OR 30 days before public launch |
| Custom email domain DNS verification flow (DKIM/SPF/DMARC checks) | Phase 4 start | First Practice/Enterprise tier signup |
| Push notification implementation (Web Push API vs OneSignal vs Pushwoosh) | Phase 3 start | First customer requests push |
| SMS provider choice (Twilio confirmed, but verify Vonage/MessageBird pricing for UK) | Phase 3 start | Same trigger as above |
| Realtime presence indicator (who's online in conversation) | Post-launch — after polish sprint | If requested by users post-launch |
| ~~Document generation backend~~ — **RESOLVED Session 14 (15 May 2026):** `@react-pdf/renderer` v4. Pure JS, no native deps, runs on Vercel serverless without configuration. Stored as `project_files` rows with `source='document_artifact'` + `source_document_id`. One parameterised template covers quote/invoice/receipt; cache invalidation soft-deletes on revise/correct. Two callable surfaces: `generateDocumentPdf` (org-side) + `generateDocumentPdfFromToken` (public, ADR-034). See §12.P2.8. | ~~Phase 2 mid~~ | n/a |
| Workflow stage automation (auto-advance on payment, etc.) | Phase 4 | After native kanban ships and users request automation |
| OAuth providers beyond email (Google, Microsoft) | Phase 5 mid | Customer demand or enterprise sales requirement |
| Audit log retention period (7 years UK default, configurable per plan?) | Pre-launch | Same as retention worker decision |
| Multi-org user — same auth identity owning two separate orgs (e.g. surveyor side AND architect side) | Phase 5 | When the dual_org_type plan flag is implemented |
| Inngest vs Trigger.dev for async job queue (notifications fan-out, retention worker, large file processing) | Phase 3 start | When notification volume exceeds 100/day OR push notifications are introduced |

---

## 35. Session 1 Carryover

Items flagged during Phase 1a Session 1 (kicked off and shipped 04 May 2026, deployed to https://pcd-saas.vercel.app) that did not block Session 1 done-criteria but require action in later sessions. Future sessions append their own subsection (§35.2 Session 2 Carryover, §35.3 Session 3 Carryover, etc.).

### §35.1 Session 1 (kickoff → ship: 04 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_SENTRY_DSN` was set in `.env.local` and Vercel during Session 1 to enable client-side Sentry capture (initial setup had server-only `SENTRY_DSN`) | Add to `env.ts` Zod validation + `.env.example` template so it's enforced going forward | Session 2 |
| 2 | `uuid@10` deprecation warning during Vercel build (`package.json` declares `^14.0.0`, suggests transitive source) | Investigate transitive source; `npm dedupe` or upgrade to `uuid@11` | Session 2 cleanup |
| 3 | `engines.node ">=20.0.0"` warns on Vercel (too loose) | Pin to `"20.x"` | Session 2 cleanup |
| 4 | Sentry environment tag is `vercel-production` (Vercel-Sentry integration prefix), not plain `production` | Decide whether to normalize via explicit `SENTRY_ENVIRONMENT` env var | Session 12 |
| 5 | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` live in Vercel as build-time env vars | None — out of `env.ts` scope (build-time vs runtime). Documented for awareness. | n/a |

**Full session handover:** `SESSION-1-HANDOVER.md` in repo root (commit `aceee51`).

**Production state at Session 1 close:**
- URL: https://pcd-saas.vercel.app
- Sentry test event verified: issue 117426189 (env `vercel-production`, release `93a29a8a36f9`)
- 13 commits on `main` (12 work + 1 handover)
- Cloud Supabase: project `gcwdasdujivliplthpvv` (eu-west-2 London)

### §35.2 Session 2 (kickoff → ship: 05 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | Migration filenames stay sequential (`0001_initial.sql`, `0002_*.sql`, …) but drizzle-kit auto-numbers from `0000`. Each new migration generated requires renaming `0000` → next sequential prefix and updating `meta/_journal.json` (`tag` + `idx`). | Document the rename dance in handover; consider a small `scripts/post-migrate.mjs` helper later if friction grows | Session 3 |
| 2 | RLS helper functions are `STABLE` = per-query caching by Postgres. Adequate for Phase 1a–1c; at 50+ concurrent requests, consider a session-scoped GUC or connection-state cache. | Revisit in Session 12 perf pass | Session 12 |
| 3 | `requireStakeholder()` is a documented stub. Phase 1b Session 6 ships `clients` table and replaces the body. The two stakeholder helpers (`auth_user_stakeholder_orgs`, `auth_user_stakeholder_projects`) ship as empty-set stubs in 0001 — also need their bodies filled in Session 6's first migration (CREATE OR REPLACE). | Phase 1b Session 6 | Session 6 |
| 4 | `uuid@10` deprecation warning persists — pulled in transitively by `resend → svix`. `npm dedupe` doesn't help. | Watch for `svix` update; `overrides` in package.json is risky | n/a |
| 5 | Seed/test scripts use `--conditions=react-server` to make `server-only` resolve to its empty export under tsx. Works but is non-obvious — anyone reading the npm scripts will need a comment to understand it. | Document in seed/run.ts and tests/setup.ts (done) | n/a |
| 6 | Tests fetch local Supabase creds from `npx supabase status -o env` at setup time. Couples test runs to having `supabase start` already running. Acceptable for dev; CI will need a different approach (likely `supabase start` in CI or hardcoded ephemeral creds). | Decide CI test strategy | Phase 2 (when CI gets set up) |
| 7 | `requireOrgUser` throws on multi-org users (`multi_org_unsupported_until_session_3`). The `(org)/dashboard` placeholder route protected by middleware will fail closed for any user with multiple `users` rows. Phase 1a doesn't create any so harmless until Session 3. | Replace branch with active_org_id resolution from session | Session 3 |
| 8 | `org_settings` and `invitations` got `deleted_at` columns that spec §10.5/§10.6 SQL didn't show. Per brief's "every domain table has deleted_at" hard rule + spec §23 (which lists exceptions and doesn't include either of these). The discrepancy in spec §10's per-table SQL is now reconciled — schema is the source of truth. | Update §10.5 / §10.6 SQL examples in this doc to show `deleted_at` (defer to next doc pass) | Session 3 doc cleanup |
| 9 | Sentry environment tag `vercel-production` (Session 1 carryover #4) is still un-normalized. | Set `SENTRY_ENVIRONMENT=production` in Vercel envs | Session 12 |

**Full session handover:** `SESSION-2-HANDOVER.md` in repo root.

**State at Session 2 close:**
- 9 commits added to branch (8 work + 1 handover-and-doc), branched from main
- Local Supabase: 9 tables, 12 RLS policies, 6 helper functions, seed data populated (2 + 8 rows)
- Cloud Supabase: not yet pushed — Session 3 (or operator) will run `supabase db push` and `npm run db:seed` against cloud
- RLS tests: 28/28 passing locally
- Build clean: `npm run build` succeeds
- Type-check clean: `npx tsc --noEmit` succeeds
- Drizzle parity: `drizzle-kit check` + `drizzle-kit generate` report no drift

### §35.3 Session 3 (kickoff → ship: 05 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | `sendEmail()` is a Phase 1a stub. Logs to console and writes a `webhook_events` stub row (`source='resend'`, `signature_verified=false`, `payload->>'stub'='true'`) plus an `email_events` row referencing it. The stub keeps the schema honest (`email_events.webhook_event_id NOT NULL`) until real Resend webhooks land. | Replace stub `webhook_events` insert with real Resend webhook ingestion. Old stub rows can be identified by `payload->>'stub' = 'true'` and pruned in a Session 4 cleanup step. | Session 4 |
| 2 | `acceptInvitation` returns `multi_org_not_yet_supported` if the auth user already belongs to another org. The accept page renders this as a clean error card. Multi-org context switching needs an `active_org_id` in session state plus an org-switcher UI. | Implement multi-org switcher (Decision 4 of Session 3 plan) — store `active_org_id` in a cookie or `user_sessions` row; update `requireOrgUser` to read it; build an org-picker component for the dashboard header. Until then, the error message itself is the affordance. | Session 5 |
| 3 | `webhook_events` has RLS DISABLED but no explicit GRANTs to anon/authenticated. Cloud blocks anon SELECT (no GRANT in cloud's permissive default privileges). Local Supabase's `supabase_admin` defaults grant arwdDxtm to anon on every new public table — so anon can SELECT/INSERT/UPDATE/DELETE on `webhook_events` locally. The RLS test `Anonymous CANNOT SELECT webhook_events (no GRANT)` flagged this as soon as Task D started inserting rows. The test now passes again because we cleared the dev DB before regression — but the gap exists locally. Cloud is unaffected. | Add migration 0004: `REVOKE ALL ON public.webhook_events FROM anon, authenticated;` (and similarly tighten `email_events` to authenticated-SELECT-only via RLS policy). Tighten the test so empty-data ≠ pass when the table is supposed to be unreadable. | Session 4 |
| 4 | Dev-server hydration race: clicking the login submit button right after page load can fall through to the default form GET (lands at `/login?email=…&password=…`), because React's onSubmit hasn't wired yet. Affects `scripts/screenshot.ts --auth` and the per-task walkthrough scripts; mitigated with a `/login` warmup pass + retry-on-hydration-race loop. Production build doesn't have this issue (no JIT compilation). | Consider switching the `<form>` to a Next.js server-action `<form action={signIn}>` so the no-JS fallback is correct (POST to /login) instead of GET. Out of scope here because it requires reshaping signIn's input contract. | Phase 5 polish |
| 5 | `actions/auth.ts` accepts an optional `next` field on signIn / signUp / sendMagicLink, validated as relative-path-only via `safeNext()`. Used by login + signup pages to forward `?invitation=<token>` through the auth-callback chain. | Use the same `next` plumbing for the signup-confirmation flow when adding email-verified gating in Session 4. | Session 4 |
| 6 | Login + signup pages now wrap `useSearchParams()` in a `<Suspense>` boundary (Next 15 requirement to keep static prerender working). Other auth pages (`magic-link`, `forgot-password`, `reset-password`) don't yet use search params; if Phase 1b adds query-param forwarding to them, they'll need the same wrapper. | Pattern noted; apply when extending those pages. | Session 5+ |
| 7 | Three Playwright walkthrough scripts (`walkthrough-task-b.ts`, `walkthrough-task-c.ts`, `walkthrough-task-d1.ts`, `walkthrough-task-d2.ts`, `walkthrough-task-e.ts`) were used to verify each task end-to-end against the dev server then deleted before commit. Pattern is: sign in → drive UI → assert DB shape via service-role supabase client. Worth promoting into a real e2e test suite (under `e2e/`) using the existing `playwright.config.ts`. | Decide whether to commit walkthrough scripts as a stable e2e suite, or rely on Vitest action-shape tests. Probably both eventually. | Session 4 (alongside webhook tests) |

**Full session handover:** `SESSION-3-HANDOVER.md` in repo root.

**State at Session 3 close:**
- 8 commits added to branch (7 feat/chore + 1 handover/docs commit at merge), branched from main
- Local Supabase: tenant data cleared after walkthroughs (so RLS tests pass clean); 2 + 8 reference rows seeded
- Cloud Supabase: no schema changes this session; cloud unchanged
- RLS tests: 28/28 passing
- Cloud smoke: 3/3 passing
- Build clean: `npm run build` succeeds (19 routes including new /onboarding, /settings, /settings/team, /invitations/[token], /invitations/[token]/accept)
- Type-check clean: `npx tsc --noEmit` succeeds
- Drizzle parity: no schema changes; `drizzle-kit check` would still report no drift

### §35.4 Session 4 (kickoff → ship: 05 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | `RESEND_FROM_ADDRESS` is unset; `getFromAddress()` falls back to Resend's `onboarding@resend.dev` sender. Works for dev + small sends without domain verification. Pre-launch sends should come from a verified `pcdportal.com` address with SPF/DKIM/DMARC records. | Verify pcdportal.com in Resend dashboard, set SPF/DKIM/DMARC DNS records, set `RESEND_FROM_ADDRESS=PCD Portal <noreply@pcdportal.com>` in Vercel Production env. | Pre-launch |
| 2 | Upstash Redis URL is the dev project. Production traffic will share rate-limit windows with dev sessions if not split. | Create a separate Upstash Redis project for production; set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` per environment in Vercel. | Pre-launch |
| 3 | `sendPasswordReset` in `actions/auth.ts` is **not** rate-limited. Same shape as `signIn`/`signUp`/`sendMagicLink`; just out of the kickoff brief's literal scope. | Wrap with `rateLimit('auth', `${ip}:${email}`)` using the same pattern as `signIn`. ServerActionErrorCode already includes `rate_limited`. | Session 5 |
| 4 | Stripe webhook retries on 429 are messy — Stripe will keep retrying, and a tight rate limit can choke legitimate retries. When Stripe lands in Phase 6, exempt Stripe IP ranges from the webhook limiter. | Add IP-allowlist check in `app/api/webhooks/[source]/route.ts` for `source=stripe`. Stripe publishes a JSON file of IP ranges. | Phase 6 |
| 5 | `audit_logs.action` is `text` (no SQL CHECK), but `lib/audit/log.ts` `AuditAction` union is the agreement. The stub-cleanup script (`scripts/cleanup-stub-webhook-events.ts`) logs a hard delete as `action: 'soft_delete'` with `metadata.hard_delete: true` — the closest verb in the union. | Add `'system_cleanup'` to the AuditAction union; refactor the cleanup script (and any future system-cleanup paths) to use it. Additive — no migration needed. | Session 5 (small refactor) |
| 6 | Webhook signature failures are recorded with `processing_error="Signature verification failed"` and `processed_at` set, but never replayed. A row from a brief misconfiguration (e.g. wrong signing secret) stays unprocessable forever. | Build a Phase 6 admin tool: per-row "re-verify and process" button on `webhook_events` rows where `signature_verified=false`. Low priority — current usage is a real misconfiguration. | Phase 6 |
| 7 | Action tests rely on `vitest.config.mts` aliasing `'server-only'` to its `empty.js` because vitest doesn't honor the `react-server` conditional export. RLS tests don't need this (no `server-only` imports). Future test categories that import server modules inherit the alias automatically. | Pattern noted; revisit if vitest gains conditional-export support natively. | Open-ended |
| 8 | Resend webhook endpoint must be configured in the Resend dashboard (`https://resend.com/dashboard` → Webhooks → Add Endpoint → URL `https://pcd-saas.vercel.app/api/webhooks/resend` → subscribe to `email.{sent,delivered,bounced,complained,opened,clicked,delivery_delayed}` → copy signing secret to `RESEND_WEBHOOK_SECRET` in Vercel env Production AND Preview → redeploy). Until done, real Resend events don't flow back; only outbound sends + `outbound_emails` rows happen. | User-action setup post-deploy. Once configured, test the round-trip with a real invite + bounce simulation (`bounced@resend.dev`). | Post-deploy (S5 readiness) |

**Full session handover:** `SESSION-4-HANDOVER.md` in repo root.

**State at Session 4 close:**
- 9 commits added to branch (8 feat/test/chore + 1 handover/docs commit at merge), branched from main via session-4-webhooks-rate-limiting-resend
- Local Supabase: migrations 0001..0005 applied; 2 + 8 reference rows seeded; 0 stub webhook_events rows
- Cloud Supabase: migrations 0001..0005 applied; 0 stub webhook_events rows; 1 audit row marking the cleanup
- RLS tests: 29/29 passing (28 prior + new email_events anon test)
- Action tests: 19/19 passing (new test:actions script)
- Cloud smoke: 3/3 passing
- Build clean: `npm run build` succeeds
- Type-check clean: `npx tsc --noEmit` succeeds
- Drizzle parity: `drizzle-kit check` reports no drift

---

### §35.5 Session 5 (kickoff → ship: 06 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | PCD Surveyor template ships via standalone idempotent script (`scripts/seed-hasnath-pcd-surveyor.ts`, npm: `db:seed-pcd-surveyor`), NOT a SQL migration. Per architectural decision: it's intentionally org-specific (only fits Hasnath's surveyor flow) and seeding it as a system template would clone it for every new org. The script reads `org_settings` (key=`company.company_number`, value=`"16240187"`) to find Hasnath's org. | Run `npm run db:seed-pcd-surveyor` against cloud once Hasnath's org is signed up and company_number is populated in settings. Re-running is a safe no-op. | User action post-signup |
| 2 | `auth.users` orphan on transaction rollback. The Supabase auth signup creates the `auth.users` row before `createOrganization` is called. If the Drizzle transaction inside `createOrganization` rolls back (e.g. system template missing), no `public.users`/`organizations` rows are created — but the `auth.users` row remains, orphaned. Workaround: re-run signup; `authUserHasMembership` returns false, second attempt proceeds. | Phase 6: add a background job that purges `auth.users` rows without a `public.users` link after N hours. | Phase 6 |
| 3 | `requireOrgUser` cookie cleanup uses try/catch around `cookies().delete()` because RSC contexts throw on cookie mutation. Stale cookie self-corrects on next mutation request — minor inefficiency, no functional impact. | Pattern documented in [lib/auth/requireAuth.ts:requireOrgUser]. If Next.js gains a `cookies().tryDelete()` API, swap. | Open-ended |
| 4 | Project list has no client column. Stakeholders ship in Session 6 (`project_stakeholders`); the join would land empty for every Session 5 project. Page query (`db/queries/projects.ts listProjectsForOrg`) returns the shape ready to extend. | Add the column when Session 6 stakeholders are wired up. | Session 6 |
| 5 | `projects` RLS uses `auth_user_stakeholder_projects()` stub from migration 0001 (still empty-set). | Session 6's first migration MUST `CREATE OR REPLACE` it to query `project_stakeholders`, mirroring how 0007 unstubbed `auth_user_stakeholder_orgs()`. | Session 6 |
| 6 | Two new SECURITY DEFINER helpers shipped in 0007 to break clients↔memberships RLS recursion: `auth_user_client_ids()` and `auth_user_org_client_ids()`. Both are STABLE + SECURITY DEFINER + pinned search_path. Pattern mirrors Phase 1a's `is_org_member`. | If Session 6 adds policies that cross client/membership/stakeholder tables, prefer adding more helpers over inline subqueries. Recursion pattern documented in 0007 helper comments. | Session 6 onwards |
| 7 | Stage transitions are NOT implemented. Project detail page renders the stage progression view with current stage highlighted, but no advance-stage UI. Placeholder text: "Stage transitions ship in a future update." | Session 8 ships `moveProjectToStage` + the UI. Replace placeholder. | Session 8 |
| 8 | Audit verb for org switch is `permission_change`. Closest existing fit; not a new verb. | If Session 6 introduces stakeholder context switching with materially different semantics, discuss adding a new AuditAction member rather than reusing. | Session 6+ |
| 9 | Force-rollback test for `createOrganization` was deferred (would race with parallel test files reading the same Simple system template). Atomicity is a Postgres engine guarantee; the happy-path test verifies the transaction wiring is correct. | If explicit rollback coverage is needed later, isolate via `vi.mock('@/db', ...)` — don't manipulate global DB state. | Open-ended |
| 10 | Worktree's `supabase/.temp` was empty after auto-naming; `supabase migration list --linked` failed until we copied `.temp` from the main repo. | Future worktrees may need the same one-time `cp -r ../../../supabase/.temp ./supabase/.temp`. Consider scripting if it recurs. | Tooling note |

**Full session handover:** `SESSION-5-HANDOVER.md` in repo root.

**State at Session 5 close:**
- 7 commits on the worktree branch (6 feat/test/chore + 1 handover/docs commit), to be merged into session branch then `main`
- Local Supabase: migrations 0001..0009 applied; reference data seeded; "Simple" system template seeded
- Cloud Supabase: migrations 0001..0009 applied; cloud anon curl on all 5 Phase 1b tables returns 401
- RLS tests: 46/46 (29 prior + 17 new across workflows / clients / projects)
- Action tests: 50/50 (19 prior + 31 new across orgs / projects / clients / switch-org / cancel-invitation + cancelled-invite security test in accept.test.ts)
- Cloud-smoke: 7/7 (3 prior + 4 new for the Phase 1b anon-blocked check)
- Build clean: `npm run build` succeeds
- Type-check clean: `npx tsc --noEmit` succeeds
- Drizzle parity: `drizzle-kit check` reports no drift
- Phase 1a `createOrganization` REST refactored to Drizzle `db.transaction(...)` — atomic signup

### §35.6 Session 6 (kickoff → ship: 06 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | Visibility profile UPDATE auto-flips to `'custom'` when individual flag changes arrive without an explicit profile arg. Per §14, the preset is documentation, not a constraint. | Session 7 RLS hardening tests should not assume a stable `visibility_profile` value across updates — only the flag values matter for RLS. | Session 7 |
| 2 | `findOrCreateClient` has a tx-friendly sibling: `findOrCreateClientTx(tx, input, orgId)`. Public action unchanged. Inside outer transactions (e.g. `inviteStakeholder`), use the Tx variant directly — Drizzle does NOT support nested transactions. | Pattern mirrors `cloneSimpleWorkflowForOrg(tx, orgId)` in `actions/orgs.ts`. Future multi-table actions composing client creation should use this pattern. | Phase 1c onwards |
| 3 | `createProject` has a side-effect: inserts a `project_stakeholders` row with `role='primary_client', visibility_profile='full', accepted_at=now()` when caller passes `clientId`. The org user adding their own client is implicitly accepted; client doesn't need to magic-link in. | Session 7 fixtures that exercise project creation must account for this. Phase 1c session that adds project edit flow should preserve this primary_client row across edits. | Session 7+ |
| 4 | Magic-link branching pattern: `app/invitations/[token]/accept/page.tsx` dispatches on `invitation.invitationType`. Adding a new invitation kind (e.g. cross-org transfer in Phase 6) means: new branch in the accept route + new branch in the landing page + new server action. Token-preservation through `?invitation=<token>` on signup/signin is unchanged. | Phase 6 cross-org transfer flow. | Phase 6 |
| 5 | `cancelInvitation` is type-agnostic — filters only on (id, orgId). Stakeholder cancellation reuses the team-invite cancel UI exactly. Don't add `cancelStakeholderInvitation`; existing path is the right path. | Reuse for any future invitation type. | Open-ended |
| 6 | Two new SECURITY DEFINER helpers in 0010: `auth_user_org_project_ids()` + `auth_user_stakeholder_project_visibility(uuid)`. The latter returns a TABLE of 5 booleans (parameterized flag bag). Used by project_milestones (gates `can_view_schedule`); will be reused by Phase 1c project_files (gates `can_view_drawings`). | Phase 1c project_files RLS should use `auth_user_stakeholder_project_visibility` for the can_view_drawings check. | Phase 1c (S10) |
| 7 | `auth_user_stakeholder_projects()` unstubbed in 0013. Stakeholders now see projects via `projects_select_org_or_stakeholder` (in 0008). Linchpin verification in `tests/rls/projects-stakeholder-visibility.test.ts`. | Session 7 RLS tests can rely on this — extend the matrix. | Session 7 |
| 8 | **FOR ALL is a footgun.** Architecture spec literal `FOR ALL` on modify policies caused soft-deleted rows to leak past the SELECT policy's `deleted_at IS NULL` filter (multiple PERMISSIVE policies on the same command are OR'd). Fixed in 0012 by replacing FOR ALL with per-command INSERT/UPDATE/DELETE policies. **Future tables: use per-command policies** (matches 0008_projects.sql convention). Or use RESTRICTIVE policies if you really need an AND. | All future RLS migrations. SKILL.md may want a Rule 23 about this. | Permanent rule |
| 9 | Stakeholder portal at `app/portal/*` (richer than the §32-original `/client/projects` placeholder — per-project pages with flag-gated conditional sections). Portal layout requires `requireStakeholder`; on `not_authorized/no_stakeholder_identity` redirects to `/dashboard` (org user wandered into wrong portal). | Phase 1c session 9 (messages) + session 10 (files) slot under `/portal/projects/[projectId]/`. | Phase 1c |
| 10 | Worktree `node_modules` symlink ritual. The auto-spawned worktree directory has an empty `node_modules/` (Vitest's `.vite` cache lands there but no packages). Vitest's `server-only` alias is `__dirname`-rooted, so without the symlink action tests crash at import. Fix: `rm -rf node_modules && ln -s ../../../node_modules node_modules`. Add to the worktree ritual alongside `.env.local` and `supabase/.temp/`. | Update SKILL.md Rule 22 to include this. | SKILL.md amendment |
| 11 | Drizzle-kit regenerates EVERYTHING when snapshots are stale. Migrations 0006–0009 didn't get snapshots committed; first `db:generate` after a multi-session gap re-creates every table from the last snapshot. Fix: trim the generated SQL to only the new statements; the auto-created snapshot for the new migration is correct. | Always commit `db/migrations/meta/NNNN_snapshot.json` alongside the SQL. Long-term: catch missing snapshots in CI. | Tooling improvement |
| 12 | Vitest fixture latent uuidv7-slice collision. `createWorkflowProjectFixture` used `uuidv7().slice(0, 8)` for "random" client email suffixes — but the first 8 hex chars of uuidv7 are the millisecond timestamp prefix, not random bits. Two parallel forks at the same ms collided on `clients.email` UNIQUE. Fixed by switching to `Math.random().toString(36)`. | Don't slice uuidv7 for randomness; use full uuid or Math.random. | Permanent rule (test fixtures) |
| 13 | **Pending invitation cascade.** `removeStakeholder` soft-deletes the `project_stakeholders` row but does NOT cancel a paired pending `invitations` row. A removed stakeholder could still click their unexpired magic link and accept, re-creating active access via the unaccepted invitations branch. Surfaced during the post-Session-6 manual UI sanity check. | Address in Session 7 with cascade-cancel logic when `acceptedAt IS NULL` (slotted into §32 row 3). | Session 7 |
| 14 | **Visibility picker UX (intentional).** Per-flag toggles only appear under the "Custom" profile; picking a named preset (full / progress_only / documents_only / schedule_only) commits to its flag set without showing the per-flag fieldset. This is design-intentional — keeps the model coherent and discourages drift. | Document in any future onboarding for engineers extending `VisibilityProfilePicker`. | Permanent design note |

**Full session handover:** `SESSION-6-HANDOVER.md` in repo root.

**State at Session 6 close:**
- 14 commits total: 12 worktree commits + 1 merge commit + 1 docs commit (this commit)
- Local Supabase: migrations 0001..0013 applied; reference data seeded
- Cloud Supabase: migrations 0001..0013 applied; cloud anon curl on `project_stakeholders` and `project_milestones` returns no rows / 401
- RLS tests: 55/55 (46 prior + 9 new across project-stakeholders / project-milestones / projects-stakeholder-visibility)
- Action tests: 66/66 (53 prior + 13 new across stakeholders / milestones)
- Cloud-smoke: 9/9 (7 prior + 2 new for project_stakeholders / project_milestones anon-blocked)
- Build clean / tsc clean / drizzle-kit check clean
- Magic-link landing branches on `invitation_type`; accept route dispatches to `acceptStakeholderInvitation` for stakeholder kinds; landed page redirects to `/portal/projects/{id}` on success
- Stakeholder portal at `/portal/*` with per-project pages and §14-flag-gated conditional sections; org users wandering in get bounced to `/dashboard`
- `requireStakeholder()` is no longer a stub — Phase 1b achieves end-to-end stakeholder identity

### §35.7 Session 7 (kickoff → ship: 06 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | **`removeStakeholder` is now transactional.** The action introduces a `db.transaction(...)` wrapper around the soft-delete + cascade-cancel of the paired pending invitation. Cascade fires only when `invitations.acceptedAt IS NULL` (Design C — already-accepted invitations are preserved as historical records). Audit log writes a second entry with `metadata.reason = 'cascade_from_remove_stakeholder'` when the cascade fires. | Future `removeStakeholder` or analogous remove actions: keep the cascade-cancel pattern. Don't add a second action for "cancel paired invitation"; the cascade is the canonical path. | Permanent — applies to any future remove flow with a paired invitation row |
| 2 | **Matrix testing convention** (documented in §9). Stakeholder-visible RLS tests use a parameterized matrix across the 5 visibility profiles × protected tables × 4 ops. Phase 1c sessions adding `messages` and `project_files` should extend `tests/rls/visibility-matrix.test.ts` rather than duplicating the structure. The shared assertions (`assertVisibleIds`, `assertNotVisible`, `assertWriteDenied`, `assertRpcReturns`) are in `tests/rls/_helpers.ts`. | Phase 1c S9 (messages) + S10 (project_files): extend visibility-matrix.test.ts. | Phase 1c |
| 3 | **`tests/fixtures/stakeholder-fixtures.ts` is the canonical fixture set for stakeholder tests.** Seven builders: `buildAcceptedStakeholderFixture(profile)`, `buildPendingStakeholderFixture()`, `buildRemovedStakeholderFixture()`, `buildSoftDeletedClientFixture()`, `buildExpiredInvitationFixture()`, `buildMultiOrgStakeholderFixture()`, `buildOwnerAndStakeholderFixture()`. Each layers on `createWorkflowProjectFixture()` and exposes a sequential cleanup. | New stakeholder edge-case scenarios should add a builder here, not inline a fixture in a test file. | Phase 1c onwards |
| 4 | **`describe.each` / `it.each` patterns introduced.** First use of Vitest's parameterized describe/it blocks in this codebase. Vitest reports each iteration as a separate test (a single `describe.each` over 5 profiles + an inner `it.each` over 3 tables = 15 reports). Plan source counts vs Vitest reports diverge — plan tracks source-level structure; CI/runner output shows expanded counts. | Future matrix tests: same pattern. Document Vitest's expansion semantics if onboarding doc mentions test counts. | Permanent test convention |
| 5 | **CI gate: `.github/workflows/rls-gate.yml`.** Runs `test:rls + test:actions + test:cloud-smoke` on every PR to main. Cloud-smoke is gracefully skipped when `CLOUD_SUPABASE_URL` / `CLOUD_SUPABASE_ANON_KEY` repo secrets are not set (defensive fallback for the very PR landing the gate). Branch protection on `main` requiring this check is **manual UI** — see SESSION-7-HANDOVER.md for setup steps. The user must configure the cloud-smoke secrets to enable that part of the gate. | Permanent — every Phase 1c+ migration that touches RLS goes through this gate. | Permanent |
| 6 | **Anti-hijack two-layer defense documented.** `acceptStakeholderInvitation` checks `already_accepted` BEFORE `email_mismatch` (so a different-email auth user replaying an accepted token gets `already_accepted`, not `email_mismatch` — no email leak in the response). Second-line defense: if `clients.auth_user_id` has been mutated to a different valid auth user, the legitimate stakeholder accepting their own token gets `client_already_linked`, and the link is NOT silently overwritten. Verified in `tests/rls/security-boundary.test.ts`. | Future invitation-accept flows (cross-org transfer in Phase 6, etc.): mirror this two-layer pattern. | Phase 6+ |
| 7 | **Helper SET search_path is regression-tested.** `auth_user_stakeholder_project_visibility(uuid)` and `auth_user_org_project_ids()` both have `SET search_path = public, auth, pg_temp`. Tests in `tests/rls/security-boundary.test.ts` query `pg_proc.proconfig` and assert the SET clause is present. Future migrations dropping the SET clause would fail these tests. | Permanent regression catch. Apply same test pattern to any new SECURITY DEFINER helper. | Permanent |
| 8 | **Existing re-invite test updated.** The test at `tests/actions/stakeholders.test.ts:162` ("re-invite after removal → undelete path resets fields") previously soft-deleted the invitation row manually before re-inviting. After the cascade-cancel hotfix, that manual cancel is now redundant; the test was updated to call `removeStakeholder()` which cascades the cancel atomically. | Pattern: when the action grows new responsibilities, update existing tests to exercise them rather than working around them. | Test maintenance |
| 9 | **Worktree pre-flight ritual was incomplete on Session 6 close.** This worktree (`pedantic-goldwasser-747ca1`) was missing all SKILL Rule 22 artifacts (`.env.local` symlink, `node_modules` symlink, `supabase/.temp/` copy). Recreated inline at Session 7 kickoff via `ln -s ../../../{.env.local,node_modules}` + `mkdir + cp` for `supabase/.temp/`. Note: `.env.test` is referenced in the SKILL ritual but is NOT actually used by `tests/setup.ts` — the setup loads `.env.local` and uses `npx supabase status -o env` for local creds. SKILL.md Rule 22 should drop the `.env.test` step or document it as conditional. | Update SKILL Rule 22 to drop `.env.test` from the ritual list. | SKILL.md amendment |
| 10 | **Performance review + index tuning descoped.** Original §32 row 3 included these; the Session 7 plan locked scope to "no schema changes." Carried as either a S8 follow-up (workflow management session) or a standalone hardening task. The two SECURITY DEFINER helpers (`auth_user_org_project_ids`, `auth_user_stakeholder_project_visibility`) bypass RLS via SET ROLE postgres so query plans on RLS-bound tables are dominated by these helpers — review their SQL bodies before any index push. | Session 8 or follow-up. EXPLAIN the project-list query and the milestone-list query as the highest-traffic stakeholder paths. | Session 8 / follow-up |
| 11 | **`tests/rls/edge-cases.test.ts` and `tests/rls/security-boundary.test.ts` are hybrid.** They live in `tests/rls/` but import server actions (`acceptStakeholderInvitation`) with the standard auth/email/ratelimit mocks for the security-relevant action assertions. This is a deliberate scope choice — the action's rejection-path coverage belongs adjacent to the RLS coverage of the same scenario. Mirror this pattern when Phase 1c adds equivalent action paths. | Phase 1c when adding e.g. message-accept/reject flows. | Phase 1c |

**Full session handover:** `SESSION-7-HANDOVER.md` in repo root.

**State at Session 7 close:**
- 9 commits on the session branch (this branch, off main at 570baa1)
- Local Supabase: migrations 0001..0013 applied (no new migrations this session — explicit no-schema-change scope)
- Cloud Supabase: unchanged from Session 6
- RLS tests: 136/136 (was 55; +60 visibility-matrix +15 edge-cases +6 security-boundary)
- Action tests: 77/77 (was 66; +3 cascade-hotfix +5 visibility-runtime-override +3 duplicate-detection)
- Cloud-smoke: 9/9 (unchanged)
- Build clean / tsc clean
- New CI workflow `.github/workflows/rls-gate.yml` (runs on PRs to main)
- `removeStakeholder` is now transactional and cascade-cancels pending invitations (Design C)
- Production smoke test deferred until merge-to-main (no UI changes; only the cascade-cancel touches a user-facing path indirectly via the existing remove flow)

### §35.8 Session 8 (kickoff → ship: 07 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | **`stage_changed` audit metadata schema is LOCKED.** 9 fields: `from_stage_id`, `from_stage_name`, `from_stage_position`, `to_stage_id`, `to_stage_name`, `to_stage_position`, `workflow_id`, `is_backward_transition`, `is_terminal_destination`. Phase 1c notification dispatch consumes all 9. Any narrowing requires a migration of historical rows. | Phase 1c S11 (notifications): read this schema directly. Don't define a parallel one. | Permanent |
| 2 | **`audit_logs.action` extended with `'stage_changed'` and `'delete'`.** Closed-union type in `lib/audit/log.ts`. `'stage_changed'` for project stage transitions; `'delete'` for hard delete on tables without `deleted_at` (workflow_stages). | Future closed-union extensions: keep the type narrow + per-domain. | Permanent |
| 3 | **System-template guard ordering matters.** Initial bug: cross-org check ran before system-template check, but system templates have `org_id IS NULL`, so the comparison shadowed the system-template branch (returned not_found instead of not_authorized). Fix: check `isSystemTemplate` FIRST, then cross-org. Pattern: when a resource has multiple "visible by everyone" branches (system templates, public refs, etc.), check the public-visibility branch before the org-membership branch. | Future: any reference table with mixed-visibility (system-seeded + per-org) follows this guard order. | Permanent |
| 4 | **Defense-in-depth: include `org_id` in workflow_in_use checks even though workflow IDs are globally unique.** The action's `db` instance bypasses RLS via the postgres pooler role. RLS would catch the boundary on a real client query, but action-layer queries hit the DB without that net. Including `org_id` makes the planner cleanly use `idx_projects_org` (verified Phase E EXPLAIN ANALYZE) AND eliminates a class of cross-org leak that would otherwise rely on RLS-on-actions semantics. | Pattern for any future "in-use" check that filters by FK to a per-org resource. | Permanent |
| 5 | **`tests/rls/workflows.test.ts` extended in place rather than creating workflows-cross-org.test.ts.** The Session 8 plan called for a separate file but the existing file already had cross-org SELECT/UPDATE coverage; +8 new tests covering INSERT/DELETE cross-org + system-template INSERT/DELETE were appended directly. Cleaner than splitting. | Future RLS additions: extend existing per-table file before creating a new one. | Test convention |
| 6 | **No `idx_projects_workflow_id`.** Phase E audit identified the missing index but proved it's not needed at typical scale: `countActiveProjectsByWorkflow` filters by `org_id` first (idx_projects_org covers it); `deleteWorkflow`'s in-use check now also filters by org_id (entry 4). Re-evaluate if "find all projects on workflow X" becomes a frequent cross-org admin query (unlikely). | Phase 4+ if architect lifecycle introduces global workflow analytics. | Future |
| 7 | **Phase F (browser QA) ran post-merge, NOT during the session branch.** The plan called for QA before docs commit but `gh` CLI wasn't available on the worktree machine to open the PR programmatically. User opened the PR via web UI and ran Phase F themselves on the deployed preview. Future sessions: confirm `gh` CLI availability during pre-flight, OR plan for user-driven QA from the start. | Pre-flight ritual update: include `which gh` in Rule 22. | SKILL.md amendment |

**Full session handover:** `SESSION-8-HANDOVER.md` in repo root.

**State at Session 8 close:**
- 7 commits on the session branch (this branch, off main at e60ca15)
- Local Supabase: migrations 0001..0013 applied (no new migrations — schema sufficient per Phase A1 verification)
- Cloud Supabase: unchanged from Session 7
- RLS tests: 147/147 (was 136; +8 workflows write/cross-org +3 project-stage-transition)
- Action tests: 100/100 (was 77; +16 workflows CRUD +7 stage-transition)
- Cloud-smoke: 9/9 (unchanged)
- Build clean / tsc clean
- Phase 1b is closed
- PCD Surveyor seed script updated to 10 stages but not yet run against the user's real org (manual step post-merge — see SESSION-8-HANDOVER.md)

### §35.9 Session 9 (kickoff → ship: 09 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | **`auth_user_conversation_ids()` SECURITY DEFINER helper shipped proactively in 0014 (stub) → 0017 (real body).** Mirrors the 0001 → 0013 pattern for `auth_user_stakeholder_projects()`. The conversations ↔ conversation_participants recursion (textbook 42P17) is broken before tests run. Helper is pinned `SET search_path = public, auth, pg_temp` per Phase 1a/1b convention. | Future tables that cross-reference participants: extend the helper rather than inline subquery. | Permanent |
| 2 | **`conversation_participants.left_at` for soft-leave (ADR-028).** Spec §12.2 didn't show a soft-delete column; we added `left_at`. Default queries filter `left_at IS NULL`; `removeConversationParticipant` sets it to `now()` paired with a system message in the same tx. | Future participant-style tables (e.g. project_stakeholders if redesigned): consider whether `left_at` is the better verb than `deleted_at`. | Permanent design pattern |
| 3 | **System messages = participant changes only this session (ADR-027 / S4b sub-decision).** Stage transitions, file uploads, and milestone events that COULD be system messages are deferred to Session 11 when `project_activity` ships. The `messages_sender_id_consistency` CHECK (sender_type='system' AND sender_id IS NULL) is enforced; RLS does NOT permit authenticated INSERTs with sender_type='system' — only postgres pooler tx writes them. | Session 11: ship `project_activity` per spec §12.7. Decide then whether non-message events live there only, or also produce derived `system` rows in `messages`. | Session 11 |
| 4 | **shadcn AlertDialog + ConfirmDialog wrapper (ADR-025; supersedes ADR-024).** Three native `confirm()` callsites migrated: WorkflowsList (delete workflow), EditWorkflowDialog (remove stage), StageSelector (backward stage). New Session 9 surfaces (delete message, remove participant) all use the wrapper. DEBT-016 resolved. | Future destructive flows: use `<ConfirmDialog>`, not `window.confirm`. | Permanent rule |
| 5 | **Auto-create one-to-one + general conversations on stakeholder accept + `client_org_memberships` insert.** `acceptStakeholderInvitation` now calls `autoCreateOneToOneConversationTx` inside its existing tx. `findOrCreateClient` (public action) and `inviteStakeholder` both call `autoCreateGeneralConversationTx` after the membership insert. Helpers are idempotent. | If new code paths create memberships (e.g. cross-org transfer in Phase 6), they MUST call `autoCreateGeneralConversationTx` to keep general threads in lockstep with memberships. | Permanent design rule |
| 6 | **NewConversationDialog + addConversationParticipant validate cross-org clients via `client_org_memberships` join.** Without this check, an attacker could grant a cross-org auth user visibility into the org's conversations via `auth_user_conversation_ids()`. RLS would technically also reject (the conversation_participants_insert_org_admins policy chains through the conversation's org-admin check) but action-layer validation gives a clean error. | Future actions accepting client_id input across an org boundary: replicate this defense-in-depth join. | Permanent rule |
| 7 | **`messages_select` policy does NOT filter `deleted_at IS NULL`** (Q6 / Decision 9.4B). Soft-deleted rows remain visible to participants; the projection layer in `db/queries/conversations.ts` (`displayBody`) and `hooks/use-conversation-messages.ts` (`projectRow`) replaces body with `'[deleted]'`. The raw `body` is preserved in DB. | Phase 1c S11 + later: when adding analytics or notification dispatch, read from the projection layer or replicate the deleted-body collapse. | Permanent contract |
| 8 | **Realtime: `messages` added to `supabase_realtime` publication in 0016.** Subscriptions filter by `conversation_id=eq.<id>`. RLS enforces visibility at the subscription layer per spec §19. `conversation_participants` was NOT added to the publication this session — left_at and last_read_at updates don't propagate live. Inbox badge refresh relies on `router.refresh()` after mark-read. | Session 11+: if real-time inbox updates are needed (e.g. participant join feedback), add conversation_participants to the publication. | Session 11 candidate |
| 9 | **Drizzle journal/snapshot drift (DEBT-019).** Migrations 0012-0017 are hand-written and don't have entries in `db/migrations/meta/_journal.json`. Inherits the §35.6 entry 11 gap. Workaround documented; tooling fix deferred. | Same as §35.6 entry 11 — trim regenerated SQL when drizzle-kit regenerates. | Indefinite |
| 10 | **Manual QA + cloud Supabase verification deferred to user.** Local Docker daemon was offline during the session, so migrations 0014-0017 + 14-step Phase F runbook are pending user execution. Tests are written but unrun. Build is clean (`npm run build` succeeded with all conversation routes). | User: start Docker → `npm run db:reset` → `npm run db:seed:local` → `npm run test:rls` (target ~175) + `npm run test:actions` (target ~125) + `npm run test:cloud-smoke` (target ~12). Then walk Phase F per the kickoff brief. Then `supabase db push --linked` to apply 0014-0017 to cloud. | User action before merge |
| 11 | **New org members not auto-joined to existing one_to_one conversations (DEBT-022).** Decision 9.1A's "all active org members" applies at conversation-creation time. New users joining the org afterward must be added manually. Documented as DEBT-022; deferred. | Phase 4+ team-management polish. | Open |
| 12 | **Markdown sanitization allowlist** in `components/conversations/MessageBubble.tsx`: `p`, `strong`, `em`, `a`, `code`, `pre`, `blockquote`, `ul`/`ol`/`li`, `br`. Anchor `href` restricted to `^https?:|^mailto:`. NO tables, NO images, NO raw HTML. | Future markdown surfaces (notifications, project descriptions): reuse this `sanitizeSchema` constant rather than duplicating. | Permanent — extract if a 2nd surface needs it |
| 13 | **Phase F manual QA executed pre-merge — 11 PASS / 1 FAIL deferred / 2 N/A / 1 SKIP across the 14-step runbook.** Three runtime bugs caught and fixed live: commits `9fc485b` (sort comparator coercion in `db/queries/conversations.ts`), `3e650b4` (`formatRelative` widening in `components/conversations/ConversationsInbox.tsx`), `6bba94b` (Resend verified-domain sender `noreply@plancraftdaily.co.uk` replaces `onboarding@resend.dev`). XSS sanitization (Step 12, CRITICAL) confirmed working — rehype-sanitize blocks `<script>` injection. | Future sessions: walk all 14 steps, track strict PASS/FAIL/N/A/SKIP per DEBT-017. Phase F is the canonical pre-merge gate. | Permanent |
| 14 | **Eight follow-up DEBT entries logged from Phase F (DEBT-024 through DEBT-031).** Pre-launch ops: 024 (Resend paid tier for external recipients), 025 (Sentry user/org scope context). Opportunistic: 026 (`getAppUrl()` helper), 027 (`sql<Date>` runtime lie — point-of-use patched, structural refactor deferred), 028 (OrbStack idle shutdown). Session 11 candidates: 029 (realtime UI not auto-updating — Step 7 FAIL), 030 (project detail page lacks conversation deep-link — Step 4 setup), 031 (no unread badge in nav — Step 11 N/A). | Sessions 10–12: cross-reference these IDs when touching adjacent surfaces. Session 11 inherits 029 + 030 + 031 explicitly. | Open |
| 15 | **`sql<Date>`-tagged subqueries return ISO string at runtime, not Date (DEBT-027 — Bug class).** Drizzle column-level type coercion only runs for properly-mapped table columns; `sql<Date \| null>` annotations on raw SQL subqueries (e.g. `db/queries/conversations.ts:66`, `:221`) propagate a runtime lie into downstream consumer types. Caught at point-of-use in two places during Phase F. Future `sql<>` raw-expression authors: prefer `sql<string \| null>` + explicit `new Date()` coercion at the consumer boundary, OR coerce inside the query result `.map()`. | Permanent rule for Drizzle raw `sql<>` usage — the `<>` generic does NOT round-trip the runtime type. | Permanent |

**Full session handover:** `SESSION-9-HANDOVER.md` in repo root.

**State at Session 9 close (pre-merge):**
- 10 commits on the `session-9-phase-1c-messaging-core` branch (off main at 06c0961)
- Local Supabase: Docker daemon offline at session close — migrations 0014..0017 not yet applied locally
- Cloud Supabase: not yet pushed (pending user action)
- RLS tests: written (3 new files) but unrun. Target +28 → 175. File counts: 7 + 7 + 6 + a few system-message edges = ~28
- Action tests: written (2 new files) but unrun. Target +25 → 125. File counts: 12 (conversations) + 11 (messages) = 23
- Cloud-smoke: 1 new file with 3 tests (anon GET on conversations / conversation_participants / messages). Target +3 → 12.
- TypeScript clean: `npx tsc --noEmit` exits clean
- Build clean: `npm run build` succeeded — /conversations 4.99 kB / 283 kB; /portal/conversations/[id] 519 B / 384 kB (markdown deps add ~40 kB First Load on detail page)
- 4 new ADRs (025-028); DEBT-016 resolved; 4 new debts logged (019, 020, 021, 022)
- Phase 1c is **in progress** — Session 10 (file uploads) + Session 11 (notifications + activity) remain

**State at Session 9 close (post-Phase F, ready to merge):**
- 13 commits on the `session-9-phase-1c-messaging-core` branch (off main at 06c0961). Three Phase F hotfixes added: `9fc485b` (sort comparator coercion), `3e650b4` (`formatRelative` widening), `6bba94b` (Resend verified-domain sender)
- Cloud Supabase: migrations 0014-0017 applied via `supabase db push --linked`. Anon-curl on the three new tables returns `42501 permission denied` (stricter than RLS — anon has no `GRANT SELECT` at the role layer, matching existing repo convention)
- RLS tests: **172/172** (was 147; +25)
- Action tests: **122/122** (was 100; +22)
- Cloud-smoke: **12/12** (was 9; +3 post-push)
- TypeScript clean: `npx tsc --noEmit` exits clean
- Build clean (unchanged from pre-merge state above)
- Phase F: 11 PASS / 1 FAIL deferred (DEBT-029) / 2 N/A (DEBT-031, group-msg solo-org limitation) / 1 SKIP (Step 1 pre-existing data) — see SESSION-9-HANDOVER.md for full breakdown
- 4 new ADRs (025-028); DEBT-016 resolved; 13 new debts logged (019-031). Pre-launch ops adds: 024, 025. Opportunistic adds: 022, 023, 026, 027, 028. Session 11 candidates: 029, 030, 031.
- Phase 1c is **in progress** — Session 10 (file uploads) + Session 11 (notifications + activity) remain

---

### §35.10 Session 10 (kickoff → ship: 10 May 2026)

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | **Thumbnail / PDF preview generation descoped at plan time (decision 10.3 revised, DEBT-032).** Original brief called for sync image thumbs <5MB + async PDF first-page preview. Library investigation surfaced three blockers: (a) `pdf-poppler` requires native libpoppler — won't link on Vercel serverless; (b) `pdfjs-dist` is pure-JS but ~5MB function bundle + slow per-page; (c) async pipeline (Cron / Inngest) is net-new infra. Lucide mimetype icons cover the file-list UX gap. `project_files.thumbnail_path` kept nullable so a future session can populate without migration. | Future session if customer feedback demands previews ("can't tell my drawings apart") OR opportunistically when an Inngest worker pipeline is added for notifications. | Open (DEBT-032) |
| 2 | **PostgREST/RLS interaction on stakeholder soft-delete via direct REST.** Setting `deleted_at` on a row makes it invisible to the SELECT policy's `deleted_at IS NULL` filter; PostgREST returns `42501 RLS violation` even when the UPDATE policy's USING + WITH CHECK both pass. Action layer uses Drizzle's pooler (postgres role, bypasses RLS) so soft-delete works in production. The stakeholder UPDATE policy still earns its keep — covers legitimate non-RLS-impacting metadata UPDATEs (e.g. future renames). Documented inline in 0018 + the RLS test. | Permanent rule: when authoring a stakeholder/uploader-self UPDATE policy whose USING references `deleted_at IS NULL` SELECT visibility, expect REST UPDATE to flip-flop. Always invoke soft-delete via Drizzle pooler (action layer), never a stakeholder REST UPDATE. | Permanent |
| 3 | **`createSignedUploadUrl` upload-URL TTL is hardcoded to 2 hours by `@supabase/storage-js` v2.105 (ADR-030).** SDK does not expose an `expiresIn` option for upload URLs; the spec §18 placeholder of 5 min was unreachable. Download URLs use the parameterised `createSignedUrl(path, 3600)` for 1-hour TTL. Reality wins; ADR-030 documents the resulting divergence from spec. | Permanent until Supabase exposes the option; revisit on Supabase storage-js major bump. | Open |
| 4 | **`messages.attachments` Zod widening deferred (DEBT-033, S9 inherited assumption #2).** S10 shipped the file primitive standalone; attaching a fileId into a message body was decoupled to keep S10 scope tight. `sendMessage` Zod still enforces `attachments: z.array(z.unknown()).max(0).default([])`. | Session 11 if notification dispatch needs file metadata in message payloads, OR opportunistic next conversation-UI polish. | Open (DEBT-033) |
| 5 | **Stakeholder routing UX — DEBT-034 logged from Phase F observation; superseded by DEBT-037 from post-merge production smoke test.** Phase F's "stakeholders with both `users` and `clients` rows route to `/dashboard`" framing was a benign UX observation. Production smoke test 10 May 2026 surfaced the actual root cause: signing in fresh as a stakeholder (only `clients` row, no `users` row) silently spawns a new organization and makes the user its owner. Confirmed end-to-end (sarhads@ → auto-spawned org → invited saliqueh@ as stakeholder; saliqueh@'s portal showed the auto-spawned project). **DEBT-037 is HIGH severity / HOTFIX BEFORE SESSION 11 STARTS.** Production also needs cleanup of any auto-spawned orgs from the smoke-test session. | **Hotfix before S11 kickoff.** Don't open the S11 kickoff brief until DEBT-037 is closed and production is cleaned up. | Open (DEBT-037 — HIGH; supersedes DEBT-034) |
| 6 | **`restoreFile` action shipped without a UI surface (DEBT-035).** Mirror of Phase 1b restore patterns (workflows + projects + stakeholders) keeps the action-layer contract complete. Phase F Step 13 marked N/A. Recycle-bin admin UI deferred. | Pre-launch operational pass OR sooner if any production user reports an accidental soft-delete. | Open (DEBT-035) |
| 7 | **DEBT-026 (`getAppUrl()` helper) priority bumped to Medium / Session 11 trigger.** Bit Phase F a second time (preview-deploy magic links pointed to production `NEXT_PUBLIC_APP_URL`, forcing manual host swap). Originally Low / opportunistic; cost grew with each preview-based QA cycle. Session 11 will introduce more URL-templating call sites (notification dispatch); the helper should land before or alongside that work. | Session 11. | Open (DEBT-026, bumped) |
| 8 | **Plans seed switched to upsert by (org_type_id, slug).** Previously additive-only INSERT; new `max_storage_bytes` / `max_upload_size_bytes` flags wouldn't propagate to environments where rows already existed. Upsert preserves existing row ids (FK-safe) while refreshing `name`/`price`/`feature_flags` on every run. Cloud re-seed at Session 10 close: 0 new, 8 refreshed — exactly as designed. | Permanent — future plan-shape changes propagate cleanly to cloud via `npm run db:seed`. | Permanent |
| 9 | **Storage RLS test surface uses Supabase storage API directly (`supabase.storage.from('org-files').upload(...)`)** — not REST table queries. New test file `tests/rls/storage-objects.test.ts` (8 cases) exercises the bucket auth path end-to-end via stakeholder + org-member JWTs. | Pattern noted; reuse for any future bucket-RLS tests. | Permanent |
| 10 | **Phase F (10 May 2026) — 11 PASS / 1 SKIP / 1 N/A / 0 FAIL.** Clean walk on PR preview, no in-flight hotfixes (contrast S9: 3 hotfixes during walk). Step 13 (admin restore via UI) marked N/A pending DEBT-035; Step 1 (empty state) marked SKIP because pre-existing test data couldn't be cleared. | Future sessions: continue strict PASS/FAIL/N/A/SKIP per DEBT-017. Phase F is the canonical pre-merge gate. | Permanent |
| 11 | **Production smoke test (post-merge, 10 May 2026) surfaced 4 follow-up items not visible during Phase F.** Phase F validated the file-upload primitive end-to-end on the PR preview. Smoke test on production caught: DEBT-036 (download opens new tab vs save), **DEBT-037 (stakeholder sign-in silently spawns org — HIGH; HOTFIX before S11)**, DEBT-038 (project-create form skips invitation email send), DEBT-039 (multi-file picker fails — only drag-drop multi-file works). Phase F runbook should be updated for S11+ to include explicit save-vs-open download check, fresh-stakeholder sign-in flow without pre-existing org membership, and multi-file picker as a separate step from drag-drop. | Phase F runbook expansion before S11. | Permanent (lessons) + DEBT-036/037/038/039 (open) |

**Full session handover:** `SESSION-10-HANDOVER.md` in repo root.

**State at Session 10 close (post-merge):**
- 8 commits on the `session-10-file-uploads` branch (off main at `49993e8`); squash-merged to main.
- Cloud Supabase: migrations 0018-0019 applied via `supabase db push --linked` mid-session. Plans re-seeded (8 refreshed, 0 new — `max_storage_bytes`/`max_upload_size_bytes` populated). Anon-curl on `project_files` returns 42501; `org-files` bucket private (anon `listBuckets` filtered).
- RLS tests: **192/192** (was 172; +20: 12 `project_files` + 8 storage)
- Action tests: **145/145** (was 122; +23 across 5 actions)
- Cloud-smoke: **14/14** (was 12; +2: `project_files` anon-blocked + bucket private)
- TypeScript clean: `npx tsc --noEmit` exits clean
- Build clean: `/dashboard/projects/[id]` 6.13 kB / 323 kB; `/portal/projects/[id]` 4.04 kB / 285 kB
- Phase F: **11 PASS / 1 SKIP / 1 N/A / 0 FAIL** — clean walk
- 2 new ADRs (029-030); 4 new DEBT entries (032-035); DEBT-026 bumped; DEBT-030 file portion resolved
- Phase 1c is **in progress** — Session 11 (notifications + activity) remains *(superseded by §35.11 — Phase 1c CLOSED 14 May 2026)*

---

## 35.HOTFIX-DEBT-037 — Post-S10 hotfix carryover

Between Sessions 10 and 11, a HIGH-severity production bug (DEBT-037) was hotfixed. External stakeholders signing in via the generic magic-link / password path were silently being made owners of brand-new organizations.

- **Pre-fix tag:** `pre-debt-037-hotfix` at `8ac9c0c`
- **Fix shipped:** PR #7, commit `0565777`, 10 May 2026
- **ADR:** ADR-031 (three locked invariants)
- **New code:** `lib/auth/postAuthResolve.ts` (`resolvePostAuthIdentity` + `pickDestination`); `db/queries/clients.ts` (`authEmailHasClient`); `tests/actions/auth-callback.test.ts` (9 regression tests across 3 §8 scenarios + intent guard + decision-tree unit tests); `scripts/cleanup-debt-037-orphan-orgs.ts` (reversible, dry-run default)
- **Modified code:** `app/auth/callback/route.ts` (post-PKCE identity resolve + route via pickDestination); `actions/auth.ts` (signIn through pickDestination; signUp default `next='/onboarding'`); `app/page.tsx` + `app/(org)/dashboard/page.tsx` (clients-row probe before /onboarding redirect); `actions/orgs.ts` (Zod `intent='wizard_signup'` literal + dual-context probe + audit metadata flag); `components/onboarding/CreateOrgForm.tsx` (passes intent)
- **Test counts:** RLS 192/192 unchanged; Actions 145 → 154 (+9); Cloud-smoke 14/14 unchanged
- **Phase F:** all 3 §8 identities verified via password sign-in walk on Vercel preview (DEBT-026 prevented natural magic-link path; substitution documented). DB assertions: stakeholder-only → /portal/projects + clients.auth_user_id backfilled + 0 orgs/users created + link audit row present; net-new owner → /onboarding → /dashboard + org/user/workflow + 5 stages + audit metadata correct + no dual_context flag; dual-context (Sarah Step 2) → /portal/projects then manual /onboarding then /dashboard + dual_context_signup=true audit + clients row preserved
- **Production cleanup:** dry-run identified 2 candidate orgs (PCD/sarhads@, Plan Daily/saliqueh@); both have activity → both protected by per-row pre-flight, manual product judgment required for each (no auto-cleanup possible). Audit trail: `docs/debt-037-investigation.md` + `scripts/debt-037-cleanup-candidates.json` (committed) + dry-run snapshot CSV (operational artifact, gitignored)
- **Follow-up DEBT:** DEBT-040 (link UX), DEBT-041 (`/select-context` page), DEBT-042 (functional index trigger)
- **SKILL impact:** Hard Rule 25 added (`pickDestination` centralization with "or its successor" hedge to protect intent against drift); changelog v3.4 → v3.5

## 35.MINI-DEBT-026 — Post-S10 mini-session carryover

Between the DEBT-037 hotfix and Session 11, a Medium-severity carry-over (DEBT-026) was closed: app-public URL construction was scattered across 5 server-side call sites, each reading `env.NEXT_PUBLIC_APP_URL` directly, which produced broken magic links on every Vercel preview deploy. The bug bit Phase F twice (Sessions 9 and 10) and forced a magic-link → password sign-in pivot during the DEBT-037 hotfix walk. Closed before Session 11 so notification emails ship onto a known-good URL plumbing layer.

- **Pre-fix tag:** `pre-debt-026-mini-session` at `d221142`
- **Fix shipped:** PR #9, commit `aa6899d`, 11 May 2026
- **ADR:** ADR-032 (three locked invariants: single helper, VERCEL_ENV-aware priority, `process.env` direct read for testability)
- **New code:** `lib/get-app-url.ts` (~30 LOC incl. JSDoc); `tests/actions/get-app-url.test.ts` (5 tests via `vi.stubEnv`)
- **Modified code:** `actions/auth.ts` (`callbackUrl` powering `signUp`/`sendMagicLink`/`sendPasswordReset`); `actions/users.ts:113` (team-invitation acceptUrl); `actions/stakeholders.ts:278` (stakeholder-invitation acceptUrl)
- **Test counts:** RLS 192/192 unchanged; Actions 154 → 159 (+5); Cloud-smoke 14/14 unchanged
- **Phase F:** magic-link walk on PR preview confirmed `redirect_to` query param points to preview domain (not localhost); user reported "the fix lands where it needs to"
- **Surprise surfaced (Phase F):** with `redirect_to` now correctly pointing at the preview, the magic-link click landed on the Vercel **per-deploy** URL (`pcd-saas-<hash>-…vercel.app`) — a different hostname from the branch alias (`pcd-saas-git-<branch>-…vercel.app`) where the user submitted the form. The PKCE `code_verifier` cookie is scoped to the form-submission hostname, so the callback opened with no cookie and PKCE verification failed. The DEBT-026 fix is correct; this is a latent Vercel per-deploy vs branch-alias cookie split that DEBT-026 exposed but did not cause. Registered as DEBT-043 for Session 11.
- **Follow-up DEBT:** DEBT-043 (PKCE cookie mismatch on preview magic-link walks — recommend folding into S11 kickoff alongside notification-email URL templating that will exercise the same path)
- **SKILL impact:** Hard Rule 26 added (all app-public URLs through `getAppUrl()`; direct `process.env.NEXT_PUBLIC_APP_URL` reads for URL construction forbidden outside the helper); changelog v3.5 → v3.6

### §35.11 Session 11 (kickoff → ship: 14 May 2026) — Phase 1c CLOSED

Session 11 was the architecturally densest session in Phase 1c: 3 new tables, dispatcher fan-out logic, 5 existing actions wired with notification + activity log writes, two preference matrix UIs, an inbox UI on each side, a server-rendered activity timeline on each project detail page, Realtime subscription with polling fallback, and bell-icon nav badges. The DEBT-043 PKCE fix shipped as a standalone PR (#11) before the main session work — so Phase F magic-link round-trips against the preview landed cleanly from the start.

| # | Item | Action | Pull-forward to |
|---|---|---|---|
| 1 | **Three new domain tables shipped as specified.** `notification_preferences` (XOR CHECK, two UNIQUEs, self-only RLS) + `notifications` (duck-typed recipient via `recipient_type` + `recipient_id`, no FK; SELECT + UPDATE self-only; INSERT and DELETE not granted to authenticated — dispatcher writes via pooler) + `project_activity` (project-scoped, per-row `visible_to_stakeholders` gate). Added to `supabase_realtime` publication: `notifications` (RLS + GRANT shape verified on cloud anon-block returns 42501). | Permanent. | Permanent |
| 2 | **ADR-033 post-commit dispatch pattern emerged from DEBT-049 mid-Phase-F.** Original Session 11 plan Hard Rule 6 ("dispatch is part of the same server-action transaction") didn't survive contact with Resend latency × 2-3 person test orgs — Vercel 504 Gateway Timeout on first `inviteStakeholder` walk. Hotfix moved dispatcher fan-out + outbound `sendEmail` calls OUT of every action transaction; DB-only writes (domain mutation + `logActivityTx` rows) stay inside. Per-recipient failures captured to Sentry with isolated try/catch, never roll back the action. Applied to all 5 wired actions (`sendMessage`, `moveProjectToStage`, `confirmUpload`, `inviteStakeholder`, `createMilestone`) in one pass. New SKILL Hard Rule 27 codifies the pattern for future I/O-emitting actions. | Permanent — future I/O-emitting actions follow Hard Rule 27 from day one. | Permanent (ADR-033, Hard Rule 27) |
| 3 | **Realtime delivery broken locally — polling fallback handles UX (DEBT-058 cross-ref DEBT-029).** `scripts/realtime-smoke-notifications.mjs` confirmed the same `subscribe()` → `CLOSED` failure that DEBT-029 documented for the `messages` channel. The `notifications` channel exhibits identical behavior. Cloud Phase F still showed delivery working within the 30s polling window even when Realtime didn't fire, so the inbox UX is acceptable — DEBT-029-class diagnosis deferred. The reproducer script lives in the repo for whoever picks it up. | Pre-launch operational pass OR sooner if Realtime is needed for a perf-sensitive feature (e.g. typing indicators). | Open (DEBT-058 — cross-ref DEBT-029) |
| 4 | **`listFilesForProject` pooler-bypass of `project_files` visibility RLS — RESOLVED 14 May 2026 via MINI-SESSION-DEBT-059 (DEBT-R006).** Phase 9 timeline wiring surfaced the bug shape in `db/queries/files.ts:listFilesForProject` — pre-existing from S10, claimed "RLS auto-filters" but went through the Drizzle pooler which bypasses RLS. Fix: required `visibleOnly: boolean` parameter mirroring `listProjectActivity`; conditional WHERE adds `eq(visibility, 'org_and_stakeholders')` when true. Stakeholder portal caller passes `true`; org caller passes `false`. Canonical pattern documented inline in §12.4. Audit covered all 13 `db/queries/*.ts` files (30 functions): 1 BUG (this), 2 YELLOW (`getConversationDetail` + `listMessagesForConversation` — different bug class, participation-gated rather than visibility-column; filed as DEBT-060 + DEBT-061), 27 SAFE. Decision 3 path (a) — single bug → no new SKILL Hard Rule, no new ADR; cross-ref between `listFilesForProject` and `listProjectActivity` is the canonical reference. | Resolved — commit `1a958dd` on branch `debt-059-stakeholder-files-filter`. Test deltas: Actions 198 → 200 (+2 regression cases); RLS 221/221, cloud-smoke 14/14, TypeScript clean; Phase F on Vercel preview verified end-to-end. | **Resolved** (DEBT-R006) |
| 5 | **Phase F UX polish bundle — shipped 15 May 2026 (DEBT-R007 through DEBT-R015).** Pre-launch readiness pass closing 9 entries: 7 Low-severity polish items (DEBT-036, 040, 050, 051, 052, 053, 054) + 2 Medium-severity bugs (DEBT-038 silent stakeholder attach on project-create; DEBT-039 multi-file picker dropping every file past the first). Branch `phase-f-ux-polish-bundle`, 9 per-DEBT commits + 1 docs close-out commit. Test deltas: tests/actions 200 → **214** (+14 across 4 new/updated test files: `derive-title` +7, `files` +1, `upload-helpers` +3, `projects` +3); RLS 221/221 unchanged; cloud-smoke 14/14 unchanged; TypeScript clean. Two non-obvious findings during implementation: (a) **DEBT-039's root cause** was the live-FileList mutation pattern (`input.value = ''` empties the FileList that `handleFiles` was iterating) — neither hypothesis ("missing `multiple`" / "click handler reads `[0]`") was correct; the fix snapshots to `Array.from` at both handler boundaries and extracts the iteration into a unit-testable pure helper. (b) **DEBT-038's fix** delegates `createProject`'s stakeholder attachment to `inviteStakeholder` post-commit, which flips `acceptedAt` semantics from `now()` (auto-accepted) to `null` (waiting on magic-link click). The org-side `listStakeholdersForProject` doesn't filter on `acceptedAt` so the dashboard UI is unchanged; the portal-side queries already required `acceptedAt IS NOT NULL` so the stakeholder must click the email link before the project appears in `/portal/projects` — consistent with how a normal invite from the project detail page worked. A new `stakeholderWarning: 'invite_failed'` field on `createProject`'s return surfaces post-commit invite failures to the form so the user can re-invite manually (project + stakeholder are no longer one tx). Phase F on Vercel preview: **9/9 PASS**. One new Open DEBT filed during Phase F (**DEBT-063** — invitation landing page doesn't disambiguate Sign up vs Sign in for first-time invitees; surfaced during DEBT-038 verification). DEBT-048 (new-feature scope: team-internal conversations), DEBT-055 (needs Sentry reproducer), and DEBT-057 remain Open per the kickoff's "out of scope" list. | Resolved — branch `phase-f-ux-polish-bundle`, tag `phase-f-polish-shipped`. Test deltas: Actions 200 → 214; RLS 221/221; cloud-smoke 14/14; TypeScript clean; Phase F 9/9 PASS. | **Resolved** (DEBT-R007 through R015) |
| 6 | **Decision-2 backfill override accepted: no historical `audit_logs` → `project_activity` migration.** Kickoff recommended (a) one-shot backfill; I pushed back on the basis that `actor_id` inference between `audit_logs.user_id`/`client_id` and `project_activity.actor_type`/`actor_id` is exactly the kind of correctness work that breaks silently. User accepted. Both timelines surface a fixed UI hint ("Activity timeline starts at Session 11 launch; earlier project history in the audit log" — portal drops the audit-log reference). | Permanent — Phase 1c's cutover-without-backfill is locked. | Permanent |
| 7 | **`message.new` NOT logged to `project_activity` per ADR-027 spirit + kickoff scope.** Per Decision 1 (option b): conversation events stay in `messages`; `project_activity` is the single source for non-conversation events. Stakeholder UX might want a "post to chat" affordance later but that's a UI concern, not a data-model change. | Future UX session if needed. | Permanent |
| 8 | **Activity-row writes stay inside the action transaction.** Even after ADR-033 moved dispatch out, the `logActivityTx` writes inside the tx — cheap DB-only operation, atomic-with-action is desirable. If the action committed, the timeline tells the truth. If dispatch later fails (caught and Sentry'd), the activity row still accurately records what happened. | Permanent — pattern for any future write that's "the canonical record of what happened". | Permanent |
| 9 | **Preferences seeding wired into 4 identity-creating entry points.** `createOrganization` (owner user) + `acceptInvitation` (new team member) + `findOrCreateClientTx` (new client — covers both `findOrCreateClient` and the `inviteStakeholder` flow) + `acceptStakeholderInvitation` (defensive — clients row may pre-date Session 11). 48 rows per identity (12 events × 4 channels), idempotent via `ON CONFLICT DO NOTHING`. | Permanent — adding a new event type to `NOTIFICATION_EVENT_TYPES` automatically seeds for new identities; existing identities get the new row on first preferences-page toggle (UPSERT path). | Permanent |
| 10 | **DEBT-049 cleanup script committed to repo (`scripts/cleanup-debt049-orphans.ts`).** Dry-run-by-default Supabase admin tool for deleting orphaned `auth.users` rows whose linked public-schema rows were rolled back by a tx-bounded dispatch failure. Refuses to delete if the auth user is currently linked to a `public.users` or `public.clients` row (defense against accidentally tombstoning a live identity). Already executed against cloud for `hasalique+s11stake@gmail.com` to unblock the Phase F re-walk. | Keep for future debugging; rename/extend as needed. | Permanent |
| 11 | **Phase F (post-DEBT-049-hotfix re-walk against PR #12) — 19/19 PASS.** Zero bugs found. The post-commit dispatch pattern holds across all 5 wired actions; the polling fallback handles inbox UX; the activity timeline gates visibility correctly on the portal side; preferences toggle persists; bell badge updates. 11 new DEBT entries logged (048, 050-059) — 7 from Phase F UX polish observations + 4 from in-session implementation observations. | Pre-launch UX polish session for DEBT-048 / 050-055 / 057. | Permanent + 11 open DEBT entries |
| 12 | **Test counts at session close:** RLS 192 → **221** (+29); Actions 159 → **198** (+39); Cloud-smoke 14 unchanged. The +39 actions span 6 new test files (`notification-defaults`, `notifications-dispatch`, `notifications-fanout`, `notifications-prefs`, `notifications-mark-read`, `activity-log`). No existing action test file needed adjustment for the DEBT-049 refactor — tests didn't assume tx-bounded dispatch, only that the side effects fire. | Permanent — pattern of "test the contract, not the implementation" paid dividends. | Permanent |
| 13 | **Cloud migrations 0020/0021/0022 pushed to Supabase mid-session.** `supabase db push --linked` applied all three cleanly. Anon REST returns 42501 on the new tables (RLS + no-anon-GRANT shape correct); `notifications` is in `supabase_realtime` publication alongside `messages`. Cloud was verified before the Phase F walk so the preview deploy had real tables to query. | Permanent — cloud reachable at v0.16. | Permanent |
| 14 | **Phase 1c is CLOSED.** All four Sessions (9 messaging, 10 files, 11 notifications + activity) shipped. Session 12 (Integration test + polish) folded into a future pre-launch integration pass; the Phase 1c exit criteria (200+ RLS, two-sided product end-to-end, no critical bugs from manual exploratory testing) are met. The MIGRATION-MAP test is descoped to a Phase 2 pre-launch task — independent of Phase 1c shape. | **Phase 2 (documents) is the next strategic decision-point.** Decide whether to do a pre-launch operational pass before Phase 2 starts. | Phase 2 kickoff |

**Full session handover:** Session 11 was a long bundled PR (#12) rather than a separate handover doc. The phase-by-phase commits document the build sequence: `b7e6d74` (schema) → `6ef3e9f` (RLS tests) → `9c8b967` (seed defaults) → `c5e3e43` (dispatcher core) → `4a77f34` (wire dispatch, originally tx-bounded) → `9e9e5ac` (activity log + prefs UI) → `a4b47b2` (inbox + Realtime + polling) → `0eb0a6b` (timeline UI) → `61510b1` (DEBT-049 hotfix moving dispatch post-commit) → (this commit: doc updates).

**State at Session 11 close (post-merge target):**
- 10 commits on the `session-11-notifications-activity` branch (off main at `6b17806`, which is PR #11 / DEBT-043 fix already in prod).
- Cloud Supabase: migrations 0020-0022 applied. New tables anon-blocked; `notifications` in `supabase_realtime` publication.
- RLS tests: **221/221** (was 192; +29 across 3 new test files).
- Action tests: **198/198** (was 159; +39 across 6 new test files).
- Cloud-smoke: **14/14** unchanged (per-table cloud-smoke for the 3 new tables descoped — Phase F verified the cloud reachability directly).
- TypeScript clean: `npx tsc --noEmit` exits clean.
- Phase F: **19/19 PASS** on PR #12 preview (post-DEBT-049-hotfix re-walk).
- 1 new ADR (033); 11 new DEBT entries (048, 050-059); DEBT-049 closed by hotfix commit.
- New surfaces in nav: 🔔 bell icon + count on both `(org)/layout.tsx` and `portal/layout.tsx`.
- New routes: `/notifications`, `/portal/notifications`, `/settings/notifications`, `/portal/settings/notifications`.
- New components: `NotificationPreferencesMatrix`, `InboxList`, `ActivityTimeline`.
- New hooks: `useNotifications` (Realtime + polling fallback).
- New helpers: `lib/notifications/{events,seed-defaults,subjects,dispatch}.ts`, `lib/email/templates/notification-generic.ts`, `lib/activity/{log,labels}.ts`.
- Phase 1c is **CLOSED**. Next strategic decision: Phase 2 (documents) vs. pre-launch operational pass.

**Open follow-up before Phase 2 kickoff:**
- ~~**MINI-SESSION-DEBT-059**~~ — **Shipped 14 May 2026** (DEBT-R006). Branch `debt-059-stakeholder-files-filter`, commits `19b3f3f` (kickoff doc) + `1a958dd` (fix + tests). Phase F verified on Vercel preview. Audit also surfaced **DEBT-060** + **DEBT-061** (different bug class — caller-enforced participation gates on `getConversationDetail` + `listMessagesForConversation`; recommend bundling into a future mini-session).
- ~~DEBT-048 / 050-055 are Phase F UX polish — bundle into a pre-launch UX pass.~~ — **Phase F UX polish bundle shipped 15 May 2026** (DEBT-R007 through R015; row 5 above). 9 entries closed (036, 038, 039, 040, 050, 051, 052, 053, 054); 2 from the original 050-055 range remain Open: **DEBT-048** (team-internal conversations — new feature, not polish) and **DEBT-055** (unread badge count inflation — needs Sentry reproducer). One new entry filed during Phase F: **DEBT-063** (invitation landing page Sign up vs Sign in disambiguation).
- DEBT-060 + DEBT-061 — participation-gate fixes for portal conversation queries (Medium severity, defense-in-depth, no live data leak today).

---

## 35.12 Phase 2 Session 12 Carryover

**Shipped 15 May 2026 — Phase 2 begins.** Quote lifecycle end-to-end on a new `documents` schema; one unified table discriminated by `type` (quote/invoice/receipt) ready for Sessions 13–14 to layer onto. Hard Rule 1 (schema-forever, additive only post-Phase-1c) holds: two new tables, no changes to Phase 1a/1b/1c rows / RLS / actions / tests.

### Build summary

| Layer | Delivered |
|---|---|
| Schema | Migrations 0023 (`documents`) + 0024 (`document_tokens`). Both RLS-enabled with four per-command policies (ADR-016). `documents.SELECT` gates on org-member OR `can_view_financials` stakeholder — the §14/§26-stub case made live. |
| Helpers | `lib/documents/vat.ts:calculateTotals` (integer-pennies math, round per-line then discount then VAT). `lib/documents/numbering.ts:allocateDocumentNumber` (project-scoped `SELECT FOR UPDATE` + count + `{projectNumber}-Q{seq}` format). |
| Server actions | `createQuote` / `updateQuoteDraft` / `sendQuote` (post-commit Resend client email per ADR-033) / `acceptQuote` (new token-authorized public-write pattern per ADR-034). |
| Read queries | `db/queries/documents.ts` — `listQuotesForProject({ visibleOnly })`, `getDocumentById`, `getDocumentByToken`. Mirrors DEBT-059 visibility-flag pattern. |
| Email | `lib/email/templates/quote-sent.ts` — plain HTML, GBP-formatted, modeled on `team-invitation.ts`. |
| Frontend (org) | `/dashboard/projects/[id]/quotes/new` (create form), `/dashboard/projects/[id]/quotes/[quoteId]` (view + draft-edit + send button), Quotes section on the project detail page. |
| Frontend (public) | `/q/[token]` — UUID gate → `publicDoc` rate-limit → token resolution → render quote + AcceptForm. Hard Rule 14 (token routes never auth-walled) holds via existing middleware `PUBLIC_PREFIXES`. |
| ADRs | **ADR-034** — Token-authorized public writes bypass `auth.uid()`; pooler is the security envelope. 9 locked invariants; alternatives + reconsider triggers documented. |
| Notification events | `quote.sent` + `quote.accepted` appended to `NOTIFICATION_EVENT_TYPES`. Used as activity event types this session; no `dispatchNotification` calls yet. Existing identities don't have notification_preferences rows for these — fine since dispatch is unwired, but a backfill migration will be needed if Session 13/14 wires notifications. |

### Test deltas

- **RLS:** 221 → **238** (+17). `tests/rls/documents.test.ts` (12) + `tests/rls/document-tokens.test.ts` (5).
- **Actions:** 214 → **245** (+31). `tests/actions/documents.test.ts` (17 covering createQuote/updateQuoteDraft/sendQuote/acceptQuote happy + edge paths including post-commit email failure isolation), `tests/actions/documents-vat.test.ts` (9 covering the rounding cascade + edge cases), `tests/actions/documents-numbering.test.ts` (5 covering serial + concurrent allocation via Promise.all asserting `b-a===1`, cross-project independence, cross-type independence, missing-project throw).
- **Cloud-smoke:** 14/14 unchanged.

### Notable decisions made in-session (not in scope doc)

1. **Document-number format** — `{projectNumber}-{TYPE_CHAR}{seq}` (e.g. `PRJ-2026-001-Q1`). Drops V2's `-INV-` infix since TYPE_CHAR (Q/I/R) alone disambiguates.
2. **`acceptQuote` activity-row identity** — `actor_type='client', actor_id=null`. Token-authorized writes don't bind to a specific clients row; `accepted_by_name` on the document is the durable identity record.
3. **Money math** — integer pennies internally, round at every step (per-line → discount → VAT), `.toFixed(2)` only at boundaries. Per kickoff guidance to ensure each displayed number is an exact 2dp value.
4. **`document_tokens.document_type` enum** — collapsed from §25's `('quote','invoice_initial','invoice_final','receipt_initial','receipt_final')` to `('quote','invoice','receipt')`. Per Phase 2 scope §2.5 (receipts are peer objects) and §2.4 (invoice initial/final is a `subtype` field on the document, not a token discriminator). Session 13 will add `invoice_subtype` additively.
5. **`/q/[token]` route was never stubbed in Phase 1a** despite §25 + §31 Session 4 listing it. The `publicDoc` rate limiter shipped but no consumer existed until this session. Session 12 lights up the actual route.

### What was deliberately deferred (not gaps)

- **Notification dispatch for `quote.accepted`** — kickoff scope mentioned it but session prompt only listed sendQuote's client email. Notification fan-out can be added in Session 13/14 alongside its own backfill migration for existing identities' notification_preferences. Activity-row logging is in place.
- **Invoice + receipt + payment objects** — Sessions 13–14. `documents` table is shaped for additive growth (new nullable columns: `invoice_subtype`, `payment_id`).
- **PDF generation** — still an open question per `phase-2-scope.md` §5 Q7. The frontend shows the quote in browser; PDF export decision deferred.
- **"Coming Soon" financials placeholder** — comes with the invoice/receipt sessions per scope §2.11.

### Open carryover

- **DEBT-064 (TBD)** — If a future session wires `dispatchNotification` for `quote.accepted` / `quote.sent`, an additive backfill migration must seed `notification_preferences` rows for existing identities (current per-identity seed runs only on identity create). Not a leak — `dispatchNotification` returns 0 inserts for unconfigured event types, so existing identities silently won't receive the new notification — but operationally surprising.

---

**Last reviewed:** 15 May 2026 (Phase 2 Session 12 shipped — v0.16 → v0.17; 1 new ADR (034); 2 new tables; 4 new actions; 1 new public route lit up; +48 tests; new label for DEBT-064 pending if dispatch is wired in S13/S14)

---

## 35.13 Phase 2 Session 13 Carryover

**Shipped 15 May 2026 — Phase 2 invoice + payment lifecycle.** One new domain table (`payments`), four additive columns on `documents`, a 6-event-type × 4-channel notification-prefs backfill that closes DEBT-064, and six new server actions (four invoice, two payment) on top of dispatch wiring for the two deferred Session 12 quote events. Schema-forever (Hard Rule 1) holds: nothing in Phase 1a/1b/1c was touched.

### Build summary

| Layer | Delivered |
|---|---|
| Schema | Migrations 0025 (`payments` + 4 per-command RLS), 0026 (additive cols on `documents`: `payment_id` FK, `invoice_subtype`, `revision_number`, `revision_log_payload`), 0027 (DEBT-064 backfill — idempotent INSERT … SELECT for 6 new event types × 4 channels across all existing users + clients). `payments.SELECT` mirrors `documents.SELECT` (the §14 financial-visibility gate). |
| Pure helpers | `lib/documents/payment-status.ts:derivePaymentStatus` (7-state ladder, accepted-quote-total invariant, 0.005 paid-in-full tolerance). `lib/documents/revise-diff.ts:diffInvoiceFields` (semantic comparator — line items struct-equal in order, numeric tolerance, NO JSON.stringify). |
| Notification vocab | `NOTIFICATION_EVENT_TYPES` += `invoice.sent`, `invoice.revised`, `payment.recorded`, `payment.corrected`. Matching entries in `lib/notifications/subjects.ts:NOTIFICATION_CONTENT`, `lib/activity/labels.ts:LABELS` + summary cases, `components/notifications/InboxList.tsx:EVENT_LABELS` + summary, `components/notifications/NotificationPreferencesMatrix.tsx:EVENT_LABELS`. All 4 exhaustive maps stayed compile-time-checked. |
| Server actions | `actions/documents.ts`: `createInvoice` (Q1 — final rejects `no_accepted_quote`), `updateInvoiceDraft` (same guard if switching to final), `sendInvoice` (mint token + direct Resend client email + post-commit dispatch fan-out), `reviseInvoice` (semantic diff + no-op rejection + revision log append). `sendQuote` + `acceptQuote` extended with post-commit dispatch fan-out (DEBT-064 wiring). `actions/payments.ts` (new): `recordPayment` (visibleToStakeholders=true, dispatch to org + financial stakeholders), `correctPayment` (visibleToStakeholders=false, dispatch ORG MEMBERS ONLY per Q2). |
| Read queries | `db/queries/documents.ts` += `listInvoicesForProject({ visibleOnly })`. `db/queries/payments.ts` (new) — `getPaymentsForProject({ visibleOnly })` (rows + runningTotal), `getProjectPaymentSnapshot(projectId)` (aggregates the four primitives + runs `derivePaymentStatus`). DocumentRow now carries `invoiceSubtype` / `revisionNumber` / `revisionLogPayload` / `paymentId` (defaulted for quote rows). |
| Email | `lib/email/templates/invoice-sent.ts` mirrors `quote-sent.ts` — GBP-formatted, subtype-aware body, `/i/[token]` link. |
| Frontend (org) | Project detail page now renders `<PaymentStatusBadge>` adjacent to `<ProjectStageBadge>` (two-axis status surfaced), plus new `<InvoicesSection>` + `<PaymentsSection>` cards. `/dashboard/projects/[id]/invoices/{new,[invoiceId]}` for create/edit/view/send/revise. `<RecordPaymentDialog>` + `<CorrectPaymentDialog>` (with mandatory reason field). |
| Frontend (public) | `/i/[token]` — UUID gate, `publicDoc` rate-limit, type discriminator. Read-only; no AcceptForm. Cross-type tokens 404 per ADR-034. Middleware allowlist already included `/i/` from S12. |

### Test deltas

- **RLS:** 238 → **251** (+13). `tests/rls/payments.test.ts` (13 tests: full cross-org + soft-delete + anon + cross-user `recorded_by` denial + stakeholder financial-visibility positive/negative + INSERT/UPDATE denial + `amount > 0` CHECK).
- **Actions:** 245 → **293** (+48):
  - `tests/actions/invoices.test.ts` (16): createInvoice initial-happy, final-without-accepted-quote → conflict, final-WITH-accepted-quote → happy, cross-org, validation_error cases, updateInvoiceDraft happy + non-draft + non-invoice, sendInvoice happy (token + dispatch + Resend) + non-draft + not-an-invoice + email-failure isolation, reviseInvoice happy + no-op rejection + non-sent rejection + validation + final-subtype-without-accepted-quote.
  - `tests/actions/payments.test.ts` (12): recordPayment happy + dispatch shape + running total + cross-org + validation + 2dp + isolation. correctPayment happy + no-op rejection + ORG-MEMBERS-ONLY dispatch shape + validation + not_found.
  - `tests/actions/debt-064-dispatch.test.ts` (2): sendQuote + acceptQuote each dispatch the correct event type to org + financial-visible stakeholders.
  - `tests/actions/payment-status.test.ts` (12): every state in the ladder + accepted-quote-total invariant + initial-invoice-deposit no-accepted-quote path.
  - `tests/actions/debt-064-backfill.test.ts` (3): precondition (no prefs), post-backfill (24 rows per identity with correct defaults), re-run idempotency.
- **Cloud-smoke:** 14/14 unchanged.

### Notable decisions made in-session (folded into the four-decision table at plan time)

1. **Q1 — invoice gate (hybrid).** `subtype='initial'` allowed without an accepted quote (deposit/mobilisation flow). `subtype='final'` requires one; reject with `{error:'conflict', reason:'no_accepted_quote'}`. Mirrors V2 practice; surveyors take deposits before formal acceptance.
2. **Q2 — correctPayment dispatch.** Org members only. Not a half-wired event — `payment.corrected` is fully in the vocab and all four exhaustive maps; only the recipient fan-out at the call site narrows.
3. **Q3 — payment activity visibility.** `payment.recorded` → `visibleToStakeholders=true` (the money arriving is part of the project narrative the client cares about); `payment.corrected` → `false` (administrative).
4. **Q4 — revision_log entry shape.** `{ rev, previous_amount, new_amount, fields_changed: string[], reason, revised_at, revised_by }`. `fields_changed` is auto-derived via a **semantic diff** — `diffInvoiceFields` compares line items per-position as structs (trim-equal strings, 2dp-tolerance numerics) so a no-op resave registers 0 fields and the action rejects with `{error:'conflict', reason:'no_changes'}`. No false positives from JSONB key-order or numeric-stringification drift.

### What was deliberately deferred (not gaps)

- **Receipts + `/r/[token]`** — Session 14. `documents.payment_id` FK lands now to keep the schema migration count low; receipt rows populate it next session.
- **PDF generation** — Session 14 (`@react-pdf/renderer`, stored as `project_files` `source='document_artifact'`).
- **"Coming Soon" financials placeholder on the org project detail page** — Session 14 per scope §2.11.
- **Refund modelling** — out of scope; DEBT-065 filed for the gap (payments.amount > 0 CHECK precludes negative rows; clean modelling needs a separate `payment_refunds` table).
- **`invoice.revised` notification dispatch fan-out** — wired only as an activity event this session. The exhaustive maps + event-type vocab are ready; future UX session can opt in to a per-org "notify clients on revision" toggle without re-touching this file.
- **Portal-side payment surface** — `getPaymentsForProject({ visibleOnly: true })` short-circuits to `[]` (mirrors DEBT-059 pattern). Session 14+ will wire a portal-side view that passes a stakeholder identity through.

### Open carryover

- **DEBT-065** (new — Low) — Refunds not modelled. `payments.amount > 0` CHECK is a deliberate design decision; refunds would need a separate `payment_refunds` shape or a `refund_for_payment_id` self-FK with an inverted-amount convention. No customer impact yet — surveyor practice handles a refund as an org-internal bank entry, not a portal action. Filed for visibility.
- **DEBT-064** — CLOSED 15 May 2026 by migration 0027 + the dispatch wiring on `sendQuote` / `acceptQuote` / `sendInvoice` / `recordPayment` / `correctPayment`. Verified by `tests/actions/debt-064-backfill.test.ts` (idempotent re-run) and `tests/actions/debt-064-dispatch.test.ts` (recipient fan-out shape).

---

**Last reviewed:** 15 May 2026 (Phase 2 Session 13 shipped — v0.17 → v0.18; 0 new ADRs (composes ADR-033 + ADR-034); 1 new table (`payments`); 4 additive columns on `documents`; 6 new server actions; 1 new public route lit up (`/i/[token]`); +61 tests; DEBT-064 closed; DEBT-065 filed).

---

## 35.14 Phase 2 Session 14 Carryover — Phase 2 CLOSED

**Shipped 15 May 2026 — Phase 2 ends here.** Receipts as first-class `documents` rows linked to payments, server-side PDF generation for all three document types via `@react-pdf/renderer`, the `/r/[token]` public route, the portal-side financial visibility surface (was a S13 short-circuit), the org-side "Coming Soon" Profitability card, and an end-to-end polish pass. Schema-forever (Hard Rule 1) holds — additive only: two nullable columns on existing tables, no new tables, no changes to Sessions 12–13 columns / actions / RLS / tests.

### Build summary

| Layer | Delivered |
|---|---|
| Schema | Migration 0028 — two additive nullable columns: `documents.recipient_name` (receipt-only "addressed to") + `project_files.source_document_id` FK (cached PDF lookup) with partial index `WHERE deleted_at IS NULL AND source_document_id IS NOT NULL`. No RLS changes — both columns ride existing policies. |
| PDF subsystem | `@react-pdf/renderer` v4 added. `lib/pdf/document-template.tsx` (one parameterised template, type-aware via conditional renders) + `lib/pdf/render.ts` (renderToBuffer wrapper) + `lib/pdf/cache.ts` (leaf module — `invalidateDocumentPdfCache`, decoupled from the JSX import chain so action callers don't pull the renderer transitively). |
| Server actions | `actions/document-pdf.ts` (new): `generateDocumentPdf` (org-side) + `generateDocumentPdfFromToken` (public, ADR-034 envelope) + `invalidateDocumentPdfCache` re-export. `actions/payments.ts:recordPayment` now mints the receipt + token in the same tx as the payments row + activity rows for both `payment.recorded` and `receipt.generated`. `actions/payments.ts:correctPayment` now updates the linked receipt's `subtotal/total/lineItems` in the same tx + invalidates cached PDF post-commit. `actions/documents.ts:reviseReceipt` (new) — recipient-only revise with the standard revision-log mechanism. `actions/documents.ts:reviseInvoice` extended with post-commit PDF cache invalidation. |
| Read queries | `db/queries/documents.ts` — `listReceiptsForProject` (new); `listQuotesForProject` / `listInvoicesForProject` / `listReceiptsForProject` share a `listDocumentsByType` helper with the real `visibleOnly: true` defense-in-depth branch via `hasStakeholderFinancialAccess` (mirrors the SECURITY DEFINER `auth_user_stakeholder_project_visibility`). `db/queries/payments.ts:getPaymentsForProject` same shape. PaymentRow gains `receiptId/Number` via LEFT JOIN on `documents.payment_id`. DocumentRow gains `recipientName`. |
| Notification vocab | `NOTIFICATION_EVENT_TYPES` += `receipt.generated`, `receipt.revised`. Both wired into all 4 exhaustive maps (`subjects.ts`, `lib/activity/labels.ts`, `InboxList.tsx`, `NotificationPreferencesMatrix.tsx`). Neither has dispatch fan-out (recipients overlap with `payment.recorded` for `generated`; `revised` is org-internal). |
| Frontend (org) | `/dashboard/projects/[projectId]/receipts/[receiptId]` — receipt detail page with revise-recipient + Download PDF + linked-payment card (bidirectional UI link). `components/receipts/{ReceiptsSection,ReviseReceiptDialog}.tsx`. `components/projects/ProfitabilityComingSoon.tsx`. `components/pdf/DownloadPdfButton.tsx`. Section components extended with `viewer: 'org' \| 'stakeholder'` prop + `stakeholderAuthUserId?` for portal use. |
| Frontend (public) | `/r/[token]` — read-only receipt view, mirrors `/i/[token]` shape: UUID gate, publicDoc rate-limit, cross-type 404. PAID badge, recipient (when set), single-line totals, Download PDF. Download PDF added to `/q/[token]` and `/i/[token]` too. |
| Frontend (portal) | `/portal/projects/[projectId]` — replaced the "Coming in Phase 2" placeholder card with real `<QuotesSection / InvoicesSection / PaymentsSection / ReceiptsSection viewer="stakeholder" />` rendered when `view.flags.canViewFinancials === true`. Stakeholder mode hides write affordances; queries enforce defense-in-depth via `stakeholderAuthUserId`. |

### Test deltas

- **RLS:** 251 → **254** (+3). `tests/rls/documents.test.ts` extended with receipt-type cross-org isolation + anon SELECT block + `recipient_name` fetchability.
- **Actions:** 293 → **321** (+28):
  - `tests/actions/receipts.test.ts` — receipt auto-creation invariant (one-per-payment, payment_id linked, document_number allocated, recipient_name snapshot, token minted), `correctPayment` keeps linked receipt total in lockstep, `reviseReceipt` happy + no-op + cross-type + cross-org, validation errors.
  - `tests/actions/document-pdf.test.ts` — `generateDocumentPdf` produces correct project_files row, second call returns cached row (idempotent), cross-org rejection, `generateDocumentPdfFromToken` finds-or-creates by token, `invalidateDocumentPdfCache` + `reviseReceipt` soft-delete cached PDF (next call regenerates).
  - `tests/actions/portal-financial-visibility.test.ts` — `hasStakeholderFinancialAccess` true/false matrix (financial / progress-only / cross-org); `listInvoicesForProject` / `listReceiptsForProject` / `getPaymentsForProject` each return real rows for financial-stakeholders and []/0 otherwise.
- **Cloud-smoke:** 14/14 unchanged.

### Notable decisions made in-session (not in scope doc)

1. **Receipt creation model = inside `recordPayment`'s tx** (Plan Q1). One payment, one receipt, atomic. No separate `createReceipt` action — that would invite invariant-violating receipts.
2. **Receipt-payment consistency = snapshot kept in lockstep** (Plan Q2). At creation, receipt's `subtotal/total = payment.amount`. At correction, the same tx updates both rows. Receipt PDF/page renders straight from the documents row with no JOIN.
3. **PDF template structure = one parameterised template** (Plan Q3). Per-type variation is conditional inside the template (Quote acceptance block; Invoice subtype + revision badge; Receipt PAID + recipient).
4. **Migration scope = two additive nullable columns** (Plan Q4). `documents.recipient_name` for receipt revisability + `project_files.source_document_id` FK for cached PDF lookup. Reasoning surfaced in plan (alternatives = column-name overload OR storage-path scan; both worse).
5. **`receipt.generated` activity event added** to the timeline alongside `payment.recorded` (the receipt is a distinct first-class artifact). **No notification dispatch** — recipients overlap with `payment.recorded` and a second fan-out would be spam.
6. **Receipt PDF visibility = `'org_only'`.** PDFs are sharable via the document_tokens link; they shouldn't appear in the stakeholder file list (where they'd confuse — these aren't drawings).
7. **PDF cache invalidation = soft-delete, post-commit, best-effort.** `reviseInvoice` / `reviseReceipt` / `correctPayment` invalidate. The next `generateDocumentPdf` regenerates from the post-mutation state. Storage object stays for the retention worker.
8. **Vitest JSX handling.** Vitest 4 uses oxc and doesn't auto-transform JSX. Solved by isolating `invalidateDocumentPdfCache` into a leaf `lib/pdf/cache.ts` (no @react-pdf imports) so action modules don't pull the JSX template through their import graph. Cleaner than configuring oxc.
9. **Portal financial-visibility wiring.** The `visibleOnly: true` branch now does real defense-in-depth via `hasStakeholderFinancialAccess` (a query helper that mirrors the SECURITY DEFINER gate). Stakeholder callers see drafts/void rows filtered out (`sentAt IS NOT NULL`) — drafts are org-internal compose state.
10. **Bidirectional payment↔receipt UI link.** PaymentRow gains `receiptId/Number` via LEFT JOIN on `documents.payment_id`. PaymentsSection rows render R{n} as a link to the org-side receipt detail page; receipt detail page shows a "Linked payment" card. The user reads either side without hunting.

### What was deliberately deferred (not gaps)

- **Portal-side detail pages for invoices / receipts.** Stakeholders see lists in the section cards; clicking a row in a stakeholder's portal goes nowhere. The public `/i/` and `/r/` token-gated pages are the existing detail surface; the portal section's Download PDF affordance is enough for now. A future UX session could add `/portal/projects/[id]/invoices/[id]` etc.
- **Stakeholder PDF download from portal sections.** The portal sections show read-only lists; they don't expose a per-row Download PDF. Stakeholders downloading a PDF go via the public `/i/[token]` or `/r/[token]` page (which has the button). Adding portal-side per-row download would require either a new token-context or an authenticated download surface — out of scope.
- **Refund modelling.** DEBT-065 (S13) still open. `payments.amount > 0` CHECK precludes negative rows; refunds need a separate shape. No customer impact yet.
- **PDF rendering of the revision history.** The receipt PDF doesn't include the recipient revision log; the revise log lives on the org-side detail page only. Future polish.

### Open carryover

- ~~**Phase 3 strategy decision.**~~ **Resolved 16 May 2026** — see §35.DECISION-PHASE-3-RENUMBER. Original Phase 3 framing collapsed (portal shipped early via 1b/1c/2); renumbered 4→3 (Architect lifecycle), 5→4 (Native kanban + upsells), 6→5 (Stripe + polish); pre-launch UX polish sprint scoped separately, not a numbered phase.
- **Hasnath's existing 10 projects migration** (descoped from Phase 1c — see §35.11 row 14 / Phase 1c exit criteria). Independent of Phase 2 shape; can run any time before launch.
- **DEBT-066** is the next free debt id. Session 14 filed no new DEBT entries — every deferred item above is captured here in the carryover or already has an existing ID.

### Phase F walk findings + fixes

Phase F walk on Session 14 surfaced three findings — two fixed on this branch before merge, one filed as DEBT-066 for follow-up.

**Fix 1 — `revalidatePath` literal-path + 'layout' is unreliable in Next.js 15.** `recordPayment` and `reviseInvoice` weren't refreshing the project detail page on commit (user records a payment, sees £0 until reload; revising an invoice doesn't refresh the project page's invoice list/total). `correctPayment` and `reviseReceipt` happened to work — same source pattern, but `router.refresh()` alone was sufficient because they patched existing DOM rows the cached render already had. The new-row-required flows (record payment, revise invoice) need actual route-cache invalidation, which `revalidatePath(literalPath, 'layout')` does NOT reliably trigger. **Permanent rule:** Next.js 15 `revalidatePath` is unreliable with literal-path + 'layout'; canonical form is dynamic-segment `[projectId]` with 'layout'. Normalize at every call site. Future actions that revalidate project routes must use the dynamic-segment pattern from day one — `revalidatePath('/dashboard/projects/[projectId]', 'layout')`, not `revalidatePath(\`/dashboard/projects/${projectId}\`, 'layout')`. Resolved: 14 callsites in `actions/payments.ts` + `actions/documents.ts` normalized in commit `632fd3d`.

**Fix 2 — Generated PDFs leaked into the org-side Files list.** `visibility='org_only'` on the cached `project_files` row was insufficient — `org_only` only hides from stakeholders, not org members. Per Plan decision 6, PDF artifacts (quote/invoice/receipt) are sharable via `document_tokens`, not via the file list. Resolved: `db/queries/files.ts:listFilesForProject` now ALWAYS excludes `source='document_artifact'` rows on both `visibleOnly` branches. The single-file `getDownloadUrl` and the find-or-create `generateDocumentPdf` flows are unaffected (both look up by id, not via list). Commit `131c7b5`.

**DEBT-066 (filed, not fixed) — Activity timeline leaks financial event text to non-financial stakeholders.** Section cards correctly hide on `/portal/projects/[id]` when `can_view_financials=false`, but the Activity Timeline still surfaces "received £400.00, R1" / "invoice issued" etc. The per-row `visible_to_stakeholders` boolean (write-time decision) doesn't model "is this stakeholder-relevant *for this stakeholder profile*?". Medium severity, mild leak (no line items, no PDF access). Trigger: before Phase 3 client-portal polish, or when a customer notices. Fix sketch: `FINANCIAL_EVENT_TYPES` set + read-time filter in `listProjectActivity` for stakeholder callers without `can_view_financials`. Filed in DEBT-LOG.md commit `b5e043b`.

Tests stayed green throughout (RLS 254, Actions 321, cloud-smoke 14, tsc clean, drizzle-kit clean, build clean) — Phase F walk was the validation; no new tests were added.

### Phase 2 close-out

Phase 2 shipped over three sequential sessions (S12 / S13 / S14) on 15 May 2026, on time per the kickoff plan. Final state:

- **Schema:** 6 migrations (0023–0028). 3 new tables (`documents`, `document_tokens`, `payments`); 6 additive columns on `documents` (4 in S13, 1 in S14, plus `payment_id` already in S13's column pack); 1 additive column on `project_files` (S14). 0 changes to Phase 1a/1b/1c rows.
- **RLS:** 4 per-command policies on each new table (12 new policies); 0 changes to Phase 1a/1b/1c policies. Stakeholder financial-visibility gate (`can_view_financials`) propagated through `documents` SELECT + `payments` SELECT + the `hasStakeholderFinancialAccess` query-layer helper.
- **Server actions:** 11 new (`createQuote`, `updateQuoteDraft`, `sendQuote`, `acceptQuote`, `createInvoice`, `updateInvoiceDraft`, `sendInvoice`, `reviseInvoice`, `recordPayment`, `correctPayment`, `reviseReceipt`) + 2 PDF (`generateDocumentPdf`, `generateDocumentPdfFromToken`).
- **Public routes:** 3 (`/q/[token]`, `/i/[token]`, `/r/[token]`).
- **ADRs:** 1 new (ADR-034, token-authorized public writes — S12). PDF subsystem composes ADR-033 + ADR-034 without a new pattern.
- **Tests:** RLS 221 → 254 (+33); Actions 198 → 321 (+123); cloud-smoke 14 unchanged.
- **DEBT entries:** DEBT-064 closed (S13). DEBT-065 filed (refund modelling — Low). 0 net new debts in S14.
- **Phase tracker:** 1 + 2 → ✓ Complete.

Pre-launch operational items (not Phase-bound): retention worker schedule, data-export format, Resend production domain verification, Upstash Redis production split, the migration of Hasnath's existing 10 projects. (The Phase 3 scope decision item is resolved — see §35.DECISION-PHASE-3-RENUMBER below.)

---

**Last reviewed:** 15 May 2026 (Phase 2 Session 14 shipped — v0.18 → v0.19; **Phase 2 CLOSED**; 0 new ADRs; 0 new tables; 2 additive columns (1 on `documents`, 1 on `project_files`); 3 new server actions (`reviseReceipt` + 2 PDF); 1 new public route lit up (`/r/[token]`); 5 new components; 1 new lib subsystem (`lib/pdf/`); +31 tests). **Phase F walk fixes (post-shipped):** `revalidatePath` normalized to dynamic-segment pattern across 14 callsites (Fix 1, commit `632fd3d`); `listFilesForProject` excludes `document_artifact` rows (Fix 2, commit `131c7b5`); DEBT-066 filed for the activity-timeline financial leak (commit `b5e043b`). Tests stayed green.

---

## 35.DECISION-PHASE-3-RENUMBER — Phase 3 strategy resolved (16 May 2026)

Between Phase 2 close and what was originally "Phase 3 kickoff," the Phase 3 strategy carryover from §35.14 was resolved. The original framing — *Phase 3 = Client portal (stakeholder-facing UI)* — was hollow: `/portal/*` already substantially exists. Phase 1b shipped the basics; Phase 1c added messages + files + notifications + activity; Session 14 added the financial sections gated on `can_view_financials`. The flag was raised in `phase-2-scope.md` §6 and the §35.6 Session 6 carryover; this entry closes it.

**Decision:** Collapse the original Phase 3 framing. Renumber:

| Old | New | Description |
|---|---|---|
| Phase 4 | **Phase 3** | Architect lifecycle (RIBA stages, drawing packages) |
| Phase 5 | **Phase 4** | Native kanban, public docs, upsells |
| Phase 6 | **Phase 5** | Stripe billing, plan switching, polish |

**Pre-launch UX polish sprint scoped separately** — not a numbered phase, runs between Phase 2 close and the new Phase 3 kickoff. Phases are product-shaped bodies of work; polish doesn't anchor a phase. Sprint scope candidates:

- **Genuinely-missing portal functionality** from §35.14 deferrals: portal-side invoice / receipt detail pages (clicking a row in the portal's section cards currently goes nowhere — public `/i/[token]` and `/r/[token]` are the only detail surface); in-portal authenticated PDF download (currently only via public token pages).
- **Open DEBTs with pre-launch or polish triggers:** DEBT-066 (activity-timeline financial leak — flagged in §35.14 specifically with trigger "before Phase 3 client-portal polish"); DEBT-063 (invitation landing UX for first-time invitees); DEBT-031 + DEBT-055 (badge UX); DEBT-029 + DEBT-058 (Realtime not auto-updating); DEBT-035 (file restore UI); DEBT-041 (`/select-context` for dual-context users); DEBT-048 (team-internal conversations UI).
- **Defense-in-depth:** DEBT-060 + DEBT-061 (pooler-bypass on portal conversation queries — caller-enforced participation gates).
- **First-pass UX work not in DEBT:** mobile responsive sweep (stakeholders skew mobile-heavy), empty states for 0-project / 0-message stakeholders, stakeholder settings/profile surface (the org has `/settings`; the portal currently has no equivalent), copy/comms pass on empty states + error toasts + emails.

**Pre-launch operational items remain non-phase-bound** (carried from §35.14 close-out): retention worker schedule, data-export format, Resend production domain verification, Upstash Redis production split, migration of Hasnath's existing 10 projects. Polish-sprint candidates by adjacency, but separate scope from UX polish itself.

**Schema-frozen across the polish sprint** (Hard Rule 1 holds): additive-only or zero-schema. A polish task that wants a new column is a signal it's not polish — escalate to a feature scope discussion.

**Cleanup landed in the same edit:**

- §6 Project Layout: replaced the stale `(client)/` route group reference (never existed in the codebase — portal shipped at `app/portal/*`) with the real `portal/` entry; comment updated to reflect Phase 1b → 1c → 2 surface area.
- All textual `Phase N` references throughout the doc renumbered to match the new tracker (§2 stack table, §6 project layout comments, §10 / §13 / §15 / §16 / §17 / §18 / §19 / §24 phase callouts, §31 deferred items, §34 deferred decisions table, §35 carryover phase-pulls).
- One special case at §19: the realtime presence channel note was rephrased from `(Phase 3+)` (which had meant "after client portal launch") to `(Post-launch+ — after polish sprint, if requested)` to preserve the original semantic anchor, which now lives post-polish-sprint rather than in any numbered phase.
- Parallel rephrasing at §34 row "Realtime presence indicator": `Decide by = Phase 3 mid` → `Post-launch — after polish sprint`; trigger `After client portal launch, if requested by users` → `If requested by users post-launch`. Same dead-anchor logic as §19; the row's semantic anchor moves out of the numbered tracker.

**No ADR filed.** This is a roadmap-shape decision, not an architectural pattern. ADRs 031–034 are technical pattern locks; the Phase 3 renumber doesn't fit that category. Future Claude can reference §35.DECISION-PHASE-3-RENUMBER directly.

**No DEBT entries filed.** Every implication is either resolved (the decision itself) or already tracked under existing DEBT IDs (the polish-sprint inventory above).

**Follow-up before pre-launch sprint kickoff:**

- Draft `pre-launch-sprint-scope.md` modelled on `phase-2-scope.md` (locked decisions, deferred items, session-count estimate).
- Audit `DEBT-LOG.md` for trigger-string drift: triggers referencing "Phase 3 client-portal polish" should be reworded to "pre-launch UX polish sprint" (DEBT-066 is the explicit known case; sweep for others).

---

## End of document


**Next review:** Pre-launch UX polish sprint scope doc (per §35.DECISION-PHASE-3-RENUMBER), and/or kickoff of the new Phase 3 (Architect lifecycle). Schema sections frozen — additive-only thereafter (Hard Rule 1).

