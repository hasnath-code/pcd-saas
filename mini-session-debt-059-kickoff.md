# MINI-SESSION-DEBT-059 — Kickoff

**Status:** Approved, ready to execute
**Created:** 14 May 2026
**Scope:** Close DEBT-059 (HIGH — pooler-bypass in `listFilesForProject`) plus codebase audit for the same pattern class
**Estimated time:** 60–90 min total
**Branch:** `debt-059-stakeholder-files-filter`
**Pre-fix tag:** `pre-mini-debt-059` at `36dd5a2` (current main HEAD)
**Merge tag (post-ship):** `mini-debt-059-shipped`
**Merge convention:** Squash merge to main, branch preserved on origin (matches `debt-026` / `debt-043` / `docs/debt-037-hotfix-closeout` precedent)

---

## The bug (one paragraph)

`db/queries/files.ts:listFilesForProject` uses the Drizzle pooler `db` which connects as the `postgres` role and **bypasses RLS**. The function currently filters only on `project_id` and `deleted_at IS NULL`. The SELECT policy on `project_files` (ARCHITECTURE-saas.md §12.4) would normally hide `visibility = 'org_only'` rows from stakeholders — but since RLS is bypassed at the pooler, stakeholders viewing `/portal/projects/[projectId]` may receive `org_only` rows in production. The fix is an explicit visibility filter at the query layer.

**Reference implementation:** `db/queries/project-activity.ts:listProjectActivity` already has a `visibleOnly` boolean flag that does this correctly — Session 11 Phase 9 wrote it that way precisely because this bug shape was identified during the implementation. The file query needs the same treatment.

---

## Pre-flight decisions (LOCKED)

### Decision 1: Filter location → (a) Query-layer
Add a `visibleOnly: boolean` parameter to query functions in stakeholder-reachable code paths. The caller (action or page) decides based on its own `requireStakeholder()` vs `requireUser()` context. Same shape as `listProjectActivity`'s `visibleOnly` flag — do not invent a new pattern.

### Decision 2: Audit scope → (b) Full audit + fix
Inventory ALL `db/queries/*.ts` files. For each function, determine: (a) does it use the Drizzle pooler `db`? (b) does it get called from a `requireStakeholder` code path? (c) does it apply explicit visibility filtering? Fix everything that's missing the filter. **Audit is time-boxed to 20 minutes.** If audit returns clean except for `listFilesForProject`, the mini-session shortens accordingly.

### Decision 3: SKILL Hard Rule 28 / ADR-034 → Deferred to Phase 5
Decision depends on what Phase 1 audit finds:

| Audit finding | Phase 5 action |
|---|---|
| 1 bug (just `listFilesForProject`) | Close DEBT-059, cross-ref the `listProjectActivity` pattern from `listFilesForProject` as canonical reference. No new rule, no new ADR. |
| 2 bugs | Add SKILL Hard Rule 28: "Queries used in `requireStakeholder` context MUST apply explicit visibility filters at the query layer; never rely on pooler-bypassed RLS for stakeholder visibility enforcement." Bump SKILL.md to v3.8. |
| 3+ bugs | Add ADR-034 (canonical pattern doc) + Hard Rule 28. Systemic-ness warrants formal architectural enshrinement. |

---

## Hard rules for this mini-session

1. **No scope expansion.** Do not fix the 10 deferred DEBT entries (048, 050–058). Mini-session scope is the pooler-bypass-of-RLS class only. If you spot something else broken during the audit, file a new DEBT entry and move on.

2. **Match `listProjectActivity` pattern exactly.** The `visibleOnly` boolean is the reference shape. Do not invent variants — no enum, no role-detection inside the query function, no callable / strategy pattern. The caller's auth context already determines stakeholder-vs-org; the action passes the boolean.

3. **`visibleOnly` parameter is REQUIRED, not optional with default.** Forcing every caller to make the choice explicitly means TypeScript catches missed callers via signature change. A default value (e.g. `visibleOnly = false`) would silently leak `org_only` rows on any new caller that forgot to set it — exactly the bug class we're fixing.

