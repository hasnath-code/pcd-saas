# Polish Sprint S1 — Handover

**Session:** S1 — UX polish + correctness (first of three pre-launch sprint sessions)
**Dates:** 16–18 May 2026
**Branch:** `polish-sprint-s1` (off `main` at `bddc61f`)
**Scope source:** `pre-launch-sprint-scope.md` §2.1
**Status:** Complete — PR open against `main`, pending review/merge.

---

## Production verification

S1 is UX + correctness; verification is **Vercel preview**, not production (production smoke is an S2/S3 deliverable per scope §2.2/§2.3).

- **Preview URL:** https://pcd-saas-git-polish-sprint-s1-saliqueh-6333s-projects.vercel.app
- **Deploy SHA QA'd in Phase F:** `0563158` (branch HEAD at QA time — DEBT-070)
- **Sentry test event ID:** N/A — S1 has no deliberate Sentry test event; that is an S2 ops-readiness deliverable (scope §2.2).
- **Local verification at `0563158`:** `tsc --noEmit` clean · `test:rls` 254/254 · `test:actions` 329/329 · `test:cloud-smoke` 14/14 · `npm run build` clean.

The docs commit carrying this handover + the DEBT-LOG close-outs lands after Phase F QA; it changes only `DEBT-LOG.md` and this file (no code), so the QA'd `0563158` build remains representative.

### Phase F walk — Vercel preview, 18 May 2026
- **DEBT-066 correctness gate — PASS.** Project P-2026-111, two stakeholders. The `progress_only` stakeholder's activity timeline showed zero rows for the 8 financial event types; the full-access stakeholder saw them. The sprint's load-bearing gate is green.
- **Mobile walk (375px + 768px) — PASS.** 9 portal/public surfaces clean — no horizontal overflow, no broken layouts. DEBT-068's matrix inner-scroll behaves as documented.
- **Empty states + copy — PASS.** 0-conversations, 0-notifications, 0-files, empty recycle bin, and the DEBT-063 invitation landing all verbatim-match the approved copy. (The 0-projects empty state was not directly observed — the QA account had 1 project — but shares rendering with the four verified surfaces; string approved in code review.)

---

## Commits (13)

**Phase A — diagnostic**
- `0f5372a` docs: file DEBT-067 (S1 Phase A diagnostic finding)

**Phase B — correctness**
- `a9fd82e` fix: filter financial activity events for non-financial stakeholders (DEBT-066)
- `c6de22f` fix: query-level participation gate on conversation detail + messages (DEBT-060, DEBT-061)

**Phase C — UX must-haves**
- `7a3c53e` ux: disambiguate Sign up vs Sign in on invitation landing (DEBT-063)
- `54ca468` ux: mobile responsive sweep — portal + public token pages
- `8451e94` ux: shared EmptyState component
- `c80018e` ux: empty states across portal surfaces

**Phase D — should-haves + close-out prep**
- `ffe7bef` docs: close DEBT-031 — conversation nav unread badge already shipped
- `82446dc` docs: file DEBT-069 — revalidatePath literal misses org route
- `c131641` feat: file recycle bin page (DEBT-035)
- `5bd86cf` fix: gate org inbox unread count on participation (DEBT-067)
- `16c71e3` ux: copy pass — approved empty-state tweaks (S1 Phase D)
- `0563158` docs: file DEBT-070 — error toasts surface raw error codes

A 14th docs commit (this handover + the DEBT-LOG Resolved stamps) closes the sprint.

---

## DEBT IDs closed (6, + 1 docs-only)

| DEBT | Title | Fixed in | Commit |
|---|---|---|---|
| DEBT-066 | Activity-timeline financial leak | Phase B | `a9fd82e` |
| DEBT-060 | `getConversationDetail` pooler-bypass | Phase B | `c6de22f` |
| DEBT-061 | `listMessagesForConversation` pooler-bypass | Phase B | `c6de22f` |
| DEBT-063 | Invitation Sign up vs Sign in | Phase C | `7a3c53e` |
| DEBT-035 | File recycle-bin UI | Phase D | `c131641` |
| DEBT-067 | Org inbox unread-count inflation | Phase D | `5bd86cf` |

