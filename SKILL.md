---
name: pcd-portal-dev
description: Use this skill whenever working on the PCD Portal — Plan Craft Daily's automation system that started as a Google Apps Script project and is evolving into a multi-tenant SaaS product. Triggers on any mention of the PCD Portal, Apps Script backend (Code.gs), portal frontend (Index.html), quote/invoice/receipt workflows, Trello integration, upsell system, token security, project status management, SaaS migration, Next.js/Supabase architecture, multi-tenancy, feature development, or debugging for this codebase. Also trigger when the user asks to plan a feature, draft a Claude Code prompt, review a Claude Code plan, debug a portal issue, discuss the SaaS migration, or says anything like "upgrade the skill", "update architecture", "skill health check", or "the skill is missing X". This skill contains the complete architecture reference, hard rules, response patterns, AND a self-evolution system that detects when the skill has fallen behind the project and upgrades itself.
---

# PCD Portal Development Skill

You are helping develop the PCD Portal — an automation system for Plan Craft Daily Ltd, a UK measured building survey and CAD drafting company. The system manages the full project lifecycle: quoting, invoicing, payment tracking, Trello sync, Drive folder management, email threading, upselling, and client-facing document pages.

**This skill is alive.** It contains a built-in health check system (Section 8) that detects when the architecture reference, response patterns, or rules are insufficient for the project's current state and proposes upgrades. The skill is designed to grow from a small Apps Script tool into a multi-tenant SaaS product guide without being replaced.

---

## 1. Architecture Reference

The PCD codebase now spans two stacks. Both are maintained — read the reference matching the work the user is asking about.

| Stack | Reference | When to read |
|---|---|---|
| Apps Script V2 portal (live, single tenant) | `references/ARCHITECTURE.md` | Any work on Code.gs, Index.html, the live portal — bug fixes, V2 features, status changes |
| PCD SaaS (Next.js 15 + Supabase, Phase 1a in progress) | `references/ARCHITECTURE-saas.md` + latest `SESSION-N-HANDOVER.md` | Any work on the SaaS rebuild — schema, RLS, server actions, auth, deploys |

If both stacks are touched in a single conversation (e.g. data migration), read both.

**Never guess at field names, action names, status values, table names, RLS policy names, or env var names — verify against the matching reference.**

For SaaS sessions: at the start of any session that ships work, also read the most recent `SESSION-N-HANDOVER.md` and `ARCHITECTURE-saas.md §35` (Session Carryover). These capture state that postdates the architecture spec and must not be redundantly re-derived.

If you cannot find something in the reference the user is asking about, that's a **skill gap signal** — see Section 8.

---

## 2. Response Modes

Match your response to what the user is asking for:

### Mode 1: Feature Planning
**Trigger:** "I want to add...", "how should we build...", "can we add..."

1. Confirm the feature in one sentence
2. Identify affected functions, actions, and data structures (cite from ARCHITECTURE.md)
3. Flag risks: contract changes, scopeData overwrites, PropertiesService budget, quota limits, migration impact
4. Ask clarifying questions only if genuinely ambiguous — otherwise state assumptions and proceed
5. If clear enough, draft the Claude Code prompt directly (Mode 3)
6. **Scale check:** if the feature would push the system past a known ceiling (see Section 7), flag it and recommend the migration-aware approach
7. **Migration plan check (SaaS sessions):** when planning a migration session, the migration count in your plan is a lower bound, not a target. Cloud reality often surfaces gaps requiring follow-up migrations. Session 2 planned 1 migration, shipped 3 (added DISABLE RLS on reference tables, added GRANT service_role). This is correct discipline — fix forward with new migration files, never edit applied migrations retroactively.

### Mode 2: Plan Review
**Trigger:** User pastes a Claude Code plan and asks "is this okay?"

1. Identify what's correct — say so briefly
2. Flag specific issues with exact fixes, not vague concerns
3. Draft additional instructions to paste alongside the approval
4. End with a clear verdict: "approve it" or "add these notes and approve it"
5. **Regression check:** verify the plan doesn't violate any hard rule from Section 4

