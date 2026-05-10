# DEBT-037 Investigation Report

**Date:** 10 May 2026
**Author:** Hotfix session (Claude Code)
**Severity:** HIGH — security / product (tenancy violation)
**Branch:** `hotfix/debt-037-stakeholder-routing`
**Pre-fix tag:** `pre-debt-037-hotfix` at `8ac9c0c`
**Supersedes:** DEBT-034 (closed in this hotfix)
**Blocks:** Session 11 (notifications + activity)

---

## Bug summary

A user invited as an external stakeholder (only has a `clients` row, no `users` row, never previously been a team member) clicks their magic link, signs in, and is silently made the owner of a brand-new organization. Confirmed end-to-end on the 10 May 2026 production smoke test (sarhads@plancraftdaily.co.uk → saliqueh@plancraftdaily.co.uk). The bug violates `ARCHITECTURE-saas.md` §8 (Auth Model) — the post-auth callback is supposed to **link** the existing `clients` row to the new auth identity (Sarah Step 7), not silently spawn an organization.

Three impact dimensions:

- **Tenancy.** An external collaborator becomes owner of a tenant they did not ask to create, gaining owner-level powers (invite users, manage settings, future billing) over a tenancy that should not exist.
- **Data integrity.** Orphan `organizations` rows accumulate with no business identity — pollutes analytics, admin views, and any future Stripe seat-count billing path.
- **Trust / UX.** "I clicked the link to view a project I was invited to" must never silently create a corporation.

---

## §8 contract being violated

`ARCHITECTURE-saas.md` §8 specifies the three identity primitives:

```
auth.users          ← Supabase Auth identity (email, password, magic link sessions)
   │
   ├── users        ← Org member (one row per (auth_user, org) pair)
   │
   └── clients      ← Stakeholder identity (one row globally, multi-org collaboration)
```

The Sarah lifecycle worked example:

- **T+1, Step 7:** "Post-auth callback: app finds `clients` row by email, sets `auth_user_id = auth1`."
- **T+1, Step 9:** "Redirects Sarah to client portal placeholder. She sees Project P1."
- **T+6m, Steps 13–17:** Org creation happens **only** via the explicit signup wizard with full user intent (org type + name + plan).

Production behavior today: Step 7 never executes for the generic magic-link path. Step 9 sends the user to `/dashboard`, which then bridges them into `/onboarding`, which auto-renders the wizard, which calls `createOrganization` without checking for stakeholder identity. The §8 link helper exists (`actions/stakeholders.ts:402-409`) but is reachable only through the literal invitation acceptance URL (`/invitations/[token]/accept`).

---

## Call-chain trace (the bug path)

For a user with only a `clients` row (no `users` row):

1. **Magic-link email click** → `/auth/callback?code=<code>&next=/dashboard` (or `/auth/callback?code=<code>` defaulting `next` to `/dashboard`).
2. **`app/auth/callback/route.ts:7-26`** — minimal PKCE exchanger:
   - Calls `supabase.auth.exchangeCodeForSession(code)` (line 17)
   - Redirects to `?next ?? '/dashboard'` (line 25)
   - **Does NOT** look up `clients` by email
   - **Does NOT** set `clients.auth_user_id`
   - **Does NOT** differentiate stakeholder vs team-member identities
3. **`app/(org)/dashboard/page.tsx:15-18`** — dashboard guard:
   - `requireAuthOrRedirect()` returns the auth user
   - `getMyOrg(authUser.id)` returns `null` (no `users` row)
   - `if (!myOrg) redirect('/onboarding')` → user pushed to onboarding
4. **`app/(onboarding)/onboarding/page.tsx:11-25`** — onboarding root:
   - `requireAuthOrRedirect()` returns the auth user
   - `authUserHasMembership(user.id)` returns `false` (no `users` row)
   - Renders `OrgTypePicker` — user clicks an org type
5. **`app/(onboarding)/onboarding/[orgType]/page.tsx:24-53`** — org-type page:
   - Same `authUserHasMembership` guard (no membership → falls through)
   - Renders `<CreateOrgForm>`
6. **`components/onboarding/CreateOrgForm.tsx:56-71`** — form submit:
   - Calls `createOrganization({ orgTypeSlug, ownerName, name })`
   - Pushes `/dashboard` on success
7. **`actions/orgs.ts:48-154`** — `createOrganization`:
   - `requireAuth()` returns auth user
   - Zod validation passes (input has all required fields)
   - **Existing guard at line 68-70** only checks `authUserHasMembership` (`users` row presence) — STAKEHOLDER (`clients` row) IS NOT CHECKED → guard passes
   - Drizzle transaction inserts `organizations` + `users` (role `owner`) + clones Simple workflow + 5 stages
   - Stakeholder is now silently owner of a brand-new organization

