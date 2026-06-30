# Atlas — Project Board

> **The single source of truth for "where we are."** Update this whenever a task changes status or work happens.
> Use the **`/board`** skill to update consistently. Last updated: **2026-06-30**.

**Status legend:** 📋 Todo · 🔵 In Progress · 🔍 Review · ✅ Done · ⛔ Blocked · ⏸️ Deferred (Phase-1+)

---

## 📍 YOU ARE HERE

> **Blueprint phase complete.** All 19 design docs are written (v1.0). Continuity scaffolding (this board, README, CLAUDE.md, memory, skills) is being set up.
> **Next milestone:** begin the build at **Sprint F1 — Foundation** (auth + tenancy + CI gates). Nothing is coded yet.
> **Suggested next action:** decide whether to `git init` the repo, then scaffold the monorepo per `docs/16` §2 and start F1.

**Progress at a glance**
- 📘 Blueprint (docs): **19 / 19 ✅ (100%)**
- 🧰 Project setup: **✅ done** (CLAUDE.md, README, board, skills, memory, git+GitHub)
- 🏗️ Build: **F1 ✅ + F2 ✅ COMPLETE** (Phase F done). **Now in Phase I (Ingest):** I1 (AWS crawler) ∥ I2 (GitHub crawler) implement the frozen SDK (`docs/06`/`07`). **I1.1 ✅** foundation (URN + node-kind vocab seed) · **I1.2 ✅** AssumeRole + verify/health + permission-detection→degraded. Next: I1.3 (service discoverers + pure normalize/signals/observedEdges, golden fixtures).

---

## How to use this board (for future-me)
- Each **Epic** = a phase from `docs/15`. Each **Task** has an ID, Status, linked doc(s), and a **Status note** (the latest comment on it).
- When you work: set the task 🔵, leave a Status note, and **append a dated entry to the Activity Log** at the bottom.
- When done: set ✅, note what "done" means (which `docs/15` Definition-of-Done gates passed).
- Keep tasks small enough to reason about; add sub-tasks under a sprint as you start it.

---

## EPIC 0 — 📘 Blueprint / Documentation — ✅ DONE
*All design docs written, internally consistent, v1.0. See `docs/README.md`.*

| ID | Doc | Status | Note |
|---|---|---|---|
| DOC-00 | project-overview | ✅ | Vision, P1–P10, personas, metrics |
| DOC-01 | product-requirements | ✅ | FR/NFR/US + Gherkin |
| DOC-02 | system-architecture | ✅ | Modular monolith + workers, 5 planes |
| DOC-03 | domain-model | ✅ | Entities, BR-x, dual identity |
| DOC-04 | database-schema | ✅ | PG DDL, RLS, migrations; +Phase-1 auth tables |
| DOC-05 | knowledge-graph | ✅ | URN, edges, 8 inference rules, confidence |
| DOC-06 | aws-crawler | ✅ | Connector SDK, service catalog, partial-sync |
| DOC-07 | github-crawler | ✅ | App, webhooks, deploy inference |
| DOC-07b | bitbucket-crawler | ⏸️ | Phase-2 contingency (design only) |
| DOC-08 | api-specification | ✅ | REST, DTOs, SSE, OpenAPI; +Google/domain endpoints |
| DOC-09 | frontend-spec | ✅ | Next.js + shadcn, viz, 4 states, a11y |
| DOC-10 | ai-engine | ✅ | Grounded, cited, 7-layer anti-hallucination |
| DOC-11 | search-engine | ✅ | OpenSearch hybrid, embeddings |
| DOC-12 | authentication | ✅ | Google login, RBAC, hd-domain join (Phase-1) |
| DOC-13 | security | ✅ | Threat model, IAM, Persona-E package |
| DOC-14 | testing-strategy | ✅ | Pyramid + adversarial QA agent, DoD gates |
| DOC-15 | development-roadmap | ✅ | Sprints, DoD, MVP checklist |
| DOC-16 | coding-standards | ✅ | Gold standard, parse-don't-validate, shadcn-MCP |
| DOC-17 | deployment | ✅ | Fargate, CI/CD, DR |
| DOC-18 | business-model | ✅ | Pricing, GTM, moat |

---

