# PCD Portal SaaS — Claude Code Project Memory

This file loads at the start of every Claude Code session. It is the building-brain
counterpart to the `pcd-portal-dev` planning skill (which lives in the Claude.ai
project, not here). Keep it project-wide; task-specific detail goes in the session prompt.

## Source of truth

- **`ARCHITECTURE-saas.md`** — the authoritative spec for this codebase: schema, RLS
  conventions, server-action shape, the 27 Hard Rules, ADRs, session carryovers.
  **Read the sections named in the session prompt before writing any code.**
- The Apps Script `ARCHITECTURE.md` (if present) is a **frozen reference** only — it
  describes V2 behaviour being ported. Never build against it.

## Hard Rules (from `ARCHITECTURE-saas.md` §4 + §30 — read the full list there)

1. **Schema is forever.** Phase 1c is closed. Every change is additive — new tables,
   new nullable columns. No drops, renames, or type narrowing.
2. **RLS first.** Every new table: RLS enabled + four per-command policies
   (SELECT/INSERT/UPDATE/DELETE, never `FOR ALL`) + a cross-org isolation test.
   Missing any of the three blocks the merge.
3. **Soft-delete by default** — `deleted_at timestamptz`; default queries filter `IS NULL`.
4. **Audit on writes** to financial / stakeholder / document / billing / org data.
5. **Stakeholder ≠ user** — `clients` and `users` are separate primitives. Never conflated.
6. **No client-side writes** — all mutations through Next.js server actions.
7. **Token-gated routes are never auth-walled** — token validity gates them, not `auth.uid()`.
8. **Post-commit dispatch** (ADR-033) — notification fan-out + outbound email run *after*
   the action's transaction commits; per-recipient failures are isolated to Sentry and
   never roll back the domain write.
9. **Commit before each significant change** — `git add -A && git commit -m "before <x>"`.
10. **Don't break Phase 1a/1b/1c.** Existing tables, RLS, actions, and tests stay green.

## Patterns to reuse (don't reinvent)

- **Server action shape** — `ARCHITECTURE-saas.md` §20: validate (Zod) → auth → feature
  check → authz → mutate → activity log → audit log → post-commit dispatch. Reads go in
  `db/queries/`, not actions.
- **RLS policy naming** — `<table>_<operation>_<scope>`.
- **RLS test** — two-org fixture, `__tests__/rls/<table>.test.ts`, cross-org isolation case.
- **Query-layer visibility flag** — required `visibleOnly: boolean` on stakeholder-reachable
  queries (the Drizzle pooler bypasses RLS; this is defense-in-depth). See `db/queries/files.ts`.
- **Token-gated public route** — `ARCHITECTURE-saas.md` §25; `/q/[token]`, `/i/[token]`,
  `/r/[token]`; missing/invalid token = 404.
- **Migrations** — `db/migrations/NNNN_<verb_noun>.sql`, zero-padded, one logical change each.
- **Enums** — text columns with CHECK constraints, never Postgres enums (ADR-008).
- **IDs** — `uuid PRIMARY KEY DEFAULT gen_uuid_v7()`. Timestamps `timestamptz`, UTC, `_at` suffix.

## Workflow

- Always show a plan before coding when the prompt asks for it.
- Run `npm run test:rls`, `npm run test:actions`, the cloud-smoke suite, `npm run build`,
  and `npx tsc --noEmit` before declaring a session done.
- At the end of a session, write a handover note and list the `ARCHITECTURE-saas.md`
  deltas (new tables, RLS, actions, ADRs) for the maintainer to fold in.
