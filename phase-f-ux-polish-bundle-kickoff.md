# PHASE-F-UX-POLISH-BUNDLE — Kickoff

**Status:** Approved, ready to execute
**Created:** 15 May 2026
**Scope:** Pre-launch readiness pass — close 9 small DEBT entries spanning UX polish, discoverability, and 2 Medium-severity bug fixes
**Estimated time:** 5–6 hours total
**Branch:** `phase-f-ux-polish-bundle`
**Pre-fix tag:** `pre-phase-f-polish` at `92287f0` (current main HEAD post-MINI-SESSION-DEBT-059)
**Merge tag (post-ship):** `phase-f-polish-shipped`
**Merge convention:** Squash merge to main, branch preserved on origin (matches `debt-026` / `debt-043` / `debt-037-hotfix` / `debt-059` precedent)
**Session shape:** Bug-bash — multiple small unrelated fixes, per-DEBT commits, single PR

---

## What this session is and isn't

**Is:**
- Low-risk per-item changes (mostly UX, copy, styling, discoverability + 2 known Medium bugs)
- Each fix independently revertable via per-DEBT commits
- Acceptance is visual/click verification + 4 targeted regression tests
- Single PR with 9 commits

**Isn't:**
- New features or new surface area (DEBT-048 explicitly descoped)
- Major refactors
- Investigation work without clear repro (DEBT-055, DEBT-062 explicitly descoped)
- Cross-cutting architecture changes (no SKILL bump, no ADR)

---

## Pre-flight decisions (LOCKED)

### Decision 1: Bundle scope → Option B — Expanded pre-launch readiness pass
9 items total: 7 polish + 2 Medium-severity bug fixes. Closes 2 long-standing Medium-severity items (DEBT-038, DEBT-039) before Phase 2 work begins.

### Decision 2: Test discipline per item → Recommendations stand
Targeted regression tests on 4 items where logic changes (DEBT-052, 036, 038, 039). Visual-only verification for copy/icon/link/layout changes (DEBT-050, 051, 053, 054, 040).

### Decision 3: Commit strategy → Per-DEBT commits (Decision (a))
One DEBT closure per commit. Clean revertable history. Squash-merge collapses to one commit on main but preserves per-DEBT history on branch.

---

## Hard rules for this session

1. **No scope expansion mid-session.** If a new bug surfaces during a fix, file a new DEBT entry; do not extend the current item.

2. **Each fix must close its DEBT entry.** Per-commit message format: `Closes DEBT-XXX → DEBT-RXXX: <one-line description>`

3. **No new tables, migrations, env vars, or major dependencies.** Same as DEBT-059 mini-session.

4. **Visual changes get Phase F verification on Vercel preview, not local.** Local OrbStack Supabase has known divergence from cloud; preview is the trusted environment.

5. **Test additions only where listed in Decision 2.** Don't over-test trivial copy/icon changes; do test logic-changes (DEBT-052, 036, 038, 039 only).

6. **Plan before coding (Hard Rule 9).** Output numbered execution plan after reading kickoff. Pause for approval before Phase 1.

7. **Per-DEBT commits, not per-area batched.** One DEBT-XXX = one commit. Don't bundle "all conversation fixes" into one commit.

8. **Squash merge to main, branch preserved on origin.** Convention.

9. **Pre-fix tag before any code changes.** `git tag pre-phase-f-polish 92287f0 && git push origin pre-phase-f-polish` BEFORE branch creation.

10. **If any item turns out more complex than its DEBT entry estimate, STOP and surface to me before continuing.** Estimates are from each entry's "Fix sketch" in DEBT-LOG.md. Real-world reality diverging from the estimate is a signal worth pausing on.

---

## Phase plan

### Phase 0 — Read + plan (5 min)
Read this kickoff end-to-end. Verify state:
- Currently on main at `92287f0`
- Pre-fix tag `pre-phase-f-polish` does NOT yet exist locally or on origin
- All 9 listed DEBT entries verifiable in `DEBT-LOG.md`

Output numbered execution plan referencing the phases below. Pause for approval before Phase 1.

### Phase 1 — Setup (5 min)
- `git tag pre-phase-f-polish 92287f0 && git push origin pre-phase-f-polish`
- Verify tag pushed: `git ls-remote --tags origin pre-phase-f-polish`
- `git checkout -b phase-f-ux-polish-bundle`