## EPIC SETUP — 🧰 Project Continuity Scaffolding — ✅ DONE
*Make any future session instantly resumable (this session's work).*

| ID | Task | Status | Note |
|---|---|---|---|
| SET-1 | Root `CLAUDE.md` (rules + session protocol) | ✅ | Auto-loads every session |
| SET-2 | `docs/README.md` (index + cross-ref map) | ✅ | Navigation for all 19 docs |
| SET-3 | `docs/PROJECT-BOARD.md` (this board) | ✅ | Jira-lite tracking + activity log |
| SET-4 | Skills: `/resume`, `/board`, `/atlas-doc` | ✅ | In `.claude/skills/` |
| SET-5 | Memory files (decisions, state, prefs) | ✅ | 5 files + `MEMORY.md` in project memory dir |
| SET-6 | `git init` + GitHub remote | ✅ | Repo `atlas` on `main`; **private** GitHub remote `anmolbhardwaj17/atlas` pushed. |

---

## EPIC F — 🏗️ Foundation — 🔵 IN PROGRESS  *(walking skeleton + safety rails, `docs/15` Phase F)*

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| F1.1 | Monorepo scaffold + shared tooling + `config` package | ✅ | 16 §2/§4, 17 §6 | pnpm workspaces + strict TS + eslint(no-any) + prettier + vitest. `@atlas/config` (Zod env, parse-don't-validate). **All gates green: format/lint/typecheck/6 tests.** |
| F1.2 | CI gate harness (lint/typecheck/test) | ✅ | 14 §16, 17 §5 | GitHub Actions `.github/workflows/ci.yml`: pnpm + Node 22, format/lint/typecheck/test on push to main + PRs. **First run green (22s).** Badge on README. Heavier stages (integration/contract/adversarial-QA/E2E/load) added in later sprints. |
| F1.4 | DB foundation: Postgres (plain `pg`) + SQL migrations + core tables + RLS | ✅ | 04, 13 §6, 17 | `@atlas/db`: **plain `pg`, no ORM** (Kysely removed per user). Typed row schema, 5 core tables, own forward-only SQL migration runner (`schema_migrations`), `atlas_app` non-bypass role + RLS policies, `withOrgScope` GUC helper. **Verified end-to-end on live Supabase** — RLS isolation 3/3 (org A↔B + fail-closed), app connects as `atlas_app` / migrations as `postgres`. Fixes from real testing: `NULLIF` empty-string GUC (pooled conns), session-pooler (IPv4), two-role model (Supabase `postgres` has BYPASSRLS). `docker-compose.yml`+`.env.example` added. CI Postgres job = follow-up (F1.7). |
| F1.5 | Supabase Auth (Google) integration + session/JWT verify | ✅ | 12 | **Live Google login verified end-to-end** (real account → `/me` 200). `docs/12` §2–4 rewritten v1.1 (docs-before-code): Supabase-hosted Google OAuth (DD-1a), Atlas verifies the ES256 JWT via JWKS and mints no tokens (DD-2 revised), identity mirrored into `public.users` (id=auth uid) + `auth_identities`, active org resolved live via `app_user_memberships` SECURITY DEFINER fn (org not in token). **Backend:** `CoreModule` (env + atlas_app pool), `SupabaseJwtVerifier` (jose JWKS, iss/aud, HS256 fallback), `AuthGuard`, `UserMirrorService`, `MembershipService`, `GET /me`; claims unit tests. **Frontend:** `@supabase/ssr` browser/server/middleware clients, Sign-in-with-Google page, `/auth/callback`, server home calling `/me`. **Migrations:** 0003 resolver fn (EXECUTE→atlas_app), 0004 identity-table RLS policies `TO atlas_app` (Supabase auto-enables RLS on all public tables — global identity tables needed policies; anon/authenticated deliberately denied). Guard 401s (missing/bogus/malformed) verified. Ports moved to **API :4290 / web :4291** (avoid local clashes). All gates green. |
| F1.6 | Org / RBAC / memberships / invitations (endpoints + guards) | ✅ | 12, 03, 08 | **Live-verified through the app** (real Google session → create org → Owner; invite pending; members RLS-scoped read; last-Owner demote rejected; cross-tenant 404). **Guards:** `TenantScopeGuard` (resolves active org + live role from `X-Atlas-Org`/path via the SECURITY DEFINER resolver; path cross-tenant→404, header→403) + `@Roles`/`RolesGuard` (Owner>Admin>Member). **Endpoints:** POST /orgs (creator→Owner, BR-ORG-1), GET/PATCH /orgs/:id, GET /orgs/:id/members, PATCH/DELETE members (BR-MEM-2/3 invariants), POST/GET/DELETE invitations, POST /invitations/:token/accept (capability token, sha256-hashed, never returned). **API conventions:** `{data}` success envelope + `{error:{code,message,details,requestId}}` error model (docs/08 §4/§11) via global interceptor+filter; zod request validation; CORS for the web origin. **Migration 0005:** organizations org-scope RLS policy + `app_invitation_by_token` resolver. **Docs:** §5.2 RBAC + docs/08 §6 auth-endpoints synced. **Frontend:** create-org form + org-management panel (members/invitations/invite). Unit tests: RolesGuard, slug. All gates green. |
| F1.7 | Tenant-isolation test (US-12 foundation) + CI Postgres job | ✅ | 04 §10, 13 §6, 14 §16 | **CI `integration` job** added (`.github/workflows/ci.yml`): `postgres:16` service → run migrations as owner → grant `atlas_app` LOGIN (throwaway pw via `setup-app-role.ts`) → run env-gated integration tests against real PG with the two-role + RLS setup. **Expanded coverage** (`org-scope.test.ts`): organizations org-scope (+ fail-closed), invitations cross-org isolation, `app_user_memberships` + `app_invitation_by_token` resolvers, and a write-guard negative (can't INSERT another org's row while scoped). **9 integration tests pass** against live PG; skip cleanly in the no-DB `check` job (21 unit tests stay green). Expands to graph tables in the G sprints. |

### Sprint F2 — Connector framework + secrets + queue *(`docs/15` Phase F)*

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| F2.1 | `connections` + `sync_runs` schema (migration + RLS + types) | ✅ | 04 §5.2, 03 §3.5/3.6 | Migration 0006: both tables with org-scoped RLS (`TO atlas_app`), `updated_at` trigger, **BR-SYNC-1** partial-unique in-flight index. Row types + enums in `@atlas/db`. Integration test: connections cross-org isolation (10 integration tests pass on live PG). |
| F2.2 | `@atlas/connector-sdk` — frozen Connector contract | ✅ | 06 §3 (DD-1) | New pure-types package: `Connector` interface (verify/health/plan/discover/fetchDetail/normalize/extractSignals/observedEdges) + shared types (Connection, SyncRun, WorkPlan, Scope, ResourceRef, RawResource, NodeUpsert, Signal, EdgeUpsert, CrawlContext, SecretAccessor, VerifyResult). Provider union open (extensible). **Contract frozen in F2 (RMR-6).** |
| F2.3 | Graph persist schema (nodes/edges/provenance/raw_snapshots/node_kinds/inference_rules) | ✅ | 04 §5.3–5.4, §6, 05 | Migration 0007: full knowledge schema + indexes + composite FKs (same-org edges, BR-EDGE-1) + provenance-required/inferred-needs-rule constraints; `uq_edge` **NULLS NOT DISTINCT** (observed-edge dedupe, doc synced). Org-scope RLS on nodes/edges/provenance/raw_snapshots; global vocab policy on node_kinds/inference_rules. Row types in `@atlas/db`. **graph-scope.test.ts** (4 tests): node/edge org isolation, cross-tenant edge structurally rejected, observed-edge dedupe. **14 integration tests pass on live PG.** |
| F2.4 | Mock connector + staged sync runner (EXIT proof) | ✅ | 06, 02 §5.2, BR-SYNC-2 | **F2 exit criterion met.** New `@atlas/ingest`: `runStagedSync` (plan→per-scope discover→fetchDetail→normalize/observedEdges→persist→reconcile; each scope one tx; org-scoped via withOrgScope) + `MockConnector` (in-memory fake provider, failure injection, discover-call tracking) + `InMemorySnapshotStore` + dev SecretAccessor/logger. **4 integration tests on live PG:** idempotent persist (upsert by URN/uq_edge, no dupes), reaping (unseen → stale on clean sync), **BR-SYNC-2** (failed scope → partial → reconcile skipped → no false delete), resumability (checkpoint skips completed scopes). CI integration job now runs all integration tests. |
| F2.5 | BullMQ queue + worker runtime | ✅ | 02 §5 (DD-6) | Provider-agnostic `JobQueue` (keeps core decoupled / Temporal-swappable) + `InMemoryQueue` (dev/test, idempotent jobId dedupe, buffering) + `BullMQQueue` (Redis driver, thin) + sync-job worker (`createSyncHandler`/`registerSyncWorker`/`enqueueSync`, deterministic `syncJobId`). Worker handler loads connection → resolves connector → `runStagedSync`. Tests: InMemoryQueue unit (3) + worker→runner→persist on live PG (1). Scheduler + API enqueue-on-verify land with I1 (real connectors). |
| F2.6 | Secrets Broker (interface + dev impl) | ✅ | 13 §7 | `SecretBroker` (extends SDK `SecretAccessor`) + `InMemorySecretBroker` in `@atlas/ingest`. `put`→opaque `secret_ref` (BR-CONN-1, raw secret never on the row); `get`/`delete`. Prod = AWS Secrets Manager (later). |
| F2.7 | Raw-snapshot store (Supabase Storage) | ✅ | 04 §5.4, 13 | `SupabaseStorageSnapshotStore` (impl of `SnapshotStore`): private bucket, content-addressed (`<orgId>/<hash>.json`), idempotent upsert; service-role client (server-only); `storage_ref` = `<bucket>/<path>`. `ensureBucket` provisions programmatically. **Live round-trip verified** against real Supabase Storage (put→get, missing→null). |
| F2.8 | Connection API skeleton | ✅ | 08 §8 | **Live-verified** (real session → create→verify→connected). `/connections` (X-Atlas-Org scoping): POST (Admin), GET list (Member), GET :id (Member), POST :id/verify (Admin — stores creds via broker, calls connector.verify, maps status/health, 422 `connection_verification_failed` on error), DELETE :id (Admin, soft). `ConnectorRegistry` (placeholder mock connectors until I1/I2). zod DTOs; secrets never in responses (`secretConfigured` flag). Guard 401s verified; registry unit tests. |
| F1.3 | App shells: NestJS API + Next.js web + Turborepo | ✅ | 02, 09, 16, 17 | `apps/api` (Nest+Fastify, `/health` ✅ boots) + `apps/web` (Next 15/React 19 shell) + Turborepo build orchestration. `@atlas/config` now builds to CJS, consumed by API at runtime. All gates green. **Note:** full structured-logging/correlation-id observability package deferred to a follow-up (basic Nest logger for now). |
| F2 | Connector SDK interface + queue/worker/scheduler | 📋 | 06 §3, 02 §5 | BullMQ, the fork point |
| F2 | Secrets Broker + Secrets Manager | 📋 | 13 §7 | |
| F2 | Connections + sync_runs lifecycle + S3 snapshots | 📋 | 03, 04, 08 §8 | |

**Exit (M0):** Google login → create org → invite Member; US-12 + RLS pass; CI green; deploys to staging.

---

## EPIC I — 📥 Ingest — 🔵 IN PROGRESS  *(fill the graph; I1 ∥ I2 after F2)*

### Sprint I1 — AWS crawler *(`docs/06`)*

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| I1.1 | AWS connector foundation: package + URN grammar + node-kind vocab seed | ✅ | 05 §2/§3, 06 §4 | New `@atlas/connector-aws` (CJS, requireable by API). `awsUrn()` builds deterministic 5-segment URNs matching docs/05 §2.2 exactly (region-scoped + literal `global` for S3/Route53/IAM; natural key case-preserved). `AWS_NODE_KINDS` catalog (18 kinds + URN type/scope). Migration 0008 seeds `node_kinds` (24 = 18 AWS + 5 GitHub + 1 atlas) — global vocab needed before any node insert (FK). 9 unit tests; migration applied to live DB (verified counts). |
| I1.2 | Credential provider (STS AssumeRole + externalId) + verify/health + permission detection → degraded | ✅ | 06 §2/§8, 13 §4 | `StsCredentialProvider` (sts:AssumeRole via Atlas's own identity → ≤1h creds, in-memory only; `sessionName=atlas-…-<id>` for customer CloudTrail traceability; account id parsed from assumed-role ARN). External ID resolved from Secrets Broker (C1), never config. `parseAwsConfig` validates roleArn + regions allow-list. `verify`/`health` AssumeRole then run per-service permission probes: AccessDenied → **`degraded`** with the missing IAM actions (P3, US-1); transient errors ≠ missing perm; AssumeRole/config failure → `error`. Probe framework + `isAccessDenied` classification (real per-service probes land in I1.3). 27 unit tests (aws-sdk-client-mock for STS). |
| I1.3 | Service discoverers + pure normalize/extractSignals/observedEdges (golden fixtures) | 📋 | 06 §4/§5, 05, 14 §10 | 100% observed-edge precision |
| I1.4 | Resilience (rate-limit/retry/pagination) + incremental hash-diff + wire into runner/registry/API | 📋 | 06 §7, 02 §5 | replaces MockConnector placeholder; enqueue-on-verify |

### Sprint I2 — GitHub crawler *(`docs/07`)*

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| I2 | GitHub crawler (App, webhooks, deploy signals, CODEOWNERS, deps) | 📋 | 07, 13 §5 | parallel with I1 |

**Exit (M1):** real AWS+GitHub → nodes + provenance; degraded reports missing perms; no false deletes.

---

## EPIC G — 🧠 Graph & Intelligence — 📋 TODO

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| G1 | Inference engine + rules R1–R8 + atlas.service | 📋 | 05 | **precision ≥95%**, deterministic |
| G2 | Read API + traversals (blast-radius/deps) + OpenSearch hybrid search | 📋 | 08 §9, 11 | unblocks G3/G4 |
| G3 | AI engine (planner, grounding gate, cited, streamed, eval in CI) | 📋 | 10, 14 §11 | hallucination <1% |
| G4 | Explore UI + graph canvas + detail + 4 states | 📋 | 09 | parallel with G3 |

**Exit (M2–M5):** cross-source cited edges; canonical questions answered correctly & honestly; explorable.

---

## EPIC P — ✨ Polish — 📋 TODO

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| P1 | Onboarding wizard + AI chat surface + timeline + settings | 📋 | 09 §8 | hit **TTFI < 30 min** |
| P2 | Hardening: load/perf (NFR), security pass, observability, DR drill, mutation tests | 📋 | 14, 13, 17 | MVP exit checklist |

**Exit (M6–M7):** NFR targets met; security suite green; DR drill passes.

---

## EPIC GA — 🚀 Launch — 📋 TODO

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| GA | Closed beta → fix activation → security package → GA | 📋 | 18, 13, 15 | design partners validate trust ≥90% |

---

## ⏸️ Backlog (Phase-1+ — deferred, from roadmap `docs/15` §8)
- v1.1 Trust & Depth: richer inference, culprit-PR ranking (US-6), saved views/deep-links
- v1.2 Enterprise on-ramp: multi-account AWS, **domain auto-join (`hd`)**, real-time CloudTrail ingestion
- v1.3 Enterprise security: SSO/SAML+SCIM, custom RBAC, SOC 2 Type II, data residency
- v2.0 Breadth: GCP/Azure, **Bitbucket (`07b`)/GitLab**, Datadog/PagerDuty
- v2.x Scale: dedicated graph DB (when `05` DD-3 trigger met), partitioning
- v3.0 Platform: proactive alerts, incident root-cause, **MCP/public API**, connector marketplace

---

## 📜 Activity Log (append newest at top; one line per work session/event)

| Date | Who | What |
|---|---|---|
| 2026-07-01 | architect | **I1.2 DONE — AWS credential provider + verify/health + permission detection.** `StsCredentialProvider` does `sts:AssumeRole` (Atlas's own identity → customer read-only role) with the per-connection **External ID** (confused-deputy defense, resolved from the Secrets Broker — C1, never in config) and `sessionName=atlas-{verify,health,sync}-<id>` so every action is attributable in the customer's CloudTrail; creds are ≤1h, in-memory only (A23/P8); account id parsed from the assumed-role ARN (URN scope). `parseAwsConfig` validates `roleArn` + a regions allow-list (A25). `verify`/`health` AssumeRole then probe each supported service → `AccessDenied` becomes a **`degraded`** connection listing the missing IAM actions (P3, FR-1.6, US-1); transient (non-deny) probe errors are NOT counted as missing; bad config / failed AssumeRole → `error` with actionable text. Permission-probe framework + `isAccessDenied` classification in place; concrete per-service probes attach in I1.3. 27 unit tests (config, verify decision matrix, STS via aws-sdk-client-mock). Crawl stages stubbed (throw, I1.3). Gates green. **Next: I1.3** (service discoverers + pure normalize/extractSignals/observedEdges, golden fixtures). |
| 2026-07-01 | architect | **I1.1 DONE — AWS connector foundation (Phase I started).** New `@atlas/connector-aws` package (CommonJS so the CJS NestJS API can `require` it). `awsUrn()` builds the deterministic, recomputable 5-segment URN (`aws:<region\|global>:<account>:<type>:<key>`) matching every documented pattern in docs/05 §2.2 — region in scope for multi-account safety, literal `global` for S3/Route53/IAM, natural key case-preserved (Lambda/DynamoDB names are case-significant). `AWS_NODE_KINDS` catalog = the 18 MVP kinds (docs/05 §3.1 / docs/06 §4) with URN type discriminator + region/global scope. Migration **0008_node_kinds_seed** seeds `node_kinds` global vocab (24 rows = 18 AWS + 5 GitHub + 1 `atlas.service`) — required before any node insert (FK `nodes.kind`). Idempotent (ON CONFLICT DO NOTHING). 9 unit tests; applied to live DB (counts verified). Gates green. **Next: I1.2** (STS AssumeRole + verify + degraded permission detection). |
| 2026-07-01 | architect | **Phase F COMPLETE — F2 (connector framework + secrets + queue) DONE.** F2.1 connections/sync_runs schema · F2.2 `@atlas/connector-sdk` (frozen Connector contract) · F2.3 graph persist schema (nodes/edges/provenance/raw_snapshots, composite-FK same-org edges, uq_edge NULLS NOT DISTINCT) · F2.4 `@atlas/ingest` staged sync runner + MockConnector (idempotent/resumable/BR-SYNC-2, exit proof) · F2.5 JobQueue (InMemory + BullMQ) + sync worker · F2.6 SecretBroker · F2.7 Supabase Storage snapshots (live round-trip) · F2.8 connection API (live create→verify→connected). New packages: `@atlas/connector-sdk`, `@atlas/ingest`. ~18 integration tests on live PG + Storage; CI green (check + integration jobs). **Next: I1 (AWS) ∥ I2 (GitHub) crawlers** implement the frozen SDK. |
| 2026-07-01 | architect | **F1.7 CI Postgres integration job DONE — F1 Foundation epic COMPLETE.** Added CI `integration` job (postgres:16 service → migrations as owner → grant atlas_app LOGIN via `setup-app-role.ts` → env-gated integration tests with two-role + RLS). Expanded `org-scope.test.ts`: organizations org-scope + fail-closed, invitations cross-org isolation, `app_user_memberships`/`app_invitation_by_token` resolvers, write-guard negative. 9 integration tests pass on live PG; skip in the no-DB job (21 unit tests green). Updated docs/14 ref + ci.yml header. **Next: F2** per docs/15. |
| 2026-07-01 | architect | **F1.6 Org / RBAC / memberships / invitations DONE — live-verified through the app.** Built `TenantScopeGuard` (active org + live role) + `@Roles`/`RolesGuard` (Owner>Admin>Member); orgs/members/invitations endpoints with BR-ORG-1 / BR-MEM-2/3 invariants; invitation accept by sha256-hashed capability token (never returned). Added `{data}`/`{error}` API envelopes (global interceptor + exception filter), zod validation, CORS. Migration 0005 (organizations org-scope RLS + `app_invitation_by_token` SECURITY DEFINER resolver). Synced docs/12 §5.2 + docs/08 §6. Frontend: create-org + org-management panel (members/invitations/invite). Verified live: real session → create org (Owner), invite (pending, hashed), members RLS-scoped read 200, last-Owner demote rejected (still Owner), cross-tenant 404. Unit tests RolesGuard+slug (api 15 tests). All gates green. |
| 2026-07-01 | architect | **F1.5 Supabase Auth DONE — live Google login verified end-to-end.** Rewrote `docs/12` §2–4 (v1.1, docs-before-code). Built NestJS auth (CoreModule env+atlas_app pool, `SupabaseJwtVerifier` via JWKS/ES256, `AuthGuard`, `UserMirrorService`, `MembershipService`, `GET /me`, claims unit tests) + Next.js Google sign-in (`@supabase/ssr` client/server/middleware, login page, `/auth/callback`, server home calling `/me`). Migrations 0003 (`app_user_memberships` SECURITY DEFINER resolver) + 0004 (identity-table RLS policies `TO atlas_app` — discovered Supabase auto-enables RLS on **all** public tables; global identity tables had no policy → fixed). Configured Supabase URL config (Site URL + redirect `localhost:4291/**`) via Chrome. Verified: real Google account → consent → `/me` 200 with mirrored user (`users` id=auth uid + `auth_identities` google sub + gmail.com domain), email ✓verified, empty-orgs onboarding path. Guard 401s confirmed. **Ports → API :4290 / web :4291** (avoid clashes, per user). All gates green. |
| 2026-07-01 | architect | **Google auth provider configured** (via Chrome): Google Cloud project + Google Auth Platform consent screen + OAuth client "Atlas Web" + redirect URI (Supabase callback) + test user added; **Supabase Google provider enabled** with real Client ID/secret. Prereq for F1.5 done. (Secrets in `.env`/dashboards only, never committed.) |
| 2026-06-30 | architect | **F1.4 ✅** — `@atlas/db` (plain `pg`, **Kysely removed**): 5 core tables, SQL migration runner, `atlas_app` non-bypass role + RLS, `withOrgScope`. **Verified on live Supabase** (RLS 3/3). Decisions from real testing: session-pooler/IPv4, two-role model (postgres BYPASSRLS), `NULLIF` GUC. |
| 2026-06-30 | architect | **Supabase project live** — connected, schema + RLS migrated to the real DB. `.env` set (app=atlas_app, migrations=postgres). Google provider + connection-string setup done via browser. |
| 2026-06-30 | architect | **Decision: adopt Supabase** (managed Postgres + Auth/Google + Storage). Backend/graph/AI unchanged; keep GUC-RLS isolation. Recorded in CLAUDE.md + memory; banners added to docs 02/04/12/13/17. Reordered F1 to DB-first. |
| 2026-06-30 | architect | **F1.3 ✅** — NestJS API shell (Fastify, `/health` boots OK) + Next.js 15 web shell + Turborepo build orchestration. `@atlas/config` → CJS dist consumed at runtime. All gates green. |
| 2026-06-30 | architect | **F1.2 ✅** — GitHub Actions CI (`ci.yml`) running format/lint/typecheck/test on push to main. First run green (22s). README badge added. |
| 2026-06-30 | architect | Adopted **main-only git workflow** (no branches/PRs yet; `dev` later). Cleaned history to 2 commits, no AI attribution. F1.1 on `main`. |
| 2026-06-30 | architect | **F1.1 ✅** — monorepo scaffold (pnpm workspaces, strict TS, eslint/prettier, vitest) + `@atlas/config` (Zod env). All gates green. |
| 2026-06-30 | architect | Pushed to **private** GitHub remote `anmolbhardwaj17/atlas`. |
| 2026-06-30 | architect | `git init` (repo `atlas`, branch `main`); initial commit `ec99660` with blueprint + scaffolding (28 files). SET-6 ✅. |
| 2026-06-30 | architect | Set up continuity scaffolding: CLAUDE.md, docs/README.md, this board, skills, memory (EPIC SETUP). |
| 2026-06-30 | architect | Completed full blueprint: wrote all 19 design docs `00`–`18` + `07b` (EPIC 0 ✅). |
| 2026-06-30 | architect | Interactive decisions captured: Bitbucket=Phase-2, Google-only auth + `hd` domain-join Phase-1, shadcn+MCP, adversarial QA agent. Propagated across 00/01/03/04/08/09/12/16. |
