# Phase 2 Kickoff — Surveyor Lifecycle (Quote / Invoice / Receipt)

**Status:** Kickoff complete — schema, seams, status model, PDF approach, and session breakdown all locked. Ready for Session 12.
**Date:** 15 May 2026
**Inputs:** `phase-2-scope.md` (locked boundary + feature list), V2 `Code.gs` (behaviour being ported), V1 `index.html` (revise-quote/revise-invoice reference), `ARCHITECTURE-saas.md` (source of truth for all SaaS work).
**Skill state:** `pcd-portal-dev` skill is at v3.0 — references split (`ARCHITECTURE-saas.md` active, Apps Script `ARCHITECTURE.md` frozen), patterns and hard rules re-pointed at the SaaS stack.

> This doc turns the locked scope into a session-by-session build plan. It does **not** restate the scope — read `phase-2-scope.md` for the boundary. Every "why" here was settled in the kickoff conversation; this is the decision record plus the build sequence.

---

## 1. Locked decisions

- **One `documents` table discriminated by `type`** (`quote` / `invoice` / `receipt`). Quote, invoice, and receipt are peer objects hanging off `project_id` — not a hard FK chain.
- **Line items live in a `jsonb` column** on `documents`, not a separate table. Ports V2's proven `scope_data.items[]` shape. Each item keeps its `category` — that is part of the financial-model seam (§3).
- **Payments are a `payments` table.** Each `recordPayment` is a row; the running total is a `SUM`. Payment target = the **accepted quote's `total`** (not the sum of invoice amounts — invoices are independent slices).
- **Receipts are one-per-payment**, first-class document objects, each with its own token-gated page, PDF, and email.
- **Recorded payment amounts are correctable** — a `payments`-row correction re-renders the linked receipt and recomputes the running total and the derived status. (Covers the "bill the full amount, not the remaining balance" case.)
- **No forced invoice ordering.** A `final` invoice can exist with no `initial`. V2 already behaves this way — Phase 2 simply adds no constraint.
- **Invoice (and receipt) revisability = mutable row + revision log**, ported from V1's `reviseQuote`/`reviseInvoice`. Revise edits recipient/contact fields **and** amount/financial fields; the revision log captures the `previousAmount → newAmount` delta.
- **Status is two orthogonal axes** (§4): the workflow stage (already built) and a new *derived payment-status axis*. V2's conflated 14-row label is **not** ported as-is.
- **VAT** is a per-org toggle (`org_settings`) with a per-document `vat_applicable` override; `calculateTotals` logic (20% on the discounted subtotal) ports directly.
- **PDF generation** = `@react-pdf/renderer`, server-side, output stored as a `project_files` row with `source='document_artifact'` (that enum value already exists — §12.4).
- **Document numbering** = project-scoped sequence, allocated via `SELECT … FOR UPDATE` on the project row inside the action transaction (the Postgres equivalent of V2's `LockService`).
- **Document events log to `project_activity` and fire notifications**, via the post-commit dispatch pattern (ADR-033 / Hard Rule 27).
- **"Coming Soon" financials placeholder** lives on the org-side project detail page (`/dashboard/projects/[id]`), never on `/portal`.

---

## 2. Schema design

All Phase 2 schema is **additive only** — Phase 1c is closed (ADR-007 / Hard Rule 1). New tables and new nullable columns only; no drops, renames, or type narrowing.

### 2.1 `documents` (Session 12)

```sql
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('quote','invoice','receipt')),
  subtype text CHECK (subtype IN ('initial','final')),     -- invoice only; null for quote/receipt. No CHECK forces initial-before-final.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','superseded','void')), -- acceptance is accepted_at, not a status value
  line_items_payload jsonb NOT NULL DEFAULT '[]',           -- [{desc, qty, unit_price, category}, ...]
  subtotal numeric(12,2),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  vat_applicable boolean NOT NULL DEFAULT true,
  vat_amount numeric(12,2),
  total numeric(12,2),
  document_number text NOT NULL,                            -- e.g. PCD2026-101-Q01
  sequence int NOT NULL,                                    -- project-scoped, per type/subtype
  accepted_at timestamptz,                                  -- quote only; acceptance = NOT NULL
  accepted_by_name text,
  revision_number int NOT NULL DEFAULT 0,
  revision_log_payload jsonb NOT NULL DEFAULT '[]',         -- [{rev, previous_amount, new_amount, fields_changed, revised_at, revised_by}]
  sent_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

`payment_id` (nullable FK to `payments`, receipt-only) is **added in Session 13** as an additive column — receipts aren't built until Session 14, so the column lands with the `payments` table rather than being deferred.

**RLS:** four per-command policies (ADR-016). The SELECT policy gates stakeholder visibility on `can_view_financials` — this is the exact case the §26 RLS test stub anticipates (`documents` with an `amount`/`total` field, `progress_only` stakeholder sees `[]`). Org members see all their org's documents; stakeholders see a project's documents only when `can_view_financials = true`.

### 2.2 `document_tokens` (Session 12)

Build the §25 sketch, **with one correction**: drop the `receipt_initial`/`receipt_final` split — receipts are per-payment, not 2-slot. The token table's `document_type` simplifies to `'quote' | 'invoice' | 'receipt'`; the `documents` row carries the subtype. Token = random UUID v4, missing/invalid token = 404 (SaaS rule, §25).

### 2.3 `payments` (Session 13)

```sql
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correction_log_payload jsonb NOT NULL DEFAULT '[]',  -- UI-visible correction history; audit_logs is the system-of-record
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

Amounts are correctable: a correction mutates `amount`, appends to `correction_log_payload`, and writes an `audit_logs` row (Hard Rule 4). Session 13 also adds `documents.payment_id uuid REFERENCES payments(id)` (nullable, receipt-only).

### 2.4 Line items, numbering, linkage

- **Line items** — `jsonb` array on the document. Never queried outside the document detail view (V2 confirmed this). Each item: `{desc, qty, unit_price, category}`.
- **Numbering** — project-scoped sequence. Inside the create-document server action, `SELECT … FOR UPDATE` the project row, count existing documents of that type/subtype, allocate `sequence + 1`, format `document_number`. Race-safe without a counter table.
- **Linkage** — peers off `project_id`. The quote's `accepted_at` is the precondition the *surveyor* acts on; invoices are generated independently (V2 does not auto-generate from acceptance). A post-acceptance quote change produces a **superseding quote** (`status='superseded'` on the old, new row accepted) — that is the mechanism for the rare "project total changed" case.

---

## 3. The financial-model seam (hard requirement, scope §3.1)

The deferred model — 9 income categories, expenses, profit, people/payroll, AW snapshot — ships later as a **new additive table** (`project_financials` or similar). "Bolts on with no migration" is satisfied by three invariants Phase 2 must hold:

1. **Line items carry `category`** → the 9-category income breakdown derives from accepted-quote line items later, no migration.
2. **Documents store `subtotal` / `vat_amount` / `total` / `vat_applicable`** → the profit model reads revenue without re-deriving.
3. **The deferred model never touches `documents`, `payments`, or `projects`** — it is a new table that *reads* those. Same discipline as `project_files.thumbnail_path` left nullable in Session 10.

---

## 4. Status derivation — two-axis model

V2's `deriveStatus` conflates two things because a flat sheet row can't express two axes. The SaaS already models the first. **Do not port the 14-row table as-is** — port the *idea* (store primitives, derive the label on read) split across two axes:

| V2 label | SaaS axis | Source of truth |
|---|---|---|
| Draft | document status | `documents.status='draft'` (quote-level) |
| Cancelled | project | soft-delete / cancelled stage — not derived from documents |
| Confirmed / Survey Scheduled / In Progress / Submitted | **workflow stage** (already built) | `projects.current_stage_id`, `confirmed_at` — Phase 2 derives none of these |
| Quoted / Accepted / Initial Invoice Sent | **derived payment status** (new) | `documents` rows |
| Submitted — Unpaid / Partial / Final Inv Sent | workflow stage + payment suffix | stage + payment axis |
| Completed / Completed — Overpaid | `completed_at` + payment | workflow + payment axis |
| Refund in Progress | derived payment status | refund on the payment axis |

**The new axis** is a pure function of: has-initial-invoice, has-final-invoice, `SUM(payments.amount)` vs `accepted_quote.total`, refund state. Values, e.g.: `no_quote → quote_sent → quote_accepted → initial_invoice_sent → partially_paid → paid_in_full → overpaid` / `refunded`. **Nothing new is stored** — the `documents` rows and the `payments` SUM are the primitives; the label is computed fresh on read. The UI shows both axes ("In Progress · Partially Paid").

---

## 5. PDF generation

`@react-pdf/renderer` — pure JS, server-side, no native deps, runs on Vercel serverless. A server action / route handler renders the document's React-PDF template to a PDF buffer. Output is stored as a `project_files` row with `source='document_artifact'` (enum value already exists, §12.4) so generated PDFs live alongside other project files. The public `/q` / `/i` / `/r` pages get a "Download PDF" affordance that triggers generation / serves the stored artifact. This is the §34 "document generation backend" decision — now made.

---

## 6. Open-question resolution log (scope §5)

| # | Question | Resolution |
|---|---|---|
| Q1 | `documents` schema | One table discriminated by `type`; line items as `jsonb`; status enum `draft/sent/superseded/void` + `accepted_at`; peers off `project_id`. |
| Q2 | Financial-model seam | Three invariants (§3). |
| Q3 | Invoice revisability | Mutable row + revision log (V1 pattern); revise edits amount **and** recipient fields; no forced initial→final ordering. |
| Q4 | Receipt-per-payment vs updates | One receipt per payment; recorded payment amounts are correctable. |
| Q5 | `deriveStatus` port | Two-axis model (§4) — workflow stage (built) + new derived payment-status axis. |
| Q6 | Activity + notifications | Yes to both, via post-commit dispatch (ADR-033 / Hard Rule 27). |
| Q7 | PDF generation | `@react-pdf/renderer`, stored as `project_files` `source='document_artifact'`. |
| Q8 | Document numbering | Project-scoped sequence, `SELECT … FOR UPDATE` on the project row in-transaction. |
| Q9 | "Coming Soon" placement | Financials card on `/dashboard/projects/[id]`, org-side only. |
| Q10 | Session breakdown | Three sessions — 12 / 13 / 14 (§7). |
| + | Payment target | The accepted quote's `total`. |
| + | §25 `document_tokens` enum | Simplified to `quote/invoice/receipt` — the Phase 1a sketch's `receipt_initial/final` split is dropped. |
| + | Write-from-token-context | New pattern — accept-quote is an unauthenticated write authorized by token, not session. Needs an ADR (Session 12). |

---

## 7. Session-by-session breakdown

A hard dependency chain — run sequentially, not in parallel (§8).

### Session 12 — schema + quote
- Migrations: `documents`, `document_tokens` + RLS (four per-command policies each; `documents` SELECT gates stakeholders on `can_view_financials`).
- VAT calculation helper (port `calculateTotals` — 20% on discounted subtotal; `vat_applicable` honoured).
- Document numbering helper (`SELECT … FOR UPDATE`).
- Quote document type end-to-end: create (draft → sent), public `/q/[token]` page, send email (Resend, post-commit dispatch).
- Accept-quote flow: the **write-from-token-context** pattern — a server action reachable from the public page, authorized by token not session. Flips `accepted_at`; idempotent; rejects drafts and void documents. **New ADR** for this pattern.
- Claude Design pre-step: design the `/q/[token]` public quote page before the session.

### Session 13 — invoices + payments + status
- Migration: `payments` + RLS; add `documents.payment_id` column.
- Invoice document type (subtype `initial`/`final`, no forced ordering), create/send, public `/i/[token]` pages.
- `recordPayment` → `payments` row + running total; payment-amount correction path.
- Derived payment-status axis (§4) — computed on read.
- Invoice revisability (mutable row + revision log, incl. amount).
- Activity + notification wiring for invoice/payment events.
- Claude Design pre-step: `/i/[token]` page.

### Session 14 — receipts + PDF + Coming Soon + polish
- Receipt document objects (one per payment, `payment_id` link), public `/r/[token]` pages, receipt revisability (recipient fields).
- `@react-pdf/renderer` generation for all three document types → stored as `project_files` `source='document_artifact'`.
- "Coming Soon" financials card on `/dashboard/projects/[id]`.
- End-to-end Phase F walk.
- Claude Design pre-step: `/r/[token]` page + the Coming Soon card.

---

## 8. How to run this

**Step 0 — once, before Session 12:**
- Add `CLAUDE.md` at the `pcd-saas` repo root (provided alongside this doc — mirrors the SaaS Hard Rules + the §3a patterns so every Claude Code session loads them). Commit it.
- This is the Claude Code-side equivalent of the chat skill: the chat skill is the *planning* brain; `CLAUDE.md` + `ARCHITECTURE-saas.md` is Claude Code's *building* brain.

**Per-session loop:**
1. (Sessions with client-facing pages) Design the public page in Claude Design first, hand off the bundle — keeps UI iteration off the build session's context budget.
2. `git add -A && git commit -m "before session NN"` (Hard Rule 15). Branch: `session-NN-<description>`.
3. Start a **fresh** Claude Code session (one per session — schema-dense work degrades a reused context). Paste the session prompt.
4. Claude Code returns a plan. **Paste the plan back into the chat for review** before approving — this is Mode 2 (Plan Review).
5. Approve, build.
6. Verify: RLS tests, action tests, cloud-smoke, `npm run build`, `npx tsc --noEmit`.
7. After ship: update `ARCHITECTURE-saas.md` with the deltas (new tables, RLS, actions, ADRs, a §35.N carryover entry).

**Terminals:** the three sessions are a dependency chain — run them sequentially in **one** terminal. An optional **second** terminal is worth it only as a *reviewer* (Writer/Reviewer pattern), not for speed. Do not parallelize: all three sessions touch the same Supabase schema and migration sequence, and worktrees do not isolate the database.

---

## 9. Risks to watch

- **Schema-forever.** Phase 1c is closed — the `documents` / `payments` shape must be right the first time. No narrowing later.
- **Write-from-token-context is a new pattern.** Phase 1a shipped the token-gated *read*; the accept-quote *write* from an unauthenticated context is new and security-sensitive. It gets its own ADR and explicit RLS reasoning in Session 12.
- **Post-commit dispatch is mandatory.** Phase 2 emails the client on every document send — exactly the I/O-emitting-action case Hard Rule 27 / ADR-033 governs. Dispatch and email run *outside* the domain transaction.
- **Migration sequencing.** One session writes migrations at a time. Two terminals touching `db/migrations/` collide on the sequence number.
