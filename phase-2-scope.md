# Phase 2 Scope — Surveyor Lifecycle (Quote / Invoice / Receipt)

**Status:** Scoping complete — boundary + feature list locked. Schema design and session breakdown deferred to the Phase 2 kickoff conversation.
**Date:** 14 May 2026
**Feeds into:** Phase 2 kickoff (a separate conversation that turns this into a session-by-session plan)
**Source of truth:** `ARCHITECTURE-saas.md` §1 phase tracker — *"Phase 2: Surveyor lifecycle (quote/invoice/receipt) ported from Apps Script"*

---

## 1. One-line definition

Port the Apps Script V2 surveyor money flow — quote → invoice → receipt — into the SaaS as a linked, faithful reproduction of the proven V2 implementation. Fuller scope: the objects are connected by a lifecycle, not three independent forms.

---

## 2. What Phase 2 IS — feature list

### 2.1 The `documents` table
A single table covering all three document types (quote / invoice / receipt) discriminated by a `type` field. The SaaS architecture already anticipates this — `ARCHITECTURE-saas.md` §26 RLS test stubs reference a `documents` table with an `amount` field gated by `can_view_financials`. The schema shape is partly pre-designed; the kickoff finalises it.

### 2.2 Quote
- Create a quote against a project — line items, amounts, totals.
- Send it to the client.
- Client views it on a token-gated public page (the V2 "standalone document page" pattern — `buildXxxPage()` → public route with `validateDocToken`).
- Revisable after sending — port the V2 `reviseQuote` revision-tracking pattern.

### 2.3 Invoice
- Generated **from an accepted quote** (the linkage — see §3).
- Carries the **deposit / percentage-based invoice flow** from V2. This is load-bearing: Apps Script Hard Rule 9 ("deposit workflow unchanged") exists because the surveyor's cash flow depends on this percentage logic. Port it faithfully — this is translation of a proven implementation, not new design.
- Revisable after sending — port the V2 `reviseInvoice` pattern.
- Also creatable standalone (not every invoice originates from a quote), but the quote→invoice path is the primary flow.

### 2.4 Receipt
- Issued when the surveyor **marks an invoice paid** (manual — see §3 boundary on payments).
- Generated from the invoice it settles.
- Closes the money loop.

### 2.5 Document lifecycle / state machine
- States roughly: `draft → sent → (accepted | paid) → revised`.
- Transitions are linked across document types: quote acceptance is what enables invoice generation; payment is what enables the receipt.
- The exact state set and transition rules are a kickoff-level design decision — this doc only locks that the lifecycle **is in scope**.

### 2.6 Public token-gated document pages
- Client-facing view of a quote / invoice / receipt.
- Same security model as V2 and as the SaaS already uses elsewhere: per ADR-001, missing tokens are allowed, mismatched tokens are rejected.

### 2.7 Document emails
- Sending a document emails the client.
- Uses the **existing Resend path built in Phase 1a** — not a rebuild of V2's `sendOrReplyClientEmail` threading.
- Client notification opt-out respected (the established `notifyClient !== false` pattern).

### 2.8 Financial visibility gating
- Documents are gated by the **existing** `can_view_financials` stakeholder flag — no new visibility system. A stakeholder with `can_view_financials = false` never sees a document; this reuses the Phase 1b visibility-profile machinery.

---

## 3. What Phase 2 is NOT — the boundary lines

| Excluded | Why | Where it actually lives |
|---|---|---|
| **Upsells** | Explicitly Phase 5 per §1 tracker. V2 has them; they do not port in Phase 2. | Phase 5 |
| **Stripe / real card payment processing** | "Receipt on payment" in Phase 2 means the *surveyor manually marks it paid* — the receipt documents a payment that happened outside the system. Card processing is a separate concern. | Phase 6 (Stripe billing) |
| **Architect-side billing** | RIBA stage billing is a structurally different shape — stage payments across a multi-year project, not a short-cycle quote→invoice→receipt. | Phase 4 (architect lifecycle) |
| **Trello sync** | V2 has it; it is not in any SaaS phase as currently tracked. Out of the SaaS roadmap entirely (for now). | Not scheduled |
| **Native kanban / public docs hub** | Separate Phase 5 surface. | Phase 5 |
| **Email threading rebuild** | V2's `sendOrReplyClientEmail` threading is a V2-specific concern. Phase 2 document emails go through the existing Phase 1a Resend path. | N/A — not rebuilt |

### 3.1 The conversion-logic decision (LOCKED — fuller scope)
The one genuinely ambiguous boundary was whether Phase 2 includes the quote→invoice→receipt *conversion/linkage* logic, or just the three document types as independent objects.

**Decision: fuller scope.** Phase 2 ports the V2 flow faithfully — quote gets accepted, acceptance generates the invoice (with the deposit-percentage logic), payment generates the receipt. The objects are linked, not independent.

**Rationale:**
- The tighter scope (three independent forms, surveyor re-keys numbers) is half a feature — it ships "three forms," not a "lifecycle." The §1 tracker says *lifecycle*.
- The deposit-percentage logic — the load-bearing part — already exists in V2 and is protected by Hard Rule 9. This is faithful porting of a proven implementation, not speculative design. The risk is in translation accuracy, which is bounded and known.
- It does not balloon the schema: fuller scope adds a couple of nullable FK columns (e.g. `invoice.generated_from_quote_id`, `receipt.generated_from_invoice_id`) plus a state machine — no new tables beyond `documents`. The extra cost is in actions and state transitions, not the data model.
- Deferring the linkage just splits one phase into "Phase 2" + "Phase 2.5 (the rest of Phase 2)."