### Phase 2 — Per-item fixes (sequence: easiest first to build momentum, ~3-4 hours total)

Execute in this order. After each fix: `git add` relevant files, commit with the format below, do NOT push until Phase 4.

#### Tier 1 — Pure copy/icon/link (mechanical, ≤30 min each)

**Item 1 — DEBT-053: Bell icon emoji → lucide (5 min)**
- File: `app/(org)/layout.tsx`, `app/portal/layout.tsx` (both have the bell)
- Change: Swap `🔔` emoji for `<Bell className="size-4" />` from `lucide-react` (already a dep)
- Match sizing/spacing pattern from existing Conversations link
- Tests: none
- Commit: `Closes DEBT-053 → DEBT-R007: swap bell emoji for lucide Bell icon`

**Item 2 — DEBT-050: Misleading stakeholder signup copy (10 min)**
- File: Stakeholder signup form component (location TBD during fix — search for "check your email to confirm" string)
- Change: Replace post-submit copy with "Welcome — you're signed in. Redirecting to your portal..." with a fallback link
- Tests: none
- Commit: `Closes DEBT-050 → DEBT-R008: update stakeholder signup post-submit copy`

**Item 3 — DEBT-051: Stakeholder portal nav missing Settings link (10 min)**
- File: `app/portal/layout.tsx`
- Change: Add `<Link href="/portal/settings/notifications">Settings</Link>` to portal nav. Match pattern of existing Projects/Conversations/Notifications links.
- Tests: none
- Commit: `Closes DEBT-051 → DEBT-R009: add Settings link to portal nav`

**Item 4 — DEBT-040: "Create your own firm" link on /portal/projects (30 min)**
- File: `app/portal/projects/page.tsx`
- Change: Add a button/link visible on the page ("Create your own firm" → `/onboarding`). Per fix sketch: "should also apply some lightweight confirmation state on the wizard when called from this path (the audit metadata already flags it; UX should match)."
- Tests: none
- Commit: `Closes DEBT-040 → DEBT-R010: add Create-your-own-firm link to portal projects`

#### Tier 2 — Small logic changes (15-30 min each, 3 require unit tests)

**Item 5 — DEBT-052: "Direct" conversation label fix (20 min + unit test)**
- File: `components/conversations/ConversationsInbox.tsx` (function `deriveTitle`)
- Change: Compute label based on current participant count rather than `conversation.type`. Per fix sketch option (b): "compute the label based on current participant count rather than `type`. (b) is cleaner — `type` becomes pure history."
- Logic: if participant count > 2, label as "Group" or similar; else "Direct" (or 1:1 participant name)
- Tests: **Add unit test for `deriveTitle` function** — assert correct labels for 2-participant and 3+-participant cases. Place in `tests/components/` or wherever similar unit tests live (check repo convention first).
- Commit: `Closes DEBT-052 → DEBT-R011: derive conversation label from participant count, not type`

**Item 6 — DEBT-054: Empty-state layout (30 min)**
- File: `components/conversations/ConversationDetailClient.tsx`
- Change: Conditional layout — when message list is empty, render empty-state copy inline with the composer rather than as flex-fill placeholder. Composer should NOT be pushed to viewport bottom.
- Tests: none (visual verification in Phase F)
- Commit: `Closes DEBT-054 → DEBT-R012: compact empty-state layout in ConversationDetailClient`

**Item 7 — DEBT-036: File download opens in new tab (30 min + unit test)**
- File: `actions/files.ts` (`getDownloadUrl`); secondarily `components/files/FileRow.tsx` (`handleDownload`)
- Change: Per fix sketch option (b) — use Supabase's `createSignedUrl(path, expiresIn, { download: filename })` option in `getDownloadUrl`. Server-side adds the Content-Disposition header. Cleaner than client-side `<a download>` workaround.
- Tests: **Add unit test asserting `getDownloadUrl` returned URL contains the disposition param** (e.g., `?download=<encoded-filename>`)
- Commit: `Closes DEBT-036 → DEBT-R013: pass download filename to signed URL for save vs open`

#### Tier 3 — Medium-severity bug fixes (Option B inclusion, ~2-3 hours combined)