4. **Action-layer tests, not RLS tests.** RLS policies for `project_files` are correct (verified in `tests/rls/project-files.test.ts` at Session 10 close). The bug is in the pooler-bypass query layer, not in RLS. Regression tests go in the action test suite: set up a project with both `org_only` and `org_and_stakeholders` files, call the action as a stakeholder, assert filtering.

5. **Pre-fix tag before ANY code changes.** Run `git tag pre-mini-debt-059 36dd5a2 && git push origin pre-mini-debt-059` before creating the branch. Lets us rollback cleanly if anything goes sideways.

6. **Phase F on Vercel preview, not local.** Local Realtime is broken (DEBT-058) and local OrbStack Supabase has known divergence from cloud RLS behavior. Cloud preview has the real production RLS shape. Spot-check flow specified in Phase 4.

7. **Squash merge, branch preserved.** Per `debt-026` / `debt-043` / `debt-037-hotfix` mini-session/hotfix convention. Tag merge commit `mini-debt-059-shipped`.

8. **No new env vars, no new dependencies, no new tables, no new migrations.** Pure code-layer change.

9. **Plan before coding (Hard Rule 9, carries from every session).** After reading the kickoff, output a numbered execution plan referencing the phases below. Pause for review.

---

## Phase plan

### Phase 0 — Read + plan (5 min)
Read this kickoff end-to-end. Output a numbered execution plan. Pause for approval before Phase 1.

### Phase 1 — Audit (20 min, time-boxed)
Inventory all functions in `db/queries/*.ts`. For each function, document in a table:

| Function | File | Uses pooler `db`? | Called from `requireStakeholder` path? | Has visibility filter? | Verdict |
|---|---|---|---|---|---|
| `listFilesForProject` | `db/queries/files.ts` | Y | Y (portal projects detail page) | **N** | **BUG** |
| `listProjectActivity` | `db/queries/project-activity.ts` | Y | Y | Y (`visibleOnly` flag) | SAFE |
| ... | ... | ... | ... | ... | ... |

To determine "Called from `requireStakeholder` path?": grep call sites in `actions/*.ts` and `app/portal/**/page.tsx`. Anywhere a query function is reachable from `portal/` routes or from an action that uses `requireStakeholder()` counts as a stakeholder-reachable path.

**Pause and present the inventory before Phase 2.** Do not proceed to fixes until the inventory is reviewed.

### Phase 2 — Fix (10–30 min, depending on audit results)
For each BUG-verdict query:
- Add `visibleOnly: boolean` as a required parameter.
- Apply visibility filter when `visibleOnly === true`. The filter shape matches the SELECT RLS policy on the table — for `project_files`, that's `visibility = 'org_and_stakeholders'`.
- Update all callers: stakeholder-context callers pass `visibleOnly: true`; org-context callers pass `visibleOnly: false`.
- TypeScript compiler will catch any missed caller because the parameter is required.

### Phase 3 — Tests (20–30 min)
For each fixed query, add a regression action test:
- Set up a project with one `org_only` file and one `org_and_stakeholders` file.
- Add an accepted stakeholder to the project.
- Call the listing action as the stakeholder.
- Assert: only the `org_and_stakeholders` file appears in results.
- Also call as the org user → assert both files appear.