- **DEBT-031** — closed docs-only (`ffe7bef`): the unread badge was already shipped in Session 11; verified, no code change.
- All seven stamped Resolved **in-place** in `DEBT-LOG.md` (the DEBT-031 stamping pattern — entries keep their position, not moved to a Resolved section).

## DEBT IDs created (6)

| DEBT | Title | Severity | Status / trigger |
|---|---|---|---|
| DEBT-067 | Org inbox unread-count inflation | Low | created Phase A, **closed Phase D** (same sprint) |
| DEBT-068 | Notification-preferences matrix wide on mobile | Low | Open — S3 buffer |
| DEBT-069 | `revalidatePath` literal misses the org route | Low | Open — S3 buffer |
| DEBT-070 | Error toasts surface raw error codes | Low | Open — S3 buffer |
| DEBT-071 | `&amp;` entity rendered literally in portal helper text | Low | Open — S3 buffer |
| DEBT-072 | Sub-44px touch targets on portal conversation thread | Low | Open — S3 buffer / WCAG audit |

DEBT-067 appears in both lists — created (Phase A diagnostic) and closed (Phase D fix) within S1.

**DEBT-055** (conversations nav-badge) stays **Open**: the S1 Phase A diagnostic found its visible symptom was actually DEBT-067 (now fixed); its own untested `markConversationRead`-revalidation hypothesis remains, deferred to S3. Entry cross-references DEBT-067.

---

## Inherited assumptions for S2

- **Branch/merge:** S2 starts from `main` after this PR merges. S1 added zero migrations — schema stayed frozen (scope §5 held).
- **Test baseline S2 must keep green:** `test:rls` 254 · `test:actions` 329 (S1 added 8: +2 B1, +4 B2, +1 D2, +1 D3) · `test:cloud-smoke` 14.
- **`ARCHITECTURE-saas.md`:** unchanged, stays v0.20 — the sprint is not a numbered phase (scope §6: no version bump, no §35 carryover). S1 produced no schema / RLS / action / ADR deltas.
- **Known doc-staleness (do not fix unless doing a dedicated doc pass):** `ARCHITECTURE-saas.md` §12.2's `conversation_participants` schema block omits the real `left_at` column. The DEBT-060/061 fix relies on `left_at IS NULL`; the column exists in the database — only the doc block is stale. Flagged, not fixed (schema frozen, sprint takes no version bump).
- **Copy:** all S1 empty-state + copy-pass strings were reviewer-approved (Phase D tweaks + Phase F verbatim check). No copy is provisional.

---

## Open / deferred items

| Item | Next target |
|---|---|
| DEBT-055 — nav-badge `markConversationRead` revalidation hypothesis | S3 buffer |
| DEBT-068 — notification-preferences matrix mobile layout | S3 buffer |
| DEBT-069 — `revalidatePath` `/projects/[id]` literal | S3 buffer |
| DEBT-070 — error-code→message map for toasts | S3 buffer |
| DEBT-071 — `&amp;` entity in portal helper text | S3 buffer |
| DEBT-072 — portal conversation touch targets | S3 buffer / WCAG audit |
| 2 dashboard h-scroll observations at 375px — `/dashboard/projects/[id]` + the recycle page (top-right user-info text + Stakeholders table email column) | **Not filed as DEBTs** — admin/dashboard surfaces are outside S1's portal-focused scope. Revisit if/when a dashboard polish sprint is scoped. |

S1 did not touch the §3 post-launch deferrals (portal document detail pages, in-portal PDF download, stakeholder settings page) — as planned.

---

_Sprint S1 closed 18 May 2026. Next: S2 — production readiness ops (`pre-launch-sprint-scope.md` §2.2)._