**Item 8 — DEBT-039: Multi-file selection picker fails (30-60 min + unit test)**
- File: `components/files/FileUploadZone.tsx`
- Change per fix sketch:
  1. Verify `<input type="file" multiple>` is set
  2. Consolidate click and drop handlers to call the same internal `handleFiles(fileList)` helper
  3. Both should iterate over the files collection consistently
- Tests: **Add unit test that `handleFiles` correctly iterates a multi-file `FileList`** — assert all files in queue, not just first
- Commit: `Closes DEBT-039 → DEBT-R014: consolidate FileUploadZone click + drop handlers for multi-file`

**Item 9 — DEBT-038: Project-create form doesn't send invitation emails (1-2 hours + regression test)**
- Files: `actions/projects.ts` (project-create flow), `actions/stakeholders.ts` (`inviteStakeholder`)
- Change per fix sketch: Audit both code paths. Consolidate to a single `addStakeholder` helper (or have project-create call `inviteStakeholder` directly) that always fires email + audit log + Resend send. Both code paths must use the same helper.
- Tests: **Add regression test in `tests/actions/projects.test.ts` asserting that creating a project WITH a stakeholder also creates an `outbound_emails` row.**
- Note: This may surface a refactor — if the existing `inviteStakeholder` action signature doesn't compose cleanly with project-create's stakeholder-attachment flow, STOP and surface to me before proceeding.
- Commit: `Closes DEBT-038 → DEBT-R015: route project-create stakeholder add through inviteStakeholder helper`

### Phase 3 — Full test suite (10 min)
After all 9 commits:
- `npx tsc --noEmit` → must be clean
- `npm run test:actions` → expected: previous count + 4 (1 each from DEBT-052, 036, 039, 038)
- `npm run test:rls` → expected: unchanged
- `npm run test:cloud-smoke` → expected: unchanged

If anything fails, fix in a follow-up commit on the same item or surface to me. Stop on persistent failure.

### Phase 4 — Push + wait for Vercel preview (5 min wait)
- `git push -u origin phase-f-ux-polish-bundle`
- Wait for Vercel preview deploy to go "Ready"

### Phase 5 — Phase F spot-check on Vercel preview (45 min)
Per-item manual verification. Most items are visual — refresh page, look, confirm.

| Item | Verification flow |
|---|---|
| DEBT-053 | Visit `/dashboard` and `/portal/projects` — bell icon is lucide-style, not emoji. Same visual weight as adjacent nav icons. |
| DEBT-050 | Trigger stakeholder signup flow (use a fresh `+something@gmail.com` email). After submit, confirm copy matches "Welcome — you're signed in..." Not "check email to confirm." |
| DEBT-051 | Open `/portal/projects` — confirm "Settings" link is visible in portal nav. Click it — lands on `/portal/settings/notifications`. |
| DEBT-040 | Open `/portal/projects` — confirm "Create your own firm" link/button is visible. Click it — lands on `/onboarding`. |
| DEBT-052 | Open a `one_to_one` conversation. Add a 3rd participant via UI (org-side). Return to inbox — label should NOT say "Direct" (should say "Group" or compute from participant count). |
| DEBT-054 | Create a new empty conversation (no messages yet). Open it — empty-state copy + composer should be visually compact, composer NOT pushed to viewport bottom. |
| DEBT-036 | On any project, click a file's download icon — file should download (browser Save dialog or auto-save to Downloads), NOT open in a new browser tab. |
| DEBT-039 | On any project, click "Choose files" button (not drag-drop). Select 3+ files via picker. Confirm all selected files appear in upload queue (not just one). |
| DEBT-038 | Create a new project with a stakeholder attached via the create form. Confirm invitation email arrives in stakeholder inbox within ~1 min. |

Pass/Fail report per item. Stop on any fail for diagnosis before Phase 6.

### Phase 6 — Docs (20 min)

**`DEBT-LOG.md`:**
- Move all 9 closed entries to "Resolved Debt" section as DEBT-R007 through DEBT-R015 (sequential)
- Each gets resolution paragraph + commit ref + Phase F verification note
- Format consistency with existing DEBT-R001 through DEBT-R006 entries

