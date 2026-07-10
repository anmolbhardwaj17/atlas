# RBAC audit — UI + API role enforcement (2026-07-10)

> Requested by the product owner: "check that from UI and API these things work correctly — e.g. a
> Member cannot change the company logo." Full sweep of every role-gated action on **both** sides
> (API guard AND UI affordance), looking for mismatches. **Result: no holes found.** RBAC is enforced
> server-side on every sensitive mutation, Owner-protection is correct, and the UI hides/disables each
> Admin-only control for Members to match. A few by-design policy notes at the bottom.

## Role model
`Member(1) < Admin(2) < Owner(3)` (`auth/roles.guard.ts`). `@Roles(min)` enforces the minimum against
`req.org.role`, which `TenantScopeGuard` resolves **live per request** from the DB membership (not
from the client). No `@Roles` ⇒ any active member. **The API is the security boundary; the UI gating
is UX** — a Member who forces a hidden control still gets a `403 insufficient_role`.

## API enforcement matrix (mutations)
| Action | Endpoint | Guard | UI control | UI gated? |
|---|---|---|---|---|
| Change org name/logo | `PATCH /orgs/:id` | **Admin** | Settings → Organization "Edit" | ✅ `OrgCard canEdit={isAdmin}` — whole edit affordance hidden; logo picker only in edit mode |
| Change a member's role | `PATCH /orgs/:id/members/:userId` | **Admin** (+Owner rules) | Org panel role menu | ✅ `isAdmin`, per-member `canManage` |
| Remove a member | `DELETE /orgs/:id/members/:userId` | **Admin** (+Owner rules) | Org panel remove | ✅ `isAdmin` + Owner-protection mirrored |
| Invite a member | `POST /orgs/:id/invitations` | **Admin** | Org panel invite form | ✅ `{isAdmin ? …}` |
| List / revoke invites | `GET`/`DELETE …/invitations` | **Admin** | Org panel invites | ✅ `isAdmin` |
| Connect a source | `POST /connections` | **Admin** | Integrations connect | ✅ `canManage` threaded through hub |
| Verify / sync / disconnect | `POST …/verify`,`/sync`, `DELETE …` | **Admin** | Integrations manage | ✅ `canManage` |
| Set / clear AI (BYO-LLM) key | `PUT`/`DELETE /ai/settings` | **Admin** | Settings → AI card | ✅ card only renders when `isAdmin` |
| View audit log | `GET /audit` | **Admin** | Settings → Activity | ✅ `securitySlot` only when `isAdmin` |
| Add / test / remove alert channel | `POST`/`DELETE /notifications/channels…` | **Admin** | Integrations → Alerts | ✅ `canManage` |
| Trigger a sync from the dashboard | (`/connections/:id/sync`) | **Admin** | `RefreshLatest` | ✅ `{canManage ? <RefreshLatest/> …}` |
| Seed demo data | `POST /demo/seed` | **Admin** | Onboarding | ✅ `canSeed = Owner|Admin` |
| Create an org | `POST /orgs` | AuthGuard only | Create-org form | ✅ correct — no org exists yet; creator becomes Owner |
| Edit your own profile | `PATCH /me` | AuthGuard only | Profile card | ✅ correct — self, no org role needed |

### Owner-protection (BR-MEM-2/3, `org.service.ts`) — all server-enforced
- Only an **Owner** can modify an Owner (an Admin cannot demote/remove the Owner).
- Only an **Owner** can grant the Owner role (no Admin self-escalation to Owner).
- Never demote or remove the **last Owner** (`ownerCount() <= 1` → refused).

### Member-allowed writes — intra-org collaboration, by design (not gaps)
- Mute / unmute a finding (`POST`/`DELETE /insights/:id/mute`) — Member. Accept-risk is a shared org
  decision; org-scoped, reversible. *Policy note: could be raised to Admin if muting should be a
  governance action — product call, not a security bug.*
- Create / delete / message AI conversations — Member. **AI conversations are ORG-SHARED by design**
  (`listConversations` returns all `org_id` rows; `created_by` is recorded but reads/deletes are
  org-scoped, not user-scoped), so any member managing any conversation is consistent — not an IDOR.
- Mark notifications read (`/notifications/inbox…`) — Member. The inbox is an org-level shared feed.

## Cross-checks performed
- Every `POST`/`PUT`/`PATCH`/`DELETE` route enumerated; each sensitive one carries `@Roles("Admin")`.
  No mutation is missing a role guard where one is expected.
- The command palette exposes **navigation + search only** — no privileged mutations. Navigating a
  Member to `/settings` or `/integrations` is fine; those pages render read-only for them.
- UI `role` originates from `requireShell()` → `/me` (server-verified membership), not client input.
- No mismatch in either direction: no control the UI shows but the API blocks (dead/confusing), and
  no action the API allows that the UI wrongly hides.

## Verdict
**RBAC is solid on both layers.** The user's example — a Member cannot change the company logo — is
enforced twice: `PATCH /orgs/:id` is Admin-only, and `OrgCard` renders no edit affordance for a
Member. Nothing to fix. The only open items are the two **policy** questions above (mute = Member?;
AI conversations org-shared vs private), which are product decisions, not defects.

### ⏳ Deferred (user, 2026-07-10) — live browser verification
This audit is **code-level** (guards + UI conditionals + reasoning), not a live click-through. A
follow-up pass — sign in as a Member and confirm the UI hides every Admin control and a direct API
call returns 403 — is parked for later (needs a Member test account + the user's go-ahead per the
browser-verification preference).

### Suggested (optional) hardening for regression safety
- The generic guard logic is unit-tested (`roles.guard.test.ts`, `tenant-scope.guard.test.ts`). The
  **Owner-protection** rules in `org.service` (BR-MEM-2/3) are only covered by DB-gated integration
  tests — worth a focused test if that logic is ever refactored.
