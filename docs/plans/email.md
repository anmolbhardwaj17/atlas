# Transactional & Lifecycle Email — Strategy (#44)

> Status: **weekly digest BUILT** (2026-07-11). The rest of the set below is designed and prioritized;
> each is a small increment on the same Resend plumbing. Docs-authoritative per CLAUDE.md rule 1.

## Delivery substrate (already in place)

- **Provider:** Resend REST (`apps/api/src/core/email.service.ts`) — no SDK; a `fetch` to `api.resend.com`.
  Behind a tiny interface so SES/others can swap in later.
- **Sender:** `EMAIL_FROM` on a verified domain (`anmolbhardwaj.com`). Resend's `onboarding@resend.dev`
  only delivers to the account owner — a verified domain is the only real fix.
- **Failure is non-fatal:** `send()` never throws; it returns `false` so the triggering request can fall
  back (e.g. a copy-link) without breaking. `RESEND_API_KEY` unset ⇒ logs instead of sends (dev).
- **One branded shell:** `emailShell()` — table layout, inlined styles, hidden preheader, VML Outlook
  button, `prefers-color-scheme` dark mode, mobile breakpoint. Every message reuses it.

## The moments worth an email

| # | Trigger | Category | Cadence | Status |
|---|---|---|---|---|
| Invite | Teammate invited to an org | Team | immediate | ✅ built (`sendInvite`) |
| Welcome | First membership created | Lifecycle | immediate | ✅ built (`sendWelcome`) |
| **Weekly digest** | Scheduled posture summary | Engagement | **weekly (Mon 14:00 UTC)** | ✅ **built** (`sendWeeklyDigest`) |
| New critical finding | A HIGH finding first appears (e.g. exposed-AND-vulnerable, root-no-MFA) | Security | immediate (per-user pref) | 📋 next |
| Compliance drift | A previously-passing control regresses | Security | immediate | 📋 |
| Sync failed / degraded | A source's sync errors or a permission is lost | Ops | immediate (dedupe) | 📋 |
| First sync complete | A newly-connected source finishes its first crawl | Lifecycle | once per connection | 📋 |
| Account/team events | Role change, removed from org | Team | immediate | 📋 (in-app today) |

**Honesty rule (P3/P4):** an email fires only on a real, cited finding. "All clear" is a first-class
state — the digest says so rather than inventing a problem. Immediate security emails must respect the
finding-trust lifecycle (no alarm on a muted/duplicate/low-confidence finding).

## Weekly digest — how it works (built)

- **Content** (`WeeklyDigestService.buildDigest`) reuses `GraphService.summary(orgId)` — the *same*
  findings, posture, and inventory the dashboard shows. Top 6 findings, each linking to
  `/insights/<id>`; open-count by severity; an averaged posture score. No separate data path.
- **Recipients** — `app_weekly_digest_recipients()` (SECURITY DEFINER, cross-org): active,
  non-opted-out members of orgs that have at least one connection (no empty-org mail).
- **Scheduling** — `WeeklyDigestBootstrap` ticks **hourly**, not on a 7-day interval (a 7-day
  `setInterval` never fires — deploys/restarts reset it). Once past the week's send moment
  (Mon 14:00 UTC), it claims the week via `app_claim_digest_period(period_key)` (atomic INSERT …
  ON CONFLICT). Only the winning caller sends ⇒ **exactly once per week across instances and
  restarts**; a late boot still catches up. Ledger table: `digest_runs` (migration 0048).
- **Opt-out** — `memberships.digest_opt_out` (migration 0047). Each digest carries a one-click
  unsubscribe: an HMAC-signed link (`?u=&o=&t=`, key = `SECRET_ENCRYPTION_KEY`) →
  `POST /email/unsubscribe` (public, token *is* the auth) → `app_digest_unsubscribe(user, org)`.
  The web `/unsubscribe` page POSTs on mount (not on GET), so link-scanners can't unsubscribe by
  accident.

## Next increment (when picked up)

Add a **per-user notification preferences** surface (immediate / digest / off, per category) and wire
the immediate security emails (new-critical-finding, compliance-drift) through it — the digest's
opt-out column is the first slice of that model. Ops emails (sync-failed) reuse the existing
health-transition feed as their trigger source.