Run full suite. Expected state after Phase 3:
- RLS tests: 221/221 unchanged (policies weren't touched).
- Action tests: 198 → 198 + N where N is one regression case per fixed function.
- Cloud-smoke: 14/14 unchanged.
- TypeScript: clean.

### Phase 4 — Phase F spot-check on Vercel preview (15 min)
Push branch, wait for preview deploy. Manual flow:

1. Org user logs in, opens a project that has at least one accepted stakeholder.
2. Uploads File A with `visibility = 'org_only'`.
3. Uploads File B with `visibility = 'org_and_stakeholders'`.
4. Verifies both files visible in org-side `/dashboard/projects/[projectId]`.
5. Org user logs out.
6. Stakeholder logs in via magic link, opens the same project at `/portal/projects/[projectId]`.
7. **Asserts:** File B visible. File A hidden.

If other queries were fixed in Phase 2, add an analogous spot-check per query (mixed-visibility data setup + stakeholder verification).

Output: Pass/Fail report with screenshot or page-state confirmation per assertion.

### Phase 5 — Docs (15 min)
Based on Phase 1 audit findings, execute the appropriate branch of Decision 3.

Always:
- `DEBT-LOG.md`: Move DEBT-059 (and any sibling bugs found) to the "Resolved Debt" section as DEBT-R006. Resolution paragraph + commit refs + Phase F result.
- `ARCHITECTURE-saas.md` §12.4: Note the `visibleOnly` filter as the canonical query pattern for stakeholder-reachable file queries. Cross-ref §14's `listProjectActivity` as the reference implementation.
- `ARCHITECTURE-saas.md` §35.11 row 4: Mark DEBT-059 as resolved with date + commit ref.
- `SESSION-11-HANDOVER.md`: Update "Open follow-up" section to mark MINI-SESSION-DEBT-059 as shipped, link to PR.

If Decision 3 lands on (b) or (c):
- `SKILL.md`: Add Hard Rule 28, bump to v3.8, add changelog entry.

If Decision 3 lands on (c):
- `DECISIONS.md`: Add ADR-034 (canonical pooler-query-filter pattern).

### Phase 6 — Merge (5 min)
- PR title: `DEBT-059: explicit stakeholder visibility filter for pooler queries`
- PR description: Audit inventory + fix summary + test additions + Phase F results.
- Squash merge to main.
- Tag merge commit `mini-debt-059-shipped`, push tag to origin.
- Branch preserved on origin (do NOT delete — mini-session/hotfix convention).

---

## Verification checklist before "ready to merge"

- [ ] Pre-fix tag `pre-mini-debt-059` exists on origin at `36dd5a2`
- [ ] Audit inventory documented and reviewed (in PR description)
- [ ] All BUG-verdict queries fixed with the `visibleOnly` pattern (required parameter, not optional)
- [ ] Regression action tests added; full suite passes (RLS 221/221, Actions 198+N, Cloud-smoke 14/14, TypeScript clean)
- [ ] Phase F spot-check on Vercel preview: `org_only` file hidden from stakeholder; `org_and_stakeholders` file visible
- [ ] DEBT-059 entry moved to Resolved as DEBT-R006
- [ ] ARCHITECTURE-saas.md §12.4 + §35.11 row 4 updated
- [ ] SESSION-11-HANDOVER.md "Open follow-up" updated
- [ ] SKILL.md bumped to v3.8 if Decision 3 ≠ (a)
- [ ] DECISIONS.md ADR-034 added if Decision 3 = (c)
- [ ] PR opened, squash-merged to main
- [ ] `mini-debt-059-shipped` tag pushed to origin
- [ ] Branch preserved on origin

---

## Out of scope (explicitly deferred)

DEBT-048 (no team-internal conversation UI), DEBT-050 (signup copy), DEBT-051 (portal Settings nav), DEBT-052 (Direct conversation label), DEBT-053 (bell styling), DEBT-054 (empty-state), DEBT-055 (badge count), DEBT-056 (acceptInvitation tx), DEBT-057 (updateMilestone scheduledAt dispatch), DEBT-058 (Realtime root cause).

All targeted for the post-mini-session Phase F UX polish bundle OR future targeted sessions.

---

## Cross-references

- `DEBT-LOG.md` → DEBT-059 (open) — full bug description
- `ARCHITECTURE-saas.md` §12.4 — `project_files` schema + RLS policy
- `ARCHITECTURE-saas.md` §14 — `listProjectActivity` reference implementation
- `ARCHITECTURE-saas.md` §35.11 row 4 — Session 11 carryover noting this debt
- `db/queries/project-activity.ts:listProjectActivity` — canonical `visibleOnly` pattern
- `db/queries/files.ts:listFilesForProject` — the broken function
- `tests/rls/project-files.test.ts` — Session 10 RLS verification (policy IS correct)
- ADR-033 + Hard Rule 27 (Session 11) — context: post-commit dispatch pattern (different bug class, similar shape)