### Mode 3: Claude Code Prompt Drafting
**Trigger:** "give me the prompt", "what should I tell Claude Code?"

Structure every prompt as:

```
**Task: [Title]**

[2-3 sentence context]

**How it should work:**
[User-perspective description]

**Backend changes (Code.gs):**
[Specific functions, line references, exact modifications]

**Frontend changes (Index.html):**
[Specific sections, modal patterns, JS handlers]

**Critical rules:**
- Do NOT rename or modify any existing function, action, status value, column reference, or JSON field name.
- Do NOT add new spreadsheet columns.
- Do NOT touch auth/session, Trello sync, recycle bin, or token validation code (unless the feature specifically requires it).
- When modifying scopeData (column O), use read-modify-write.
- [Feature-specific rules]

**Verification plan:**
[Numbered test steps]

Show me your plan before coding.
```

### Mode 4: Bug Diagnosis
**Trigger:** User describes unexpected behaviour or pastes screenshots

1. Identify the most likely cause from the architecture (which function, which data path)
2. Suggest one specific diagnostic step
3. Draft the Claude Code fix prompt if the cause is clear
4. If unclear, ask one targeted question

### Mode 5: Architecture Decision
**Trigger:** "should I store this in...", "what's the best approach..."

1. Give a direct recommendation with reasoning
2. Reference the specific constraint (PropertiesService 500KB, CacheService 6h TTL, Sheets API 300 reads/min, 6-minute execution cap)
3. If there are trade-offs, present Option A vs Option B with a clear recommendation
4. **Future-proof check:** will this decision survive the SaaS migration or create migration debt?

### Mode 6: Skill Evolution
**Trigger:** "update the skill", "skill health check", "the architecture is outdated", "we just shipped X", or automatically when a gap is detected

See Section 8 for the full protocol.

### Mode 7: SaaS Session Handover
**Trigger:** End of a SaaS session shipping work — "Session N is done", "write the handover note", or after Mode 1–5 work in SaaS context approaches the session boundary

The SaaS rebuild is built in numbered sessions (Phase 1a Sessions 1–4, Phase 1b Sessions 5–8, etc., per `ARCHITECTURE-saas.md` §31–33). Each session ships shippable work and writes a handover for the next session.

Protocol:

1. **Verify Session N done-criteria** from `ARCHITECTURE-saas.md` §31/§32/§33 are met. Don't sign off without checking each `[ ]` box.
2. **Write `SESSION-N-HANDOVER.md`** in the SaaS repo root containing:
   - Production URL + verification (Sentry test event ID, deploy URL, etc.)
   - Commit list (SHA + subject) for the session's work
   - Verified working state (smoke tests, build status, manual checks)
   - Inherited assumptions Session N+1 must respect (overrides to the spec, decisions made in-session)
   - Open issues / left-undone items (each with pull-forward target session)
   - Session N+1 first actions (suggested order, references doc §)
   - Tooling state at handover (tool versions, services connected, local stack state)
3. **Update `ARCHITECTURE-saas.md`:**
   - Bump version (`0.N` → `0.N+1`)
   - Mark Session N's tasks and done-when checkboxes ✓ in §31/§32/§33
   - Update phase tracker if a Session completed a phase
   - Append a new `§35.N Session N Carryover` subsection at the end (mirrors handover open-issues with pull-forward targets) — see Rule 16
4. **Both files commit together** with message: `docs: ARCHITECTURE-saas v0.X + handover (Session N shipped)`
5. **Push to origin/main.**
6. **Show a final confirmation** to the user: commit SHA, file size of handover, clean working tree.

After Mode 7 fires, the next SaaS session begins with the new `SESSION-(N+1)-HANDOVER.md` task in mind — Rule 15 ensures the next session reads the handover first.

---

## 3. Common Patterns to Reuse

When drafting features, reference these existing patterns rather than reinventing:

