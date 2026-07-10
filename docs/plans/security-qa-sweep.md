# Security & QA sweep — findings (2026-07-10)

> Full leak/hollow audit of Atlas requested by the product owner, to fix on return. Six focused
> audits (tenant isolation/RLS, auth/session/secrets, injection/validation/upload, read-only P2 +
> connectors, abuse/errors/headers, QA/coverage) + manual verification of every High/Medium below.
> **No critical cross-tenant data leak was found** — the isolation model is solid. The real work is a
> cluster of **Highs around abuse/SSRF/headers** and **hollow test coverage** on auth-critical code.
>
> How to read: severity = real-world risk. Fix order at the bottom.

> ## ✅ Remediation status (2026-07-10 — all fixed except a few Lows/ops)
> **FIXED & shipped:** H1 (Jenkins SSRF guard), H2 (AI rate-limit + shared-key daily budget),
> H3 (web security headers), H4 (25 new auth/tenant/invite/upload tests), M1 (SVG dropped),
> M2 (JWT fallback hardened: pinned algs + ≥32-byte secret + key-only fallback), M3 (SSE/WS error
> sanitize), M4 (invite rate-limit + pending cap), L1 (Fastify bodyLimit), L2 (upload magic-byte
> check), L3 (atomic invite-accept), L4 (invite-token doc drift), L8 (off-host pagination guard),
> and the **startup role assertion** (fail-closed if the DB role can bypass RLS). New durable
> org-scoped rate limiter (`rate_limits`, migration 0039, applied live).
>
> **STILL OPEN (deliberately deferred — lower risk / bigger lift):**
> - **L5** — per-tenant GitHub webhook secret (today one global `GITHUB_WEBHOOK_SECRET`; no data
>   crosses, needs an unguessable connection UUID). Needs a schema + rotation story.
> - **L6** — assert `id = claims.userId` inside the SECURITY DEFINER membership/identity reads (safe
>   today; all call sites pass the auth uid). In-DB binding is a larger change.
> - **L7** — bump `postcss` (1 moderate, build-time only) + add a `pnpm audit --prod` CI job.
> - **Ops** — compile-time allowlist of permitted AWS `*Command` classes (make P2 read-only
>   unrepresentable in code); a Docker-Postgres `check:integration` so the local gate exercises RLS.
>   These are build/CI tooling, not request-path risks.

---

## 🔴 High