**`ARCHITECTURE-saas.md`:**
- §35.11: Add a new row (after row 4 which currently shows DEBT-R006) for "Phase F UX polish bundle — shipped" with commit refs + list of closed DEBT entries
- No §12 or other section updates needed (no architectural changes)
- Bump "last updated" date if convention requires (check existing pattern)

**`SESSION-11-HANDOVER.md`:**
- "Open follow-up" section: Strikethrough the "Phase F UX polish bundle" bullet, replace with "Shipped 15 May 2026 — see PHASE-F-UX-POLISH-BUNDLE branch + tag `phase-f-polish-shipped`"

**No SKILL.md changes.** (No new patterns.)
**No DECISIONS.md changes.** (No ADRs.)

Commit message: `docs: Phase F UX polish bundle close-out (DEBT-R007 through R015 + §35.11 carryover)`

### Phase 7 — PR + merge (10 min)
- PR title: `Phase F UX polish bundle: close 9 small DEBT entries (pre-launch readiness pass)`
- PR body must include:
  - Summary: scope (9 items, Option B), why pre-launch, what's closed
  - Per-item summary table (DEBT number, title, fix shape, test added Y/N, Phase F verification result)
  - Test counts: before vs after
  - Phase F: PASS confirmation per item
  - Docs updated
  - New DEBT entries filed (none expected, but if any surfaced during fixes, list here)
- Squash merge to main
- Tag merge commit `phase-f-polish-shipped`, push tag
- Branch preserved on origin (do NOT delete)

---

## Verification checklist before "ready to merge"

- [ ] Pre-fix tag `pre-phase-f-polish` exists on origin at `92287f0`
- [ ] All 9 scoped DEBT entries fixed
- [ ] Per-DEBT commits, one per DEBT, each with proper closure message
- [ ] All 4 regression tests added and passing (DEBT-052, 036, 039, 038)
- [ ] Full suite green: TypeScript clean, actions +4, RLS unchanged, cloud-smoke unchanged
- [ ] Phase F on Vercel preview: all 9 items verified PASS
- [ ] All 9 closed DEBTs moved to Resolved as DEBT-R007 through DEBT-R015
- [ ] ARCHITECTURE-saas.md §35.11 updated with new "Phase F polish shipped" row
- [ ] SESSION-11-HANDOVER.md "Open follow-up" updated (strikethrough on polish bundle)
- [ ] PR opened with full per-item table + Phase F results
- [ ] Squash merged to main
- [ ] `phase-f-polish-shipped` tag pushed to origin
- [ ] Branch preserved on origin

---

## Out of scope (explicitly deferred)

- **DEBT-048** (team-internal conversations) — new feature; ~2-3 hours; file as standalone feature session
- **DEBT-055** (unread badge count inflated) — needs Sentry instrumentation + repro work; ~1-2 hours
- **DEBT-062** (Chrome profile onboarding redirect) — needs reproducer first
- **DEBT-035** (file restore UI) — adds new admin surface, larger scope
- **DEBT-060 + DEBT-061** (conversation pooler-bypass) — separate mini-session, similar shape to DEBT-059
- **DEBT-058** (Realtime root cause) — diagnosis-class work
- **DEBT-029** (Realtime not auto-updating message UI) — same diagnosis class as DEBT-058
- **DEBT-031** (unread badge + per-row indicator) — partial overlap with DEBT-055, defer to investigation session
- **DEBT-041** (`/select-context` page for dual-context users) — adds new page surface
- **DEBT-030** (project detail conversations deep-link) — UX feature decision, not polish

---

## Cross-references

- `DEBT-LOG.md` — 9 candidate entries (048→deferred; 050, 051, 052, 053, 054, 055→deferred, 036, 040, 039, 038)
- `ARCHITECTURE-saas.md` §35.11 row 4 (DEBT-R006 closure for context)
- `SESSION-11-HANDOVER.md` (Open follow-up section)
- Pre-existing convention: `debt-026-get-app-url` (PR #9), `debt-043-pkce-branch-url` (PR #11), `debt-059-stakeholder-files-filter` (PR #13) — all branches preserved post-merge
- Tag chain: `pre-mini-debt-059` → `mini-debt-059-shipped` → `pre-phase-f-polish` → `phase-f-polish-shipped`