| Pattern | Where to find it | When to use |
|---|---|---|
| New auth-gated action | `handleRequest` switch block | Any new portal-only action |
| New public route | `doGet` with `validateDocToken` | Any new client-facing page |
| Per-project metadata | PropertiesService key patterns | Any project-level data that doesn't need a column |
| Revision tracking | `reviseQuote` / `reviseInvoice` | Any editable-after-send flow |
| Client notification with opt-out | `if (payload.notifyClient !== false)` | Any action that emails the client |
| Batch PropertiesService read | `getProperties()` at top of `getProjects` | Any new field added to the project payload |
| Status gating | Validate status before action | Any status-dependent operation |
| Modal pattern | `.overlay` + `.modal` + `openModal/closeModal` | Any new portal dialog |
| Standalone page builder | `buildXxxPage()` → `HtmlService.createHtmlOutput` | Any new client-facing document |
| Email threading | `sendOrReplyClientEmail()` | Every client-facing email |
| Read-modify-write on scopeData | Read JSON → merge fields → write full object | Any scopeData modification |
| FIFO-capped log | Push + slice if over cap | Any audit trail or history |

---

## 4. Hard Rules (Non-Negotiable)

Enforce on every response. If a plan violates any, flag immediately.

1. **No renames.** Never rename existing functions, action names, status values, column references, or JSON field names.
2. **No new spreadsheet columns.** Use PropertiesService or extend scopeData JSON (column O).
3. **Read-modify-write on scopeData.** Read existing JSON, merge changed fields, write full object back.
4. **Don't touch V1.** V1 is a separate Apps Script project.
5. **Same spreadsheet.** V1 and V2 share the same Sheets ID.
6. **Public pages stay public.** Token-gated, not auth-gated.
7. **Token validation unchanged.** Allow missing tokens, reject mismatches.
8. **Batch-read PropertiesService.** One `getProperties()` call at top of `getProjects`. Never inside the loop.
9. **Deposit workflow unchanged.** Percentage-based invoice flow must not be affected.
10. **Commit before each change.** Always remind user to git commit first.
11. **Never ask about existing functionality as if it's unknown.** Before asking any clarifying question, check ARCHITECTURE.md. If the answer is documented there, reference it and ask the forward-looking question instead. The user should never have to re-explain what the current system already does.

**Migration-phase rules (ACTIVE — Phase 1a in progress, multi-stack mode on):**

12. **Strangler fig only.** New features build in Next.js; Apps Script stays as Workspace adapter.
13. **Dual-write during transition.** Both Sheets and Postgres receive writes until cutover confirmed.
14. **Scope escalation awareness.** OAuth scopes for Drive, Gmail, Sheets trigger Google verification. Design with restricted scopes first.

**Cross-stack workflow rules (active for SaaS sessions):**

15. **Read the latest SESSION handover first.** At the start of any SaaS-stack session that ships work, read the most recent `SESSION-N-HANDOVER.md` AND `ARCHITECTURE-saas.md §35` (Session Carryover) before producing any plan or code. The architecture spec captures intent; the handover captures realised state including in-session decisions and overrides.
16. **Update `ARCHITECTURE-saas.md` after every shipped session.** Bump version (`0.N` → `0.N+1`), mark done-criteria ✓ in §31/§32/§33, append a new `§35.N Session N Carryover` subsection. Never let the doc drift from production reality.
17. **Bump skill changelog when rules change.** This skill grows with the project (see Section 8.5). Any edit to Sections 1–7 or Section 9 — especially adding/removing rules, modes, or stack references — is a changelog event. Don't ship rule changes without a changelog entry.
18. **For RLS-related, GRANT-related, or role-permission changes: verify on cloud Supabase before declaring session shipped.** Local Supabase has more permissive defaults than cloud. Two known divergences (Session 2): cloud auto-enables RLS on new public tables; cloud doesn't auto-grant CRUD on new public tables to service_role. Pattern: anything that "just works" locally without explicit configuration may fail on cloud. Mitigation: cloud smoke tests for any RLS/permission-affecting change before close.

---

## 5. Context Window Management

Remind the user when appropriate:

- **Fresh session** for any feature estimated at 200+ lines of changes
- **Handover prompt** — paste ARCHITECTURE.md as the first message in new Claude Code sessions
- **Commit before starting** — `git add -A && git commit -m "before <feature>"`
- **Test before stacking** — verify one feature works before starting the next
- **Session handover** — at the end of a big session, ask Claude Code to write a handover prompt for the next session

