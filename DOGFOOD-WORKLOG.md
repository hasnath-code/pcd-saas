# Dogfood Worklog

_Started 18 May 2026. The running record of the PCD Portal MVP **dogfood phase** —
the open-ended period where the app is exercised by its first two real users
before any commercial-launch decision is made. See `pre-launch-sprint-scope.md` §1._

---

## How to use this

This is a **worklog, not a spec**. It has three living sections — append to them
freely, don't reorganise. The file is the canvas; you fill it in as you use the app.

- **Verified end-to-end** — capabilities you have personally driven through the
  real deployed app, start to finish, and confirmed work. Add a row when you've
  *actually done the thing* — not when you think it should work.
- **Findings** — anything that felt wrong, missing, confusing, or broke. Use the
  format below. Keep it raw — a finding is an observation, not a ticket. When a
  finding turns out to be a real bug, graduate it to `DEBT-LOG.md` with a DEBT id
  and note that id next to the finding here.
- **Decisions deferred** — design questions the dogfood surfaced that we chose
  *not* to answer mid-use. Park them for the post-dogfood brainstorm.

When the dogfood phase ends, this file is the raw material for the scope
conversation that decides what the commercial readiness sprint contains.

### Findings format

Lock this shape so the log stays readable across weeks of accumulation:

```
YYYY-MM-DD · @who · severity · surface · one-line summary
  <2-4 lines of detail: what you did, what happened, what you expected>
  [DEBT-NNN]   <- add once graduated to DEBT-LOG.md
```

**Severity:**

| Severity | Meaning |
|---|---|
| `blocker` | Couldn't complete the workflow at all. |
| `annoying` | Completed the workflow, but the experience was rough. |
| `minor` | Noticed it, worked around it. |
| `wishlist` | Wouldn't call it broken, but... |

**`surface`** — one word for where it happened: `portal`, `dashboard`, `invite`,
`email`, `conversations`, `documents`, `notifications`, etc.

**`@who`** — `@maintainer` or `@hasnath`.

---

## Who & what

- **Testers:** the maintainer + Hasnath.
- **Under test:** the deployed PCD Portal SaaS, on free tiers — org-side
  (`/dashboard`: projects, conversations, documents) and stakeholder-side
  (`/portal/*`).
- **Phase:** indefinite. No launch deadline; the dogfood runs until scope is
  re-decided.

### Free-tier capability checklist

What the dogfood *can* exercise without a paid upgrade. Tick as confirmed (and
also add a row under **Verified end-to-end**):

- [ ] Org sign-up / sign-in / magic link
- [ ] Create project, workflow, milestones
- [ ] Invite a stakeholder (to a `@plancraftdaily.co.uk` recipient — see below)
- [ ] Stakeholder accepts the invite, lands in `/portal`
- [ ] Conversations + messages, both directions
- [ ] File upload / download
- [ ] Quote / invoice / receipt — create, send, view in portal
- [ ] Notifications — in-app + email (to a verified-domain recipient)
- [ ] Activity timeline + per-stakeholder financial visibility
- [ ] Message rate limiting trips on a rapid send burst (DEBT-021, shipped S2)

### Not testable on free tier — deferred to the commercial readiness sprint

These are **known-blocked, not bugs**. Don't burn cycles trying to verify them:

- **External-domain email sends.** Stakeholder-invite and notification email to
  arbitrary external addresses (`@gmail.com`, `@outlook.com`, …) fails — Resend's
  free tier 403s any recipient that isn't the Resend account-owner address or a
  `@plancraftdaily.co.uk` address. Use `@plancraftdaily.co.uk` inboxes as test
  recipients (plus-aliases of the verified domain work fine). **DEBT-024.**
- **Real-time conversation updates faster than ~30s.** New messages surface via a
  30s polling fallback, not live Realtime — a thread won't update instantly. The
  polling fallback works; the instant-update path does not. **DEBT-029 / DEBT-058.**

---

## Verified end-to-end

_Empty — add a row when you've driven a capability through the real app._

| Date | Who | Capability | Notes |
|---|---|---|---|

---

## Findings

_Empty — use the format in "How to use this" above. One finding per entry; keep it raw._

---

## Decisions deferred

_Empty — design questions surfaced during use, parked for the post-dogfood brainstorm._
