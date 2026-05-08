# Post-Session Checklist

**Purpose:** Resistance to ritual decay. Every session ends with the temptation to skip the boring parts and ship — that's exactly when discipline matters most. Six months from now, the difference between a healthy codebase and a tangled one is whether this checklist was honored 50 times in a row, or 47 out of 50.

**Scope:** Apps Script and SaaS. The checklist applies to every session that ships code, schema, or doc changes.

**Hard rule:** No session merges to `main` without every applicable item ticked. If something is genuinely not applicable to a particular session (e.g., a documentation-only session has no schema changes), explicitly mark it N/A — don't silently skip.

This document is the operational complement to SKILL.md Section 8.3 (Post-Feature Update Protocol). The skill prompts; this enforces.

---

## When to run this checklist

Right before merging the session branch (or worktree) to `main`. After all code work is done. Before the celebratory commit. Before closing the laptop.

If a session is going to span multiple days, run it at the end of each day's work in case of interruption — partial completion is better than zero, and makes resumption cleaner.

---

## The checklist

### 1. Tests are green

- [ ] All test suites run successfully against the latest code
- [ ] No tests skipped without justification
- [ ] New code has corresponding tests (RLS for new tables, action tests for new server actions, integration tests where applicable)
- [ ] Test count compared to expected (per session kickoff doc) — flagged if below

**Why this matters:** Green tests at merge time are the contract. If tests are red, broken, or unrun, every subsequent session inherits hidden risk.

**SaaS specifics:** `npm run test:rls`, `npm run test:actions`, `npm run test:cloud-smoke` all green. Cloud divergence smoke test passes (anon curl returns 401/403 on RLS-protected endpoints).

**Apps Script specifics:** Manual smoke test of changed flow (no automated test runner). Document what was smoke-tested in the session handover.

---

### 2. Architecture doc updated

- [ ] If new tables, columns, RLS policies, server actions, routes, or PropertiesService keys were added — they're in `ARCHITECTURE.md` (Apps Script) or `ARCHITECTURE-saas.md` (SaaS)
- [ ] If existing functionality changed — the doc reflects the new behavior, not the old one
- [ ] Version number bumped at the top of the file
- [ ] Section §32 (open questions) pruned of items decided this session
- [ ] Phase tracker (§1 of SaaS doc) updated if a phase milestone was reached

**Why this matters:** A stale architecture doc is worse than no architecture doc — it tells confident lies. The skill assumes ARCHITECTURE.md is true. If it isn't, the skill's advice becomes unreliable in subtle ways.

**Common omission:** Adding a new server action but forgetting to add it to the action table. Two sessions later, Claude Code asks "is `cancelInvitation` documented?" and the answer is "no, but I assumed it was." Don't let that happen.

---

### 3. Decisions logged

- [ ] Every architectural choice made this session has an entry in `DECISIONS.md`
- [ ] Each entry includes: date, codebase, status, context, decision, alternatives rejected, reconsider-if trigger
- [ ] Cross-references between DECISIONS.md and ARCHITECTURE.md are accurate (ADRs referenced where relevant)

**Why this matters:** Architecture docs say *what*. Decisions doc says *why*. The why is what you need when revisiting a choice nine months later. "Why did we use text + CHECK instead of native enums?" — answered by ADR-008, not by reading three architecture sections.

**Trigger questions:** Did we pick between two technical options? Did we lock something in? Did we override a default behavior of a tool/library? Did we decline to do something that would have been a reasonable alternative? Each yes = an ADR.

---

### 4. Debt logged

- [ ] Every TODO, workaround, deferred decision, or "fix later" comment from this session has an entry in `DEBT-LOG.md`
- [ ] Each entry has severity, type, status, fix sketch, and trigger
- [ ] Items resolved this session are moved from "Open Debt" to "Resolved Debt" with resolution date + commit reference
- [ ] Inline `// TODO:` comments in code reference the DEBT-NNN number for traceability

**Why this matters:** TODOs in code comments are invisible at the project level. You can't sort them, prioritize them, or notice patterns. A central debt log forces visibility — and visibility is what stops debt from compounding.

**Common omission:** "I'll just put a TODO comment, that's good enough." It isn't. Six months later, no one greps for TODO. Add the entry.

---

### 5. Session handover written

- [ ] `SESSION-N-HANDOVER.md` created (same structure as previous session handovers)
- [ ] Includes: shipped tasks, key decisions made (cross-referenced to DECISIONS.md), surprises and gotchas, inherited assumptions for the next session
- [ ] Final test counts recorded
- [ ] Last commit hash on main referenced

**Why this matters:** The next session's first prompt is "read the handover." A good handover means the next Claude Code session starts with full context in 60 seconds instead of guessing for 30 minutes.

**Common omission:** Writing the handover after closing the session and forgetting half of what happened. Write it while context is still fresh.

---

### 6. Skill health check

- [ ] Did this session reveal a gap in `SKILL.md`? (Section 8.1 gap detection triggers)
  - Unknown action referenced that wasn't in ARCHITECTURE.md?
  - Unknown field or status?
  - Feature didn't fit any documented pattern?
  - User said "the skill is missing X"?
  - User had to re-explain something the skill should have known?