---

## 6. Quality Checklist

Before sending any response, verify:

- [ ] Referenced specific function names, field names, or status values from the architecture?
- [ ] Included protective rules in any Claude Code prompt drafted?
- [ ] Flagged any risk to existing functionality?
- [ ] Gave a direct recommendation, not a menu without a recommendation?
- [ ] Response is actionable — user can paste it or act on it immediately?
- [ ] Ended with a clear next step?
- [ ] Checked for skill gaps — is there anything in this request the skill doesn't cover? (→ Section 8)

---

## 7. SaaS Migration Context

### Current Ceilings (Apps Script)
| Resource | Limit | Current usage estimate | Trigger to migrate |
|---|---|---|---|
| PropertiesService | 500KB | ~1KB per project × ~100 projects = ~100KB | Approaching 400KB |
| Sheets API | 300 reads + 300 writes/min per Cloud project | Low (single tenant) | 50+ concurrent tenants |
| CacheService TTL | 6 hours (hard max) | Auto-refresh on every call | N/A — workaround in place |
| Execution time | 6 minutes per call | Well under | Any feature needing >6 min |
| Email quotas | 1,500/day (Workspace) | Low | Multi-tenant email blasts |
| Concurrent executions | 30 per user | Low | 50+ concurrent users |

### Four-Phase Migration Plan
- **Phase 0:** clasp + Git + TypeScript, V8 runtime, Cloud logging
- **Phase 1:** Next.js shell on Vercel + iframe Apps Script backend (strangler façade). Clerk auth, Stripe billing
- **Phase 2:** Dual-write to Supabase Postgres. Move quote/invoice generation to Node. Transactional email to Postmark/Resend
- **Phase 3:** Retire Apps Script to Workspace adapter only. Per-tenant read-only mirror Sheet
- **Phase 4:** Enterprise hardening — Cyber Essentials Plus, audit logs, domain-wide delegation, LHR data residency

### Target Stack
Next.js 15 + Vercel, Supabase (Postgres + RLS + Auth + Storage), Clerk (tenant/org model), Stripe UK VAT, Inngest/Trigger.dev for queues, googleapis Node library for Workspace integration

### Freemium Model
Solo Free / Studio £22/user/mo / Practice £38/user/mo / Enterprise £55+/user/mo. Reverse trial. ~4,100 RIBA Chartered Practices as TAM.

---

## 8. Skill Self-Evolution System

### Purpose
This skill must grow with the project. A skill written for a 15-version Apps Script portal won't serve a 50-version multi-tenant SaaS product. This section defines how the skill detects its own gaps and upgrades itself.

### 8.1 Gap Detection Triggers

The skill is potentially outdated when any of these occur:

| Trigger | Signal | Action |
|---|---|---|
| **New version deployed** | User mentions "v66", "v67", etc. or says "just shipped X" | Prompt: "Should I update ARCHITECTURE.md with the new version, actions, and PropertiesService keys?" |
| **Unknown action referenced** | User mentions an action name not in ARCHITECTURE.md | Flag: "I don't see `[action]` in my architecture reference. Has this been added? Let me update." |
| **Unknown field referenced** | User mentions a column, status, or PropertiesService key not documented | Same — flag and offer to update |
| **Feature doesn't fit patterns** | The requested feature can't be built using any pattern in Section 3 | Flag: "This feature needs a pattern we haven't documented yet. Let me add it after we build it." |
| **Scale threshold crossed** | User mentions tenant counts, performance issues, or migration decisions | Activate migration-phase rules (Section 4, rules 12-14). Add migration patterns to Section 3. |
| **New integration added** | User adds Stripe, Supabase, Clerk, Postmark, or any new service | Add integration to architecture reference with config, auth model, and data flow |
| **Stack change** | User starts working in Next.js, Supabase, or any non-Apps-Script stack | Fork the architecture reference into `ARCHITECTURE-appscript.md` and `ARCHITECTURE-nextjs.md`. Update Section 3 with new-stack patterns. |
| **User says "the skill is missing X"** | Direct feedback | Immediately draft the update |
| **Question about documented functionality** | Claude asks the user to explain something ARCHITECTURE.md already covers | Rule 11 violation — self-correct, reference the architecture, and rephrase the question as forward-looking |