---

## File:line citations of the offending sites

| File | Lines | Issue |
|---|---|---|
| `app/auth/callback/route.ts` | 7-26 | Context-blind PKCE exchanger. Does not implement §8 Step 7 link or identity-based routing. |
| `actions/auth.ts` | 89 | Password sign-in does `redirect(safeNext(...))` directly, bypassing any identity-aware routing. |
| `actions/auth.ts` | 64 | `signUp` defaults `next` to `/dashboard`, leading orphan signups through the dashboard bridge. |
| `app/page.tsx` | 17-21 | Root page falls through to `/onboarding` for any authed user without a `users` row — does not probe `clients`. |
| `app/(org)/dashboard/page.tsx` | 18 | The bridge: any authed user without a `users` row is redirected to `/onboarding` regardless of stakeholder identity. |
| `actions/orgs.ts` | 68-70 | `createOrganization` guard checks `authUserHasMembership` (users row) only. Does not check `clients` row. |
| `actions/orgs.ts` | 29-33 | `CreateOrgInput` Zod schema has no `intent` discriminator — any caller with the right field shape can invoke. |
| `actions/stakeholders.ts` | 402-409 | The §8-correct `clients.auth_user_id` link helper exists, but is reachable only through `/invitations/[token]/accept`. |

---

## Root-cause statement

The post-auth callback at `app/auth/callback/route.ts:7-26` is a context-blind PKCE exchanger that always redirects to `/dashboard` (or any caller-supplied `?next`), and the dashboard's missing-membership branch sends the user to `/onboarding`, which auto-renders the org-creation wizard. A stakeholder-only auth user (has `clients` row, no `users` row) traverses Auth callback → `/dashboard` → `/onboarding` → `/onboarding/[orgType]` form → `createOrganization`, and `createOrganization`'s sole guard (`authUserHasMembership`) is blind to stakeholder identities, so the org is created with the stakeholder as owner. The §8-correct linker (`acceptStakeholderInvitation`) exists but is reachable only through `/invitations/[token]/accept`, not through the generic auth callback path, so `clients.auth_user_id` is never backfilled on the magic-link or password sign-in paths.

The fix restores the §8 contract via a single `pickDestination` helper that owns post-auth routing (replacing all direct `redirect(safeNext(...))` calls in auth actions), a `resolvePostAuthIdentity` helper that backfills `clients.auth_user_id` when applicable, and a Zod `intent: 'wizard_signup'` discriminator on `createOrganization` to make silent invocation a runtime validation failure.

---

## Production cleanup candidates

The following SQL identifies organizations whose owner has a matching `clients` row — the fingerprint of a bug victim:

```sql
SELECT o.id, o.name, o.created_at, u.auth_user_id, u.role,
       c.id AS client_id, c.email AS client_email
FROM organizations o
JOIN users u ON u.org_id = o.id
LEFT JOIN clients c ON c.auth_user_id = u.auth_user_id
WHERE o.deleted_at IS NULL
  AND c.id IS NOT NULL
  AND u.role = 'owner'
ORDER BY o.created_at DESC;
```

**Candidate count:** **2.** Output JSON committed to `scripts/debt-037-cleanup-candidates.json`.

| Org name | Org id | Created | Owner email | Notes |
|---|---|---|---|---|
| PCD | `019dff4a-a1a1-72e8-bc12-150f540c3adb` | 2026-05-06 21:56 UTC | `sarhads@plancraftdaily.co.uk` | Same email as the kickoff brief's named test stakeholder. |
| Plan Daily | `019df7f8-6c0c-7489-a865-d280d4a09755` | 2026-05-05 11:49 UTC | `saliqueh@plancraftdaily.co.uk` | Same email as the currently authenticated session's user. |

False-positive risk: a legitimate dual-context owner (Sarah Step 2 — stakeholder who deliberately created their own firm via the wizard) would also match this query. **Both candidates need manual review before `--apply`** — at least one corresponds to the current session's user, who may be a legitimate dual-context owner rather than a bug victim. The Phase 4 cleanup script's per-row pre-flight STOPs the deletion if the org has any associated `projects` / `conversations` / `messages` / `project_files` (which a real Sarah-Step-2 org would have started accumulating).

---

## Cleanup result

_To be filled in after Phase 4.4 `--apply` run: count deleted, timestamp, snapshot CSV path, any rows skipped (with org_id + skip reason)._