- [ ] If yes — `SKILL.md` updated, version bumped, changelog entry added
- [ ] If no — explicitly noted (e.g., "skill health check: no gaps found this session")

**Why this matters:** The skill is supposed to grow with the project. If it doesn't, it falls behind. Every five sessions of growth without a skill update is a sign the skill is decaying.

---

### 7. Commit hygiene

- [ ] Session branch / worktree merged cleanly to `main` (or session branch, then to main, per workflow)
- [ ] Commit messages are descriptive — future-you can understand what each commit did without reading the diff
- [ ] No commented-out code committed
- [ ] No accidentally committed secrets (`.env.local`, API keys in code, etc.) — `git diff main...HEAD | grep -i 'key\|secret\|token\|password'` returns clean
- [ ] No `console.log` debugging left in production code paths

**Why this matters:** Commit history is the long-term record. Sloppy commits make `git blame` and `git log` painful months later, exactly when you need them most.

---

### 8. Production deploy verified

- [ ] Deploy succeeded (Vercel logs / Apps Script deployment confirmation)
- [ ] Production smoke test passes (load the live URL, perform one happy-path action)
- [ ] No errors in Sentry / Apps Script execution logs from the deployment window
- [ ] Rollback procedure known if anything goes wrong in the next 24 hours

**Why this matters:** Green tests pass on the test environment, not necessarily production. Deploy and verify is the difference between "I shipped" and "users can use it."

---

### 9. Manual QA (Phase F) — when applicable

Skip if the session was docs-only or test-only with no UI/UX-affecting changes. For any session that touches user-facing surface, the manual QA pass is non-negotiable.

**Step 0 — always:** Hard refresh (Cmd+Shift+R / Ctrl+Shift+R) the production page before testing. Stale browser cache hiding the new deploy is a real failure mode (see ADR-023; cost was ~10 min of false-positive debugging in Session 8).

**Test org only:** Do NOT run UI mutation tests against your real production org. Use a separate test org. If you don't have one, create one with a dedicated email at the start of the QA pass.

**Result categories — strict:**
- [ ] **PASS** — Step verified end-to-end as a real human user. Data outcome correct AND visual UX as designed.
- [ ] **FAIL** — Step failed; document the failure mode and either fix or file as DEBT before proceeding.
- [ ] **N/A** — Step legitimately doesn't apply this session, OR cannot be verified in the current QA context (e.g., browser-Claude can't see native modals, two-context tests need separate sign-ins). Mark explicitly N/A; never silently skip.

**No "PASS with caveat":** A step is PASS, FAIL, or N/A. Caveat-PASS framing risks shipping unverified behavior into the verified bucket. If a step needs caveats, it's N/A and a follow-up entry goes in DEBT-LOG.md to verify it later. (See DEBT-017.)

**Native browser modals require human eye-on:** `window.confirm`, `window.alert`, `window.prompt` cannot be verified by browser-Claude automation — automation auto-dismisses them. Mark these N/A in automated runs and human-verify separately. Migrating to shadcn AlertDialog (DEBT-016) closes this gap.

---

### 10. Cleanup

- [ ] Worktree deleted (if used) after merge
- [ ] Local branches cleaned up (`git branch -d <session-branch>` after merge)
- [ ] Open browser tabs closed (the small ritual matters)
- [ ] Notes from session that should live in DECISIONS or DEBT-LOG already moved there — no orphaned notes in chat history

---

## Going further: cadence checks

These don't run every session, but should run on schedule.

### Every 5 sessions

- [ ] Skim `DEBT-LOG.md` open items — anything escalated in severity? Anything ready to fix because adjacent work is happening?
- [ ] Skim `DECISIONS.md` — any "Reconsider if" trigger fired since last review?
- [ ] Run the Section 8.4 periodic health check from `SKILL.md`

### At end of each Phase

- [ ] Full audit of `ARCHITECTURE.md` / `ARCHITECTURE-saas.md` — is it actually accurate? Cross-reference to the live codebase.
- [ ] All `DEBT-LOG.md` items triggered by "before this phase" should be resolved or explicitly deferred with new trigger
- [ ] Skill version bump if substantial changes accumulated
- [ ] Phase summary entry in `ARCHITECTURE-saas.md` §1 phase tracker

### Quarterly (or every 20 sessions, whichever first)

- [ ] Full repo lint pass — find dead code, unused imports, deprecated patterns
- [ ] Dependency audit — `npm audit`, update non-breaking patches
- [ ] Backup verification — can we actually restore from backup? (Only matters once production data exists.)

---

## What "applicable" means

A documentation-only session probably won't have items 1, 7-bug, or 8 to check. A schema migration session will hit every item. Use judgment, but the rule is:

**If unsure, check it. The cost of running through a checklist on autopilot is 60 seconds. The cost of skipping the one item that mattered is days of debugging.**

---

## When this checklist itself needs updating

This file is also subject to drift. If a session reveals that the checklist is missing an important step, or has a redundant one, update this file. Add an entry to `DECISIONS.md` if the change is a meaningful policy shift.

---

*This checklist exists because architecture docs without rituals are wishes. The Reddit person from "vibe coded for 6 months" had no rituals. We have rituals. That's the difference.*