### 8.2 Self-Analysis Protocol

When a gap is detected, run this analysis before proposing changes:

**Step 1 — Identify the gap category:**
- **Knowledge gap:** ARCHITECTURE.md is missing information about something that exists in the codebase
- **Pattern gap:** A new coding pattern has emerged that isn't documented in Section 3
- **Rule gap:** A new constraint or convention has been established that isn't in Section 4
- **Scale gap:** The project has outgrown assumptions baked into the skill (e.g., single-tenant assumptions when multi-tenancy is live)
- **Stack gap:** The project now uses technologies or architectures the skill doesn't cover

**Step 2 — Assess impact:**
- Does this gap cause wrong answers? (Critical — fix immediately)
- Does this gap cause incomplete answers? (Important — fix before next feature)
- Does this gap cause verbose/inefficient answers? (Nice to have — batch with other updates)

**Step 3 — Draft the update:**
- Write the exact additions/changes to ARCHITECTURE.md, SKILL.md Section 3 (patterns), Section 4 (rules), or Section 7 (migration context)
- Show the user the diff
- Apply after user approval

### 8.3 Post-Feature Update Protocol

After every feature is deployed and tested, prompt the user:

> "Feature shipped. Let me update the architecture reference. I'll add:
> - New action(s) to the handleRequest table
> - New PropertiesService key prefix(es) to the storage section
> - New status value(s) if any
> - Version history entry
> - Any new pattern worth documenting
>
> Want me to draft the update?"

This keeps the skill current without the user having to remember to maintain it.

### 8.4 Periodic Health Check

When the user explicitly asks for a health check, or when 5+ versions have shipped since the last update, run this diagnostic:

**Architecture completeness:**
- List every `handleRequest` action in the codebase → compare against ARCHITECTURE.md → flag missing
- List every PropertiesService key prefix in use → compare → flag missing
- List every status value in use → compare → flag missing
- List every `doGet` route → compare → flag missing

**Pattern coverage:**
- Review the last 5 features built → did any require a pattern not in Section 3? → add it
- Are there repeated instructions the user gives Claude Code that should be baked into the skill? → add them

**Rule relevance:**
- Are any hard rules no longer applicable? (e.g., "don't touch V1" becomes irrelevant after V1 is decommissioned)
- Are there new constraints from the migration that need to be rules?

**Scale readiness:**
- Check PropertiesService key count against the 500KB estimate
- Check if multi-tenancy patterns need documenting
- Check if new-stack patterns (Next.js, Supabase) need adding

### 8.5 Evolution Versioning

Track skill evolution so the user knows what state the skill is in:

---

## 9. Multi-Stack Architecture (ACTIVE — Phase 1a in progress)

The PCD codebase now spans two stacks. Both are maintained until Phase 4 retires Apps Script to a Workspace adapter.

### Stack 1 — Apps Script V2 portal

- **Status:** live in production, single tenant (Plan Craft Daily Ltd internal use)
- **Reference:** `references/ARCHITECTURE.md`
- **Rules that apply:** §4 #1–11 (universal Apps Script rules)
- **Modes covered:** 1–5
- **Working agreement:** bug fixes and small status/feature changes only. No major new features per Rule 12 (strangler fig).

### Stack 2 — PCD SaaS (Next.js 15 + Supabase)

- **Status:** Phase 1a in progress; Session 1 shipped 04 May 2026
- **Production URL:** https://pcd-saas.vercel.app
- **Repo:** https://github.com/hasnath-code/pcd-saas
- **Cloud Supabase project:** `gcwdasdujivliplthpvv` (eu-west-2 London)
- **Reference (canonical):** `references/ARCHITECTURE-saas.md` — schema, RLS, conventions, build checklists
- **Reference (latest realised state):** `SESSION-N-HANDOVER.md` in repo root — what shipped + carryover items
- **Reference (per-session deltas):** `ARCHITECTURE-saas.md §35.N` Session N Carryover subsections
- **Rules that apply:**
  - `ARCHITECTURE-saas.md §4` (codebase-level: RLS-first, schema-is-forever, no client writes, etc.)
  - This skill's §4 #15–17 (cross-stack workflow)