| # | file:line | issue | risk | fix |
|---|---|---|---|---|
| **H1** | `packages/connector-jenkins/src/config.ts:20-31` (+ `client.ts:76-79`) | `parseJenkinsConfig` validates **only** the URL scheme (http/https); no block on private/loopback/link-local hosts. The connector is *designed* to reach private networks. | **SSRF.** A tenant sets `baseUrl` to `http://169.254.169.254/…` (cloud metadata), `http://127.0.0.1:9200` (Atlas's own OpenSearch), `http://<redis>:6379`, etc.; the authenticated client fetches it and returns bodies into the graph. `client.resolve()` also passes through absolute `http…` paths, bypassing the base-URL anchor. | Reject hosts resolving to private/loopback/link-local/CGNAT/`169.254/16`/`::1`; re-check post-DNS at fetch time (rebinding); drop the absolute-URL passthrough. Apply in `parseJenkinsConfig` **and** at request time. |
| **H2** | `apps/api/src/ai/ai.controller.ts:99-148`, `ai/ai.service.ts:154-172`; **no `@nestjs/throttler` anywhere** | No rate limit on AI ask (`POST conversations/:id/messages` + `/ai/ws`); `resolveProvider` falls back to **Atlas's own Claude key** when an org has no BYO-LLM config. | **Cost-DoS on Atlas's Anthropic bill.** Any Member loops the endpoint → unbounded agentic tool-calls/tokens on the shared key, zero throttle. | Add per-org+user throttling on ask/WS; require BYO-LLM **or** a hard per-org token/$ budget before using the shared key. |
| **H3** | `apps/web/next.config.mjs` (no `headers()`), `apps/web/src/middleware.ts` | The **browser-facing** Next app ships **no** security headers — no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. (The JSON API *does* set nosniff/frame-deny/referrer in `main.ts:29-33`.) | Clickjacking (no frame-ancestors), XSS amplification (no CSP), no HSTS on the HTML app. | Add a `headers()` block / middleware: CSP with `frame-ancestors 'none'`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. |
| **H4 (QA)** | `auth/supabase-jwt.verifier.ts`, `auth/auth.guard.ts`, `auth/tenant-scope.guard.ts`, `orgs/invitation.service.ts` `accept()`, `core/image-upload.service.ts` | **Zero tests** on the most security-critical logic: JWT verify/expiry/fallback, AuthGuard, the R8 **404-vs-403** tenant-scope distinction, invite **email-match**, and the new image upload. | A refactor that breaks auth, tenant isolation, or the invite email-gate ships undetected. Most of these are pure logic (no DB needed). | Unit tests: forged/expired/wrong-iss JWT → 401; HS256 fallback only with secret; non-member path → 404, header → 403; invite mismatched/unverified email → 403; SVG/oversized/mime-mismatch upload → rejected. |

## 🟠 Medium

| # | file:line | issue | risk | fix |
|---|---|---|---|---|
| **M1** | `core/image-upload.service.ts:19,71,93` | `image/svg+xml` is accepted and stored in a **public** bucket, served **inline** with its content-type. | **Stored XSS from our infra.** An SVG logo/avatar with `<script>`/`onload` executes when its public URL is opened. Executes on the Supabase Storage origin (not the app origin → can't steal an Atlas session), but it's malicious JS served from Atlas storage, handed to every org member. App renders via `<img>` (safe) but the URL is user-navigable. | **Drop `image/svg+xml`** from the allowlist (logos/avatars don't need vector). If it must stay: sanitize (strip scripts/handlers) + set `Content-Disposition: attachment`. |
| **M2** | `auth/supabase-jwt.verifier.ts:34-46`; `config: SUPABASE_JWT_SECRET` = `optionalString` (min 1) | HS256 fallback is **unconditionally active whenever the secret is set** (even with ES256 working), no `algorithms` allowlist on `jwtVerify`, no entropy floor, and the `catch` retries HMAC on **any** primary failure (incl. transient JWKS errors). | If the project-wide static JWT secret leaks, an attacker mints an HS256 token with arbitrary `sub`/`email`/`email_verified:true` → **full impersonation** (incl. satisfying the invite email-match to join a victim's org). jose blocks classic alg-confusion today, but the weak path stays alive after migrating to ES256. | Gate the fallback behind an explicit env flag (default off); require secret ≥32 bytes when present; pin `algorithms: ["ES256"]` / `["HS256"]`; only fall back on *key-not-found*, not network errors. |
| **M3** | `ai/ai.controller.ts:137-143` | SSE error path sends `(err as Error).message` verbatim for non-`ApiException` errors — **bypasses** the sanitizing global filter. | Raw DB/provider/driver error strings reach the browser (info leak). | Surface `err.message` only for `ApiException`; else send a generic message + log detail server-side (mirror `http-exception.filter.ts`). |
| **M4** | `orgs/invitation.service.ts:48-72`, `org.controller.ts` invite route | No rate limit on invite creation; each `POST :orgId/invitations` sends a **Resend email**. Admin-gated but an admin can enumerate arbitrary victim addresses unthrottled. | Email bombing / spam from our sending domain → Resend quota exhaustion + **domain-reputation** damage. | Per-org invite rate limit (N/hour); cap distinct pending invites. |

## 🟡 Low / hardening

| # | file:line | issue | fix |
|---|---|---|---|
| **L1** | `main.ts` (no `bodyLimit`) vs `image-upload.service.ts:13` (`MAX_BYTES=1.5MB`) vs `me.controller.ts:21` (zod 3MB) | Fastify's **default 1 MiB** body cap applies first, so the 1.5 MB / 3 MB caps are unreachable and legit ~1 MB+ images fail with a confusing 413. | Set an explicit `bodyLimit` (~2.2 MB) aligned to intent; reconcile the three caps; optionally check base64 length before decoding. |
| **L2** | `core/image-upload.service.ts:104-114` | MIME trusted from the `data:` header, not file magic bytes. Limited impact once SVG is dropped (declaring `image/png` over junk won't execute). | Sniff magic numbers (`file-type`); reject if actual ∉ allowlist / ≠ declared. |
| **L3** | `orgs/invitation.service.ts:109-141` | `accept()` isn't atomic — check and `UPDATE status='accepted'` are in separate steps; single-use rests on app ordering, not the DB. No privilege gain (membership insert is `ON CONFLICT` idempotent). | Do the guard + `UPDATE … WHERE id=$1 AND status='pending'` in one tx; treat `rowCount=0` as consumed (or `SELECT … FOR UPDATE`). |
| **L4** | `orgs/invitation.service.ts:70-73` | `create()` returns `acceptUrl` (embeds the raw token) — contradicts the file's own BR-INV-1 note "token is NEVER returned." Only returned to the creating Admin, so no escalation, but **code/doc drift** (violates CLAUDE.md cardinal rule 1). | Update BR-INV-1 to "returned once, to the creator," or move the token out of the response. |
| **L5** | `webhooks/webhook.service.ts:60` | One global `GITHUB_WEBHOOK_SECRET` for all tenants; HMAC covers the body only, not the `:connectionId` in the URL. | A tenant-A admin could replay a valid `(body,signature)` at tenant-B's connection URL to force a re-sync (no data crosses; needs B's unguessable connection UUID). | Per-connection secret, or verify the signed payload's installation/repo maps to the resolved connection's org before enqueue. |
| **L6** | `app_user_memberships(uuid)` (0003/0038); `users`/`auth_identities` RLS `USING(true)` | SECURITY DEFINER membership/identity reads trust their arg; safe **today** (all call sites pass `claims.userId`) but no in-DB binding to the caller. | Never pass a client-supplied id to these; add a lint/comment guard; consider asserting `id = claims.userId`. |
| **L7** | `apps/web > next > postcss@8.4.31` | `pnpm audit --prod`: **1 moderate** (postcss <8.5.10, GHSA-qx2v-qp2m-jg93, build-time only). No `pnpm audit` runs in CI. | Bump transitively; add a `pnpm audit --prod` CI job. |
| **L8** | `connector-github/src/github/client.ts:92`, `connector-bitbucket/.../client.ts:169` | Pagination follows a server-supplied `next`/`Link` URL off-host with the auth header attached (host is fixed/trusted → not exploitable today). | Verify the `next` URL origin matches the API base before following. |

## ⚙️ Operational caveats (not code bugs, but do them)
- **Startup role assertion.** The whole isolation model hinges on the app pool connecting as `atlas_app` (NOBYPASSRLS, non-owner). A single misconfigured `DATABASE_URL` pointing at the Supabase `postgres`/owner silently disables **all** RLS at request time. Add a boot check that refuses to start unless the connected role is `rolbypassrls='f'` and `is_superuser='off'`.
- **P2 unrepresentable-in-code.** Static AWS keys are read-only only because IAM says so + our code never issues a mutating command. Add a compile-time allowlist of permitted `*Command` classes so a future write call fails the build (Cardinal Rule 8).
- **Local DoD gate blind spot.** `pnpm run check` (what the owner runs) does **not** run the RLS/isolation/sync tests — they're DB-gated and only run in the CI `integration` job. So the green local gate never proves tenant isolation. Add a Docker-Postgres `check:integration` or clearly document this.

## 🧪 QA / coverage gaps (system is hollow here)
- **Zero tests** on: JWT verifier + AuthGuard, TenantScopeGuard (404-vs-403), invitation `accept()` (email-match), ImageUploadService (SVG/mime/size). Highest blast radius; most need no DB.
- **RLS/isolation tests are well-written but DB-gated** → excluded from the local gate (see caveat above).
- **`apps/web` has no tests and no vitest** — client upload validation (`lib/read-image.ts`), forms, command palette all uncovered; only a compile-only `web-build` CI job.
- **The docs/14 "adversarial QA agent" is NOT implemented.** No E2E, API-contract, mutation, SAST, or `pnpm audit` jobs in `.github/workflows/ci.yml` (its own header calls these aspirational).
- **Error-path coverage is thin** (provider timeout, DB down, oversized upload, storage error) — mostly happy-path suites.

## ✅ Verified safe (confidence — checked, no defect)
- **RLS complete**: all 22 org-scoped tables have RLS + `org_id = current_setting('atlas.current_org')` policies **with `WITH CHECK`** and fail-closed `NULLIF(...,'')`; `atlas_app` is `NOBYPASSRLS`/non-owner; reference tables are intentionally global.
- **No SQL injection**: everything parameterized; the only interpolations are code constants or the **UUID-guarded** `orgId` in `withOrgScope` (regex fully anchored). Zod `.strict()` on every body/query; `@Param`s only reach `$N` placeholders.
- **Guards complete**: every org-scoped controller has AuthGuard→TenantScopeGuard→RolesGuard; cross-tenant id → 404 (existence not leaked); `X-Atlas-Org` validated against membership; the WebSocket path verifies JWT + membership before scoping.
- **Public buckets are NOT anon-listable/enumerable**; object paths are `<orgId>/<uuidv4>`; write key-prefix is always auth-derived. (Keep any anon `storage.objects` SELECT policy **off**.)
- **Read-only (P2) holds**: AWS connector uses only `Describe/Get/List`/`LookupEvents`/`AssumeRole`; GitHub/Bitbucket/Jenkins clients are GET-only; the GitHub webhook is read-only (timing-safe HMAC, unsigned rejected); sync never writes to a provider.
- **Secrets**: connection secrets + BYO-LLM keys are AES-256-GCM encrypted at rest (key in env, never DB), fail-closed on decrypt; **no secret is logged**; the service-role key is server-only and never in an RSC payload; OAuth-only (no passwords).
- **Invite tokens**: 256-bit `randomBytes`, stored only as sha256 hash, single-use, 7-day TTL (code + DB CHECK), cannot grant Owner.
- **CORS** locked to `WEB_ORIGIN`; **global 500s sanitized** ("Something went wrong." + requestId, stack to logs only).
- **AI grounding/anti-hallucination is genuinely well tested** (grounded+cited+tiered, uncited-claim detection, adversarial "tempt hallucination" caught). Connectors + inference rules well covered.

---

## Suggested fix order (by blast radius / effort) — ✅ 1–7 DONE
1. ✅ **H1 Jenkins SSRF** — private-IP guard (parse + post-DNS re-check), absolute-URL passthrough dropped, 16 tests.
2. ✅ **M1 SVG XSS** — `image/svg+xml` dropped from the allowlist (client + server + `<input accept>`); + L2 magic-byte check.
3. ✅ **H2 + M4 rate limiting** — durable org-scoped limiter (not throttler: covers WS + survives restarts). AI burst + shared-key daily budget; invite rate + pending cap.
4. ✅ **H3 web security headers** — `headers()` with frame-ancestors/HSTS/X-Frame/nosniff/referrer/permissions.
5. ✅ **H4 tests** — JWT verifier, invite `accept()`, TenantScopeGuard (404-vs-403), ImageUploadService. 25 tests, no DB.
6. ✅ **M2 JWT fallback** — pinned algorithms, ≥32-byte secret floor, fallback only on key/alg errors (not expiry/network).
7. ✅ **M3 SSE error sanitize**, ✅ **L1 body limit**, ✅ **role assertion** (fail-closed on BYPASSRLS/superuser). `check:integration` + `pnpm audit` CI still TODO.
8. ✅ **L2/L3/L4/L8** done. ⏳ **L5** (per-tenant webhook secret), **L6** (SECURITY DEFINER arg binding), **L7** (postcss bump + audit CI), **Ops** AWS `*Command` allowlist — deferred (lower risk / CI-tooling).
