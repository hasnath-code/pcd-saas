# Phase 2 Scope — Surveyor Lifecycle (Quote / Invoice / Receipt)

**Status:** Scoping complete — boundary + feature list locked. Schema design and session breakdown deferred to the Phase 2 kickoff conversation.
**Date:** 14 May 2026 (revised after reading V2 `Code.gs`)
**Feeds into:** Phase 2 kickoff (a separate conversation that turns this into a session-by-session plan)
**Source of truth:** `ARCHITECTURE-saas.md` §1 phase tracker — *"Phase 2: Surveyor lifecycle (quote/invoice/receipt) ported from Apps Script"* — corrected against the actual V2 `Code.gs` implementation.

> **Revision note.** The first draft of this doc assumed a simple one-quote→one-invoice→one-receipt chain. Reading the V2 `Code.gs` corrected several assumptions — see §2.1. This version is grounded in what V2 actually does, plus the deliberate upgrades agreed during scoping (receipts become first-class objects).

---

## 1. One-line definition

Port the Apps Script V2 surveyor money flow — quote → invoice → receipt — into the SaaS as a set of linked, client-facing document objects, faithfully reproducing V2's proven behaviour with two deliberate upgrades (receipts become persisted objects; the schema is designed so V2's deferred financial model can bolt on later). V2's internal income-breakdown / expenses / profit / people model is **out of build scope** for Phase 2 — it is surfaced as a "Coming Soon" placeholder in the surveyor-facing project view and built in a later phase.

---

## 2. What Phase 2 IS — feature list

### 2.1 Corrections from reading V2 `Code.gs` — read this first

The V2 implementation differs from the architecture's one-line description in ways that change the schema. The kickoff must build against *these* facts, not the original assumptions:

- **Invoices are a 2-slot model, not N invoices.** V2 stores invoices as an array inside `scope_data.invoices`, but there are exactly two types: `initial` (the deposit) and `final` (the balance). The surveyor picks each amount; `defaultDepositPct` (V2 Settings, 25) only pre-fills the initial-invoice modal. This matches the "40% now, rest later" flow described in scoping — it is two invoices, not an open-ended ledger.
- **Payment is a single running total, not per-invoice allocation.** V2's `recordPayment` adds to one `status_amount_paid` figure; `status_payment_remaining = tax_total - status_amount_paid`. Payment state (`None` / `Partial` / `All` / `Overpaid`) is derived by comparing those two numbers. There is no "which payment settled which invoice" — payments fill one bucket.
- **Quote acceptance is a boolean, not a state machine.** V2's `acceptQuote` sets `quote_accepted = true` + `date_accepted` and appends a note. That's the whole acceptance "flow."
- **In V2, receipts are NOT objects** — they are transient emails fired by `recordPayment`, nothing stored. **Phase 2 deliberately upgrades this** (see §2.5): receipts become first-class persisted objects, peers of quote and invoice.
- **Status is computed, not stored.** V2's `deriveStatus` is a 14-row truth table that reads invoice flags + payment state + the `submitted` flag and produces a display label. The money *primitives* are stored columns; the *label* is derived fresh on every read. Phase 2 adopts this pattern (see §2.6).
- **V2's `Projects_V2` is a 73-column sheet** carrying far more than quote/invoice/receipt — income breakdown (9 categories), an expenses/profit model, a people/payroll block, an average-wage cost snapshot. **None of this is in Phase 2's build scope** — see §3.

### 2.2 The `documents` model
Quote, invoice, and receipt are **peer document objects**, all hanging off a project. The SaaS architecture already anticipates this — `ARCHITECTURE-saas.md` §26 RLS test stubs reference a `documents` table with an `amount` field gated by `can_view_financials`. Whether it's one `documents` table discriminated by `type`, or separate tables, is a kickoff schema decision — but the three are peers: each has a stored record, a public token-gated page, a downloadable PDF, and an email.