### 3.2 Payments are manual in Phase 2
Worth stating explicitly because it's a common confusion point: Phase 2 has **no payment processing**. "Mark as paid" is a surveyor action. The receipt is a record of a payment that occurred via bank transfer / cheque / whatever — outside PCD. Stripe (Phase 6) is what later makes payment in-system. This keeps Phase 2 self-contained and unblocked by billing infrastructure.

---

## 4. Dependencies and what Phase 2 builds on

Phase 2 sits cleanly on top of the shipped Phase 1a/1b/1c foundation. It does **not** require any of the unshipped phases.

- **Projects** (Phase 1b) — documents attach to projects.
- **Stakeholders + visibility profiles** (Phase 1b) — `can_view_financials` already exists; Phase 2 reuses it, builds nothing new here.
- **Resend email path** (Phase 1a) — document emails reuse it.
- **Public token-gated page pattern** (established, ADR-001) — client document views reuse the security model.
- **`project_activity` timeline** (Phase 1c) — document events (quote sent, invoice paid, etc.) should plausibly log to `project_activity` so they appear in the project timeline. *This is a kickoff-level decision* — flagged here so the kickoff considers it, not locked.
- **Notification dispatch** (Phase 1c) — "your quote is ready," "invoice paid" etc. are natural notification events. Again: *kickoff decides* whether Phase 2 wires new notification event types or defers that. Flagged, not locked.

---

## 5. Open questions for the kickoff conversation

These are deliberately **not** answered here — they belong to the kickoff, which does design work with the architecture spec open. Listed so the kickoff has a starting agenda.

1. **`documents` table final schema** — the §26 stub gives `type` + `amount` + `can_view_financials` gating. Kickoff finalises: line-item modelling (separate `document_line_items` table vs JSON column?), the full state enum, the linkage FK columns, revision tracking shape (does a revision create a new row or mutate in place — V2's `reviseQuote` behaviour should be checked against the actual V2 code).
2. **State machine definition** — exact states, exact transition rules, which transitions are reversible.
3. **`project_activity` integration** — do document events log to the Phase 1c activity timeline? (Recommendation: yes — it's the established pattern for project-level events.)
4. **Notification event types** — do quote-sent / invoice-paid / etc. become new `NOTIFICATION_EVENT_TYPES`? If yes, that touches the Phase 1c notification preferences seeding.
5. **PDF generation** — V2 renders HTML→PDF. The SaaS deferred thumbnail/PDF preview generation in DEBT-032 and found real blockers (`pdf-poppler` won't link on Vercel serverless, `pdfjs-dist` is heavy). Document *generation* (making the quote PDF) is a different problem from preview *thumbnails*, but the kickoff must pick an approach. `ARCHITECTURE-saas.md` §34 already flags this: *"Document generation backend — decide by Phase 2 mid."*
6. **Session breakdown** — how many Claude Code sessions, and where the cut lines fall. Phase 1c was ~3 sessions + a mini-session; Phase 2 is plausibly similar. Likely natural cuts: (schema + quote) → (invoice + deposit logic) → (receipt + lifecycle + public pages + polish). Kickoff decides.
7. **Number-sequence / document numbering** — quotes and invoices typically need human-readable sequential numbers (QUO-0001, INV-0001) per org. How is the sequence allocated, is it per-org, how are races handled. V2 has an answer — check it.

---

## 6. Roadmap note — Phase 3 needs re-examination (NOT a Phase 2 concern)

Surfaced during this scoping conversation, recorded here so it is not lost. **This does not affect Phase 2** — it is a downstream roadmap question.

The §1 tracker says *"Phase 3 = Client portal (stakeholder-facing UI)."* But the architecture's own session carryovers (§35.6) show that Phase 1b and Phase 1c **already built the client portal** — `/portal/projects`, per-project pages, conversations, files, notifications, settings, all flag-gated. §35.6 explicitly calls the shipped portal *"richer than the §32-original `/client/projects` placeholder."*

In other words: Phase 3 was *defined* (when the tracker was written) as "build the stakeholder UI — it doesn't exist yet." That UI now substantially exists, shipped early as a side effect of building the two-sided model properly. **Phase 3 as originally scoped is largely hollow** — what's left is plausibly a thin polish layer, not a phase-sized chunk.

**Recommendation:** after Phase 2 ships, revisit the §1 tracker. Phase 3 may collapse into a pre-launch UX polish pass, which would renumber / restructure the back half of the roadmap (4/5/6). Do not solve this now — Phase 2 is independent of it. Just don't let the stale tracker drive a "Phase 3 kickoff" that rebuilds something already shipped.

---

## 7. Summary — the locked decisions

- **Phase 2 = surveyor quote → invoice → receipt, ported from Apps Script V2.**
- **Fuller scope:** objects are linked by a lifecycle (quote accepted → generates invoice with deposit logic → payment generates receipt), not three independent forms.
- **Payments are manual** — "mark as paid" is a surveyor action; no Stripe, no card processing (that's Phase 6).
- **Out:** upsells (Phase 5), architect billing (Phase 4), Trello sync (unscheduled), kanban/public-docs-hub (Phase 5), email-threading rebuild (not rebuilt).
- **Reuses existing foundation:** projects, `can_view_financials` visibility flag, Resend email path, public token-gated page pattern. Builds no new visibility or auth machinery.
- **Deferred to kickoff:** final `documents` schema, state machine definition, `project_activity` + notification integration, PDF generation approach, document numbering, session breakdown.
- **Roadmap flag:** Phase 3 ("client portal") is largely already shipped via 1b/1c — revisit the tracker after Phase 2, do not kickoff a Phase 3 that rebuilds existing work.