- **Modes covered:** 1–5 (planning/review/prompt/diagnosis/architecture) and **7** (session handover at session boundaries)

### Where to find inherited state

For SaaS work, never re-derive state from the architecture spec alone — the spec is intent, and Sessions ship deltas.

| You need... | Read... |
|---|---|
| Schema design intent | `ARCHITECTURE-saas.md` §10–12 |
| Realised schema (after each session) | The latest migration in `db/migrations/` + `db/schema/` |
| Conventions (naming, RLS, server actions) | `ARCHITECTURE-saas.md` §4–5, §9, §20 |
| What Session N shipped | `SESSION-N-HANDOVER.md` |
| Open carryover items by session | `ARCHITECTURE-saas.md` §35.N |
| Build checklist + done-criteria | `ARCHITECTURE-saas.md` §31–33 |
| Spec overrides made in-session | `SESSION-N-HANDOVER.md` "Inherited assumptions" |

This skill **does not duplicate** any of the above. It points at them.

### Strangler-fig boundary

Apps Script remains live until Phase 4 cuts it back to a Workspace adapter only. Until then:

- New SaaS features → Next.js side
- Apps Script side: bug fixes only, no new features (per Rule 12)
- Data migration handled per `MIGRATION-MAP.md` (separate doc, written when Phase 2 begins)

### Repo-layout convention

```
PCD SaaS repo (hasnath-code/pcd-saas):
├── ARCHITECTURE-saas.md      ← canonical SaaS spec (this is the source of truth for Stack 2)
├── SESSION-N-HANDOVER.md     ← one per shipped session
├── SKILL.md                  ← this skill (mirror — canonical lives in skill bundle)
├── ... (Next.js app)

Apps Script repo (separate):
├── ARCHITECTURE.md           ← canonical Apps Script spec (source of truth for Stack 1)
├── ... (Code.gs, Index.html, etc.)
```

---

## Skill Changelog
- v1.0 (03 May 2026): Initial skill — covers Apps Script portal v50–v65, five response modes, hard rules, common patterns, quality checklist
- v2.0 (03 May 2026): Added self-evolution system (Section 8), gap detection triggers, self-analysis protocol, post-feature update protocol, periodic health check, migration-phase rules, multi-stack placeholder, skill changelog
- v2.1 (03 May 2026): Added Rule 11 — "Never ask about existing functionality as if it's unknown." Triggered by gap signal: Claude asked the user to re-explain quote acceptance flow that was fully documented in ARCHITECTURE.md. Added Rule 11 violation detection to Section 8.1 gap triggers. Renumbered migration rules to 12-14.
- v3.0 (05 May 2026): **Multi-stack mode activated.** Section 9 promoted from placeholder to active reference (Apps Script + SaaS coexist). Section 1 now lists both `ARCHITECTURE.md` and `ARCHITECTURE-saas.md` with read-when guidance. Cross-stack workflow rules added (§4 #15–17): read latest SESSION handover at start of any SaaS session; update `ARCHITECTURE-saas.md` after every shipped session; bump this changelog when rules change. Mode 7 (SaaS Session Handover) added: codifies the protocol for writing `SESSION-N-HANDOVER.md` and updating `ARCHITECTURE-saas.md` §35.N. Migration-phase rule label changed from "activate when SaaS migration begins" to "ACTIVE — Phase 1a in progress, multi-stack mode on". Triggered by: PCD SaaS Phase 1a Session 1 shipped to production (https://pcd-saas.vercel.app), making the multi-stack placeholder false.
- v3.1 (05 May 2026): Cloud-vs-local divergence rule added (§4 #18) — RLS/GRANT/permission changes must verify on cloud before session close. Migration count growth note added (§2 Mode 1 step 7) — plan count is a lower bound, fix forward with new migrations. Lessons from Phase 1a Session 2 (planned 1 migration, shipped 3 after cloud surfaced two local-vs-cloud platform divergences).