### 2.3 Quote
- Created against a project — line items, amounts, totals, VAT.
- Sent to the client; client views it on a token-gated public page (V2's `_buildViewQuotePage_` pattern).
- **Acceptance is a boolean flip** — client clicks Accept on the public page, a confirm step captures their name, the project's `quote_accepted` equivalent flips true. Port V2's `acceptQuote` behaviour: idempotent (second acceptance is a no-op), rejects drafts and cancelled projects.
- Revisable while not yet accepted — port V2's revise behaviour (the revision overrides amounts and re-sends; check the actual V2 revise path, which may live in V1 / a newer unit not in the `Code.gs` reviewed).
- Downloadable as PDF.

### 2.4 Invoice
- **2-slot model:** `initial` (deposit) and `final` (balance). Each is a stored document object.
- The surveyor picks each amount. A per-org `defaultDepositPct` setting pre-fills the initial-invoice amount (port V2's Settings pattern). The "30% minimum on the initial invoice" rule mentioned in scoping is not in the reviewed `Code.gs` — the kickoff should confirm whether it's a UI validation rule to port.
- Generated independently of the quote (V2 does not auto-generate the invoice from acceptance — `generateInvoice` is its own action). Acceptance is a precondition the *surveyor* acts on, not an automation.
- Public token-gated page, downloadable PDF, email (threaded into the project's client email conversation in V2; in the SaaS, via the existing Phase 1a Resend path).
- **Revisable** — the surveyor confirmed invoices can be revised. V2's reviewed `Code.gs` has invoices as append-only array entries with no revise path, so this is either a V1 behaviour, a newer V2 unit, or a manual process. **Kickoff open question** (see §5): revisable invoice = mutable row, or new-row-supersedes-old.

### 2.5 Receipt — UPGRADED from V2
- **In Phase 2, a receipt is a first-class document object** — not V2's transient email. It has a stored record, a public token-gated page, a downloadable PDF, and an email — exactly like quote and invoice.
- Fires on payment (port V2's `recordPayment` trigger point).
- Revisable, like quote and invoice (surveyor confirmed).
- **Kickoff open question** (see §5): because receipts are now objects and V2 fires a receipt email on *every* `recordPayment` call (including each partial payment), does a partial payment create a receipt object per payment, or one receipt object that updates? V2 didn't have to answer this; the SaaS does.

### 2.6 Status derivation — IN Phase 2 (do not defer this with the financial model)
V2's `deriveStatus` truth table is **part of the quote/invoice/receipt flow**, not part of the deferred analytics model. A project's displayed status is a function of: does it have an initial invoice, does it have a final invoice, what's the payment state, is it submitted. Phase 2 must port this **status-derivation idea**: store the money primitives (`amount_paid`, `tax_total`, invoice existence), compute the status label fresh on read. The "Coming Soon" wall in §3 goes around the *financial analytics*, **not** around status. If the kickoff accidentally defers `deriveStatus`, Phase 2's projects will have no working status.

### 2.7 Payment recording
- Port V2's `recordPayment`: positive amount, adds to a running `amount_paid` total, recomputes remaining, derives payment state (`None` / `Partial` / `All` / `Overpaid` — overpaid is flagged, not rejected).
- Triggers receipt creation (§2.5) + email.
- Payment is a surveyor action — "mark as paid." No card processing (see §3 — Stripe is Phase 6).

### 2.8 VAT — IN Phase 2
- The surveyor's firm is VAT-registered; the invoice the **client** receives must show VAT correctly. This is client-facing and cannot be "Coming Soon."
- Port V2's VAT calculation (`calculateTotals` applies 20% on the discounted subtotal).
- Build VAT as a **per-org toggle** (registered / not registered) — future tenants won't all be VAT-registered, and the toggle changes invoice rendering and calculation. V2 has a `vatApplicable` flag on `scope_data` and a `_vatApplicable` path in `calculateTotals` — port that shape.

### 2.9 Public token-gated document pages
- Client-facing views of quote / invoice / receipt.
- Same security model the SaaS already uses (ADR-001): missing tokens allowed (legacy-link compatibility), mismatched tokens rejected.
- Each page has a print/PDF affordance (V2 uses the browser print dialog; the SaaS kickoff decides — see §5 PDF generation).

### 2.10 Document emails
- Sending a document emails the client; uses the **existing Phase 1a Resend path**, not a rebuild of V2's Gmail-threading (`sendOrReplyClientEmail`).
- Client notification opt-out respected (the established pattern).

### 2.11 "Coming Soon" financials placeholder — a named Phase 2 deliverable
- A visible, named section in the **surveyor/architect-facing** project view (NOT the `/portal` client view — clients never see this) labelled something like "Financials" or "Profitability," showing a "Coming Soon" state.
- This is a small but **explicit** deliverable — placeholder section, styling, placement decision. Listed here so the kickoff treats it as scope, not an afterthought.
- Its purpose is twofold: (a) honest expectation-setting for the in-house team that V2's profit model is queued, not abandoned; (b) a self-imposed contract that the Phase 2 schema *must* leave a clean seam for it (see §3).

---

## 3. What Phase 2 is NOT — the boundary lines

### 3.1 The financial model — built later, visible now as "Coming Soon"
V2's `Projects_V2` carries an entire internal financials system that is **out of Phase 2's build scope**:
- Income breakdown across 9 categories (`income_drawing_existing`, `income_survey_measured`, …)
- Expenses model (`expense_surveyor_measured`, `expense_drawing_map`, …)
- Profit calculation (`profit_before_aw_amount`, `profit_after_aw_pct`, …)
- People / payroll block (`people_drawing_person`, `people_drawing_paid`, …)
- Average-wage cost snapshot (`expense_aw_snapshot`)

This is the surveyor's *business analytics* — genuinely separable from "send the client a document." Phase 2 surfaces it as the §2.11 "Coming Soon" placeholder and a later phase builds it.

**The entanglement caveat:** V2's quote/invoice/receipt flow *is* coupled to this model — `calculateTotals` does VAT on top of the income breakdown, `deriveStatus` reads invoice flags. Phase 2 resolves this by:
- Taking VAT (§2.8) and status derivation (§2.6) into Phase 2 — they're client-facing / flow-critical.
- Leaving income-breakdown / expenses / profit / people out.
- **Designing the schema with a deliberate seam** so the financial model bolts on later with no migration — same discipline as `project_files.thumbnail_path` being left nullable in Session 10. This is a hard requirement on the kickoff's schema design, not a nice-to-have.

### 3.2 Other exclusions

| Excluded | Why | Where it lives |
|---|---|---|
| **Upsells / add-ons** | V2 has a whole add-on pricing engine (`ADDON_PRICING_RULES`, accepted-addons). Explicitly Phase 5 per §1 tracker. | Phase 5 |
| **Stripe / card payment processing** | Phase 2 "payment" = surveyor manually marks paid; the receipt records a payment that happened outside PCD. | Phase 6 |
| **Architect-side billing** | RIBA stage billing is a structurally different shape (stage payments across a multi-year project). Phase 2 is surveyor short-cycle only. | Phase 4 |
| **Trello sync** | V2 has it; not in any SaaS phase as currently tracked. | Not scheduled |
| **Native kanban / public docs hub** | Separate Phase 5 surface. | Phase 5 |
| **Gmail-threading rebuild** | V2 threads client emails into one Gmail conversation per project. Phase 2 document emails go through the existing Phase 1a Resend path. | N/A — not rebuilt |
| **V2's financial/expenses/profit/people model** | See §3.1 — out of build scope, surfaced as "Coming Soon." | A later phase |

---

## 4. Dependencies — what Phase 2 builds on

Phase 2 sits on the shipped Phase 1a/1b/1c foundation. It requires none of the unshipped phases.

- **Projects** (Phase 1b) — documents attach to projects.
- **Stakeholders + visibility profiles** (Phase 1b) — `can_view_financials` already exists; Phase 2 reuses it to gate document visibility, builds nothing new here.
- **Resend email path** (Phase 1a) — document emails reuse it.
- **Public token-gated page pattern** (established, ADR-001) — client document views reuse the security model.
- **`project_activity` timeline** (Phase 1c) — document events (quote sent, invoice paid, etc.) should plausibly log here so they appear in the project timeline. *Kickoff-level decision* — flagged, not locked.
- **Notification dispatch** (Phase 1c) — "your quote is ready," "invoice paid" are natural notification events. *Kickoff decides* whether Phase 2 wires new notification event types or defers that.

---

## 5. Open questions for the kickoff conversation

Deliberately not answered here — these belong to the kickoff, which designs with the architecture spec + V2 `index.html` + V2 prompts in hand.

1. **`documents` schema** — one table discriminated by `type`, or separate tables? Line-item modelling (separate `document_line_items` table vs JSON column — V2 uses a `scope_data` JSON blob). The full state enum. The linkage between quote → invoice → receipt.
2. **The schema seam for the deferred financial model** — §3.1 makes this a hard requirement. Kickoff must show how income-breakdown / expenses / profit / people bolt on later with no migration.
3. **Invoice revisability** — surveyor says invoices are revisable, but V2's reviewed `Code.gs` has them as append-only. Mutable row, or new-row-supersedes-old? Resolve against V2's actual revise behaviour (check `index.html` / prompts / V1).
4. **Receipt-per-payment vs receipt-updates** — receipts are now objects (§2.5); V2 fires a receipt email per `recordPayment`. Does each partial payment mint a receipt object, or is there one receipt that updates?
5. **Status derivation port** — V2's `deriveStatus` is a 14-row truth table. How much of it ports as-is? The SaaS project model doesn't have all of V2's status inputs (`status_submitted`, `status_surveyed` are architect/surveyor-lifecycle fields). Kickoff maps V2's truth table onto the SaaS's actual status needs.
6. **`project_activity` + notification integration** — do document events log to the Phase 1c activity timeline and fire notifications? (Recommendation: yes for activity logging — it's the established pattern.)
7. **PDF generation** — V2 uses the browser print dialog. The SaaS deferred thumbnail/PDF *preview* generation in DEBT-032 with real blockers (`pdf-poppler` won't link on Vercel serverless, `pdfjs-dist` is heavy). Document *generation* (making the quote/invoice/receipt PDF) is a different problem from preview thumbnails, but the kickoff must pick an approach. `ARCHITECTURE-saas.md` §34 flags: *"Document generation backend — decide by Phase 2 mid."*
8. **Document numbering** — quotes/invoices/receipts need human-readable sequential numbers, per-org. V2 uses `code + '-INV-' + typeChar + seq` and a per-org counter in Settings (`LockService`-guarded). How does the SaaS allocate the sequence, handle races?
9. **"Coming Soon" placement** — where in the surveyor-facing project view does the §2.11 placeholder live, and what exactly does it say?
10. **Session breakdown** — how many Claude Code sessions, where the cut lines fall. Phase 1c was ~3 sessions + a mini-session. A plausible Phase 2 shape: (schema + quote + public page) → (invoice 2-slot + VAT + payment recording + status derivation) → (receipt objects + PDF generation + "Coming Soon" placeholder + polish). Kickoff decides.

---

## 6. Roadmap note — Phase 3 needs re-examination (NOT a Phase 2 concern)

Surfaced during scoping, recorded here so it is not lost. **Does not affect Phase 2.**

The §1 tracker says *"Phase 3 = Client portal (stakeholder-facing UI)."* But the architecture's own session carryovers (§35.6) show Phase 1b and Phase 1c **already built the client portal** — `/portal/projects`, per-project pages, conversations, files, notifications, settings, all flag-gated. §35.6 explicitly calls the shipped portal *"richer than the §32-original `/client/projects` placeholder."*

Phase 3 was *defined* (when the tracker was written) as "build the stakeholder UI — it doesn't exist yet." That UI now substantially exists, shipped early as a side effect of building the two-sided model properly. **Phase 3 as originally scoped is largely hollow.**

**Recommendation:** after Phase 2 ships, revisit the §1 tracker. Phase 3 may collapse into a pre-launch UX polish pass, which would renumber the back half of the roadmap (4/5/6). Do not solve this now. Do not kick off a "Phase 3" that rebuilds something already shipped.

---

## 7. Summary — the locked decisions

- **Phase 2 = surveyor quote → invoice → receipt, ported from Apps Script V2** as client-facing document objects.
- **The V2-code reality** (corrects the first draft): invoices are a 2-slot `initial`/`final` model; payment is one running total; quote acceptance is a boolean; status is *derived* from money primitives.
- **Receipts are upgraded to first-class objects** — stored record + public page + PDF + email, peers of quote and invoice. (V2 had them as transient emails only.)
- **Quote, invoice, and receipt are peer document objects** — each with a record, public token-gated page, downloadable PDF, and email.
- **VAT is in scope** — client-facing, built as a per-org registered/not-registered toggle.
- **Status derivation is in scope** — port V2's "store money primitives, compute the label" pattern. Do NOT defer this with the financial model.
- **Payments are manual** — "mark as paid" is a surveyor action; no Stripe (Phase 6).
- **V2's financial model is OUT of build scope** — income-breakdown / expenses / profit / people. Surfaced as a **"Coming Soon" placeholder** in the **surveyor/architect-facing** project view only (clients never see it). Built in a later phase.
- **Hard schema requirement:** design `documents` + project fields with a deliberate seam so the deferred financial model bolts on later with no migration.
- **Deferred to kickoff:** final schema, the seam design, invoice/receipt revisability model, receipt-per-payment question, status-derivation port, `project_activity` + notification integration, PDF generation approach, document numbering, "Coming Soon" placement, session breakdown.
- **Roadmap flag:** Phase 3 ("client portal") is largely already shipped via 1b/1c — revisit the tracker after Phase 2, do not kick off a Phase 3 that rebuilds existing work.
