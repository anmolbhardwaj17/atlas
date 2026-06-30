# 16 — Coding Standards & Engineering Conventions

> **Document status:** Authoritative · **Version:** 1.0 · **Last updated:** 2026-06-30
> **Owner:** Founding Principal Architect · **Audience:** All engineers, AI coding agents
> **Document type:** Engineering Conventions / "Gold Standard"
> **Depends on:** `02` (modular monolith, module boundaries, NestJS/Next.js), `03`/`04` (entities, invariants, constraints), `08` (DTO/API), `09` (frontend/shadcn), `13` (secure coding), `14` (testing/DoD)
> **Consumed by:** every engineer & AI agent writing Atlas code; `14` (gates these standards); `17` (CI runs the linters/scanners here)

---

## Purpose

This is the **coding gold standard** for Atlas: the conventions, type discipline, and review practices whose explicit goal is **to ship as few bugs as possible** by making whole classes of bug *impossible to write*. It is the **prevention layer** of the quality strategy — the cheapest bug is the one the compiler or a DB constraint rejects before a test ever runs (`14` §2, QA-4).

It is written to be followed by **both human engineers and AI coding agents** with no ambiguity: where a rule could be interpreted two ways, the stricter is chosen and stated. These standards are **enforced in CI** (lint/typecheck/scan gates, `14`/`17`) — they are not suggestions.

> **The governing maxim:** *Make illegal states unrepresentable.* Every invariant we wrote as a `BR-x` (`03`) should, wherever possible, be enforced by a **type** or a **database constraint** rather than a runtime check or a code reviewer's vigilance. Atlas already does this heavily (composite FKs, CHECKs in `04`); this document generalizes it into a way of working.

## Scope

**In scope:** Repository structure & module boundaries; naming; **strict TypeScript & type discipline (parse-don't-validate, invariants-in-types)**; NestJS backend architecture; Next.js frontend architecture + the **shadcn MCP workflow**; error handling; logging; secure-coding rules; dependency management; testing standards (source-level); Git/branch/commit/PR conventions; documentation standards; performance expectations; AI-agent-specific rules.

**Out of scope (pointers):** Test *strategy* & gates → `14`; CI/CD *pipeline* → `17`; API *contract* → `08`; security *controls/threat model* → `13`; architecture *decisions* → `02`.

## Assumptions

Inherits `00`–`15`. Conventions-specific:
- **A61.** **TypeScript everywhere** (`02`), single monorepo, shared types across API/worker/web.
- **A62.** Tooling baseline: ESLint + Prettier + `tsc --strict`, Vitest/Jest-class runner, a monorepo manager (pnpm workspaces / Turborepo-class), Zod for runtime schemas.
- **A63.** AI coding agents are first-class contributors and must follow this doc; the adversarial QA agent (`14` §8) checks their output like any other.

---

## 1. Engineering Principles

| # | Principle | Trace |
|---|---|---|
| CS-1 | **Make illegal states unrepresentable** — types & constraints over runtime checks | `03` BR-x, `04` |
| CS-2 | **Parse, don't validate** — untrusted input becomes a typed, validated value at the boundary, once | `08` DTOs, `13` |
| CS-3 | **Strict everything** — `tsc --strict`, no `any`, no implicit, lint-clean | A62 |
| CS-4 | **Module boundaries are real** — modules talk via interfaces, never reach into each other's internals | `02` §2, NFR-19 |
| CS-5 | **Pure core, imperative shell** — business logic is pure/testable; IO at the edges | `14` QA-5 |
| CS-6 | **Secure by default** — parameterized queries, no secrets in code/logs, validated input | `13` |
| CS-7 | **Consistency over cleverness** — code reads like the surrounding code; boring is good | P10 |
| CS-8 | **Docs are authoritative** — change the doc first if you change a contract | `14` §19, `15` DoD #7 |
| CS-9 | **The compiler/linter is the first reviewer** — green CI before human review | `14` QA-4 |

---

## 2. Repository Structure

> **DD-1 — Monorepo with explicit packages mirroring the `02` module map.** **Why:** shared TypeScript types between API/worker/web (compile-time contract safety), atomic cross-cutting changes, one toolchain — while package boundaries enforce the modular-monolith separation (`02` DD-1, CS-4).

```
atlas/
  apps/
    api/            # NestJS API/BFF (02 §3) — controllers, services, repositories
    worker/         # NestJS worker runtime (02 §5) — connectors, inference, index
    web/            # Next.js app (09)
  packages/
    domain/         # entities, value objects, BR-x invariants as types (03) — pure, no IO
    connectors/     # Connector SDK + aws/github impls (06/07) — implements domain interfaces
    graph/          # graph core + inference rules (05) — pure where possible
    db/             # schema, migrations, repositories, RLS helpers (04)
    contracts/      # shared DTOs + zod schemas + generated OpenAPI types (08) — used by api+web
    ai/             # AI engine: provider abstraction, planner, retrieval, citation (10)
    search/         # OpenSearch indexing + hybrid query (11)
    config/         # env parsing (zod), feature flags
    observability/  # logging/metrics/tracing helpers (02 §9.4)
    testing/        # fixtures, factories, property generators (14)
  docs/             # 00–18 (authoritative)
  tooling/          # eslint/prettier/tsconfig presets, scripts, registry config (shadcn)
```

**Rules:**
- `domain`/`graph` are **pure** (no DB/HTTP/SDK imports) → unit/property-testable (CS-5, `14`).
- `api`/`worker` are the **imperative shells** that wire pure logic to IO.
- `contracts` is the **single source of DTO truth** (api produces, web consumes — `08`/`09`).
- A package may depend only on packages **below** it (enforced by an import-boundary lint rule, CS-4). No cycles.

---

## 3. Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `aws-connector.ts`, `blast-radius.service.ts` |
| Classes / types / interfaces | `PascalCase` | `InferenceRule`, `NodeUpsert` |
| Functions / variables | `camelCase` | `extractSignals`, `orgId` |
| Constants / enums values | `UPPER_SNAKE` (consts), `PascalCase` enum members | `MAX_TRAVERSAL_DEPTH` |
| DB tables/columns | `snake_case`, plural tables | `sync_runs`, `org_id` (`04`) |
| Graph kinds/edge types | controlled vocab (`05`) | `aws.lambda.function`, `DEPLOYS_TO` |
| NestJS providers | `*.service.ts`, `*.controller.ts`, `*.repository.ts`, `*.guard.ts` | `connections.controller.ts` |
| React components | `PascalCase.tsx` | `BlastRadiusPanel.tsx` |
| Test files | `*.spec.ts` (unit/int), `*.e2e.ts` (E2E) | `inference.rules.spec.ts` |
| Booleans | `is/has/can/should` prefix | `isDegraded`, `hasProvenance` |

- **No abbreviations** except established ones (`id`, `url`, `arn`, `urn`, `db`). Names match the domain glossary (`00` §10) — a `Node` is a `Node`, not a "resource"/"entity"/"item" interchangeably.
- DB ↔ DTO mapping: `snake_case` columns → `camelCase` DTO fields, done in one mapping layer (CS-2).

---

## 4. TypeScript & Type Discipline (the heart of bug-prevention — CS-1/CS-2)

> **DD-2 — Maximum strictness + "make illegal states unrepresentable" + "parse, don't validate."** This is the single highest-leverage standard for the "fewer bugs" goal.

### 4.1 Compiler settings (non-negotiable)
`tsconfig` base: `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`. **`any` is banned** (lint error; use `unknown` + narrowing). No non-null `!` except with a justifying comment. No `as` casts except at validated boundaries (CS-2).

### 4.2 Parse, don't validate (CS-2)
Untrusted input (HTTP body, webhook, crawled payload, env) is **parsed into a typed value once, at the boundary**, with **Zod**; downstream code receives the *typed* value and never re-checks.
```ts
// boundary: parse → typed; invalid input never reaches domain logic
const CreateConnection = z.object({
  provider: z.enum(['aws','github']),
  displayName: z.string().min(1).max(80),
  config: z.record(z.unknown()),       // provider-specific, re-parsed by the connector
});
type CreateConnection = z.infer<typeof CreateConnection>;
// controller parses; service receives CreateConnection (already valid) — no defensive re-validation
```
- Zod schemas live in `packages/contracts` and **are** the DTOs (`08`) — one definition for runtime validation *and* the static type. The validation rules table (`03` §8) is implemented here.

### 4.3 Make illegal states unrepresentable (CS-1)
- **Discriminated unions over boolean soup.** A connection is `{status:'connected'} | {status:'degraded', missingPermissions: Perm[]} | {status:'error', reason: string}` — you *cannot* have a degraded connection without `missingPermissions`, nor an error without a reason (mirrors `03` §5.1). The compiler enforces the state machine.
- **Branded types for ids** to prevent mixing: `type OrgId = Brand<string,'OrgId'>`, `type NodeId = ...` — passing a `NodeId` where an `OrgId` is expected is a compile error (defends tenant scoping, R8).
- **`readonly` by default**; prefer immutable data; mutation is explicit and local.
- **Exhaustive switches** on enums/unions with a `never` default (adding a `node.kind` that a switch forgot becomes a compile error — pairs with the controlled vocab `05`).
- **No primitive obsession** for domain concepts: `Confidence`, `Urn`, `EdgeType` are types, not bare strings (matches `05` controlled vocab).

### 4.4 Result/error typing
- Domain operations that can fail return a typed result (`Result<T, DomainError>`) or throw **typed domain errors** (`§7`) — never throw strings or untyped objects. The API error envelope (`08` §11) is produced from typed errors by one interceptor.

### 4.5 No `any` escape hatches
- External SDK responses (AWS/GitHub) are typed via the SDK or parsed with Zod at ingestion (CS-2) before becoming domain values — raw `any` SDK output never flows into `domain`/`graph`.

---

## 5. Backend (NestJS) Architecture Conventions

> Realizes `02` §3.1 layering. Controller → Service → Repository; DI throughout (testability, `14`).

| Layer | Responsibility | Rules |
|---|---|---|
| **Controller** | HTTP/SSE boundary | thin; parse DTO (Zod pipe), call one service method, map result→response DTO; **no business logic** |
| **Guard** | authn/authz/tenant | resolve `(userId, orgId, role)`; set org GUC (`12` §4); enforce RBAC (`12` §5) |
| **Service** | business logic | pure-ish orchestration; depends on repositories/other services via interfaces (CS-4); transactional boundaries here |
| **Repository** | data access | **every query org-scoped** (`02` §3.3); no business logic; parameterized queries only (CS-6) |
| **Interceptor** | cross-cutting | serialization (entity→DTO, strip secrets), audit, error→envelope |

**Rules:**
- **Modules expose interfaces, not internals** (CS-4) — `connectors` depends on the `Graph` *interface* from `graph`, not its repository. The import-boundary lint enforces this (`02` AR-4 mitigation).
- **No entity leaves via the API** — controllers return Response DTOs (`08` DD-2); a lint rule forbids returning ORM/domain entities from controllers (prevents secret/over-exposure, `13` SEC-6).
- **Repositories never callable without `org_id`** — the base repository signature *requires* it (the type makes an unscoped query impossible — CS-1, R8).
- **Transactions** are explicit at the service layer; reconciliation is transactional per resource (`04`).

---

## 6. Frontend (Next.js + shadcn) Conventions

> Realizes `09`. RSC for reads, Client Components for interactivity (`09` DD-2).

- **Server Components** fetch initial data (no secrets to client); **Client Components** (`'use client'`) own interactivity (canvas, chat, filters). Keep the boundary explicit and minimal.
- **State (`09` DD-4):** server state via **TanStack Query** only (no hand-rolled fetch caches); UI state via **Zustand**; shareable view state in the **URL**. No Redux.
- **Data access** only via the generated typed client from `contracts`/OpenAPI (`08` §14) — never `fetch` a raw endpoint with untyped JSON.
- **Components** compose the **certainty primitives** (`ConfidenceBadge`/`FreshnessTag`/`CitationLink`, `09` §3.2) — never re-implement confidence/freshness styling ad hoc (consistency = trust, FE-1).
- **The 4 UI states** (loading/empty/partial/error, `09` §7) are mandatory for every data surface — a PR adding a data view without all four fails review (DoD, `15`).

### 6.1 shadcn component workflow via MCP (DD-3 — the build-time standard you asked for)
> **DD-3 — Acquire shadcn primitives/blocks/charts via the shadcn MCP server + CLI; vendor, then adapt to Atlas tokens before commit.** Realizes `09` DD-3a.
- **Add components** with the shadcn CLI driven by the **shadcn MCP server** (engineers and AI agents query the registry, inspect source/demos, and `shadcn add`). Registry config lives in `tooling/`.
- **Vendored, then owned:** added components land in `apps/web/components/ui/` as **our source** — once adapted, treat as first-party code (review, test, lint like any file).
- **Adapt-before-commit rule:** a freshly-added shadcn component must be re-themed to Atlas **design tokens** (`09` §3.1) and pass a11y review *before* it merges — no raw, un-adapted defaults.
- **MCP is build-time only** (`09` DD-3a) — **never** a runtime dependency; the deployed app contains only vendored code.
- **Third-party registry components** require the same a11y + token-adaptation + security review as first-party (no unreviewed external UI code).

---

## 7. Error Handling (CS-4/CS-6)

> **DD-4 — Typed domain errors internally; one uniform envelope at the API edge (`08` §11).**
- **Domain layer** throws/returns **typed errors** with a stable code (e.g. `ConnectionVerificationFailed`, `InsufficientRole`, `SyncInProgress`) — never bare `Error('string')`.
- **One API interceptor** maps typed domain errors → the `08` §11 envelope (`code`, `message`, `requestId`) with the right HTTP status. New error → add to the typed catalog + envelope mapping, never an ad-hoc `res.status(500)`.
- **No swallowed errors** — an empty `catch` is a lint error; either handle, wrap-and-rethrow, or log-and-rethrow with context.
- **Workers:** bounded retries + backoff + DLQ (`02`/`06`); partial-failure is a *typed* outcome, not an exception that fails the whole sync (BR-SYNC-2).
- **Fail closed** (`13` SEC-9): on uncertainty, deny/redact; never expose data on an error path.
- **No secrets/PII in error messages** (`13` SEC-6).

---

## 8. Logging & Observability (realizes `02` §9.4)

- **Structured JSON logs only** (no `console.log` in app code; lint-banned). One logger from `observability`.
- **Correlation id** on every log/metric/trace — propagated request→job→worker→inference (`02` §9.4). A user action or sync is traceable end-to-end.
- **Log levels:** `error` (actionable failure), `warn` (degraded/partial, recoverable), `info` (lifecycle: sync start/finish, connection state), `debug` (dev only). No noisy info in hot paths.
- **Never log:** secrets, tokens, raw customer payloads beyond ids, PII beyond necessity (`13` SEC-6/NFR-15). A **log-scrubbing** middleware redacts known patterns (`13` §7).
- **Metrics:** RED for API; crawl/freshness/inference-precision/provenance-coverage for the graph (NFR-17); emit via `observability` helpers, not ad hoc.
- **Audit ≠ logs:** security-relevant events go to the **immutable audit log** (`13` §8), not just app logs.

---

## 9. Secure Coding Rules (realizes `13`)

| Rule | Enforcement |
|---|---|
| **Parameterized queries only** — no string-concatenated SQL | lint/review; ORM/query-builder; no raw interpolation |
| **Every repository query org-scoped** | base repository type requires `org_id` (CS-1, R8) |
| **No secrets in code/env-baked images/logs/DTOs** | secret-scanning in CI; Secrets Broker only (`13` §7) |
| **Validate/parse all external input** | Zod at boundaries (CS-2) — HTTP, webhooks, crawled payloads, env |
| **Crawled & LLM-adjacent content is data, never executed** | no `eval`, no dynamic require, content delimited for the LLM (`13` §9) |
| **Read-only to customer cloud** | no mutating SDK calls; **CI check scans for forbidden AWS actions / write APIs** (`13` §4, `14` §9) |
| **Webhook payloads HMAC-verified before trust** | `07` §5 |
| **Dependencies pinned + scanned** | lockfile committed; CI vuln scan (§11) |
| **No `dangerouslySetInnerHTML` / unsanitized HTML** | lint-banned in web; sanitize if ever needed |

---

## 10. Testing Standards (source-level; strategy in `14`)

- **Pure logic is unit-tested** (inference rules, normalize, parsers, confidence) with golden fixtures (`14` §3); **property tests** for invariants (`14` §4).
- **Tests assert documented contracts** (BR-x/US-x ids in test names/descriptions, A56) — traceable.
- **No test hits live external services** — providers mocked via their abstractions (`06`/`10`/`12`); hermetic fixtures (`14` §14).
- **Determinism:** inject `Date.now`/random/uuid via providers so tests are reproducible (`14` §19) — never call them directly in `domain`/`graph` (also: they're banned in pure packages).
- **Coverage is risk-weighted** (`14` §15) — critical core (inference/isolation/crawler/auth) ~95%+ + mutation-tested; trivial glue is type-checked.
- **A bug fix includes the regression test that would have caught it** (and an adversarial-playbook entry if it escaped gates — `14` §19).

---

## 11. Dependency Management (CS-7/CS-6)

- **Lockfile committed; exact/pinned versions**; renovate-style controlled updates (not auto-merge for majors).
- **Minimal dependencies** — prefer the platform/stdlib; every new dep is justified in the PR (bundle, maintenance, security surface). P10: boring, proven libs.
- **CI scans:** dependency vulnerability scan + license check + secret scan on every PR (`13` §11/§12). A high-severity vuln blocks merge (triaged per `13` §13).
- **No forking/patching** deps without a tracked reason; prefer upstream.
- **SDK pinning** (AWS/GitHub) — version-pinned so a provider change is a deliberate, tested upgrade (`06` AWR-3).

---

## 12. Git, Branch & Commit Conventions

- **Trunk-based** (`15` §7): short-lived branches off `main`; `feature/<area>-<short>`, `fix/...`, `chore/...`.
- **Conventional Commits:** `type(scope): summary` — `feat(aws-crawler): add ECS task-def signal`, `fix(graph): cycle guard in blast-radius`. Types: `feat|fix|refactor|test|docs|chore|perf|build`. Enables changelogs/semver.
- **Small, focused PRs** — one logical change; reviewable in minutes, not hours.
- **Every commit message** ends with the required co-author trailer (per repo policy).
- **No commit to `main` directly**; all via gated PR (`14` PR gates incl. adversarial agent).
- **Migrations** are their own reviewed PR or clearly isolated (`04` DD-6), never bundled silently.

### 12.1 Pull Request standard
A PR must: state **what & why**; link the **requirement id** (FR/US, `01`); update **docs first if a contract changed** (CS-8); include **tests** (DoD, `15` §5); pass **all PR gates** (lint/type/unit/property/integration/contract/**adversarial QA agent**, `14` §16); have **no unresolved confirmed agent findings**. **Reviewers** check: contract honored, invariants/types right, tenant-scoping present, no secrets, naming/consistency, test adequacy.

### 12.2 Code review guidelines
- Review for **correctness against the contract** first, style last (Prettier handles style — don't bikeshed).
- **Independence for adversarial value** (`14` QA-2): a second mind looks for how it breaks, not just whether it reads well.
- **Block on:** missing tenant scoping, secret exposure, missing trust qualities (provenance/confidence/states), un-typed errors, `any`, contract drift without doc update.
- **AI-agent PRs** get the *same* scrutiny (A63) — plus the adversarial QA agent (`14` §8).

---

## 13. Documentation Standards (CS-8)

- **Docs (`00`–`18`) are authoritative** — code conforms to docs; if reality must change a contract, **update the doc in the same PR** (CS-8, `14` §19).
- **Code comments** explain *why*, not *what* (the code says what). Public module interfaces have doc comments.
- **Decision records:** significant new decisions get a `DD-x` entry in the relevant doc (consistent with `00`–`15`), not a separate untracked ADR pile.
- **READMEs** per `apps/*` and `packages/*` — purpose, how to run, key entry points.
- **OpenAPI** is generated, not hand-written (`08` §14) — keep DTO decorators accurate.

---

## 14. Performance Expectations (realizes NFRs)

- **Respect the budgets** (`09` §11, NFR-1/2/3): bounded traversals (depth+node budget, `05` §7.4), cursor pagination (`08`), no unbounded queries, no N+1 (batch/dataloader where needed).
- **Pure functions are cheap to test but mind hot paths** — inference runs over many nodes; keep rule `match()` bounded and indexed (`05` IE-6).
- **Frontend:** code-split per route; defer heavy libs (canvas, charts) to their pages (`09` §11); virtualize large lists.
- **Measure before optimizing** (P10) — load tests (`14` §12) justify perf work; the `node_closure` escape hatch is *measured*, not premature (`04`/`05`).

---

## 15. AI Coding Agent Rules (A63)

> Atlas is built partly by AI agents; they are bound by this doc and add a few specifics.
- **Follow the docs as authoritative** (CS-8) — implement the contract (BR/FR/US/DD ids), don't invent behavior; if the doc is ambiguous, surface it (don't guess silently).
- **Stay in module boundaries** (CS-4) — don't reach across packages; use interfaces.
- **No new dependency without justification** (§11) — agents must not pull libs to shortcut.
- **Produce tests with code** (DoD) — including the contract assertions and property tests where applicable.
- **shadcn via MCP** (§6.1) — agents add UI through the registry workflow, adapt to tokens, never paste un-reviewed external UI.
- **Subject to the adversarial QA agent** (`14` §8) — agent-authored code is attacked like any other; confirmed findings block.
- **Never** weaken a security/tenant/trust control to make a test pass — fix the code, not the guardrail (`14` edge case: don't disable the gate).

---

## 16. Design Decisions Recap

| ID | Decision | Why |
|---|---|---|
| DD-1 | Monorepo, packages mirror module map, layered deps no cycles | Shared types + enforced boundaries (CS-4, `02`) |
| DD-2 | Max-strict TS + illegal-states-unrepresentable + parse-don't-validate | Highest-leverage bug prevention (CS-1/2) |
| DD-3 | shadcn via MCP, vendor + adapt-to-tokens, build-time only | Fast consistent UI, owned source, no runtime dep (`09` DD-3a) |
| DD-4 | Typed domain errors → one API envelope | Predictable, secure, no string errors (`08` §11) |
| (impl) | Pure core / imperative shell | Testable determinism (CS-5, `14`) |
| (impl) | Repository requires `org_id` in its type | Tenant scoping unforgettable (R8) |
| (impl) | Lint enforces boundaries, no-`any`, no-entity-return, no raw SQL | Compiler/CI as first reviewer (CS-9) |

## 17. Risks

| ID | Risk | Mitigation |
|---|---|---|
| CSR-1 | Standards ignored under deadline | CI-enforced (lint/type/scan gates block merge); not optional (CS-9) |
| CSR-2 | Module boundaries erode (`02` AR-4) | Import-boundary lint rule; periodic review; package-level deps |
| CSR-3 | `any`/casts creep in via SDK output | Parse-at-ingestion (CS-2); no-`any` lint; SDK output never into pure packages |
| CSR-4 | Inconsistent confidence/state UI | Mandatory certainty primitives + 4-state rule (§6, review-blocked) |
| CSR-5 | AI agents drift from conventions | This §15 + adversarial QA agent + same review bar (A63) |
| CSR-6 | shadcn defaults ship un-adapted | Adapt-before-commit rule + review (§6.1) |
| CSR-7 | Secret/SQL-injection slips in | Param queries + secret scan + Zod boundaries + review block (§9) |
| CSR-8 | Bikeshedding / style debates | Prettier auto-format; review correctness-first (§12.2) |

## 18. Edge Cases

- **A BR-x can't be a type/constraint** (cross-row, e.g. ≥1 Owner) → service-layer invariant + test (documented as such in `04`/`12`); the *exception* is explicit, not the rule.
- **Third-party type is wrong/missing** → wrap with a Zod-parsed boundary type; don't `any` it.
- **Perf forces an impure optimization in the core** → isolate it behind a pure interface; test the boundary; document the deviation (DD-x).
- **Doc and code disagree** → doc wins; fix doc-first in the same PR (CS-8) — unless the doc is wrong, then fix the doc and say why.
- **An agent proposes a clever abstraction** → consistency/boringness wins (CS-7) unless it clearly reduces risk.

## 19. Open Questions

- **OQ-CS-1** Exact lint ruleset & shared tsconfig presets (in `tooling/`) — finalized at F1 (`15`); this doc fixes the principles.
- **OQ-CS-2** Result-type library vs convention for `Result<T,E>` (§4.4) — team choice; consistency required.
- **OQ-CS-3** Monorepo tool (pnpm+Turborepo vs Nx) — A62 default; decided at F1.
- **OQ-CS-4** Commit co-author/trailer policy specifics — per repo setup.
- **OQ-CS-5** shadcn registry pinning/version policy (§6.1) — set with `tooling/` config.

## 20. References

- **Upstream:** `02` (modular monolith, boundaries, NestJS/Next.js, observability), `03` (entities, BR-x invariants), `04` (schema constraints, migrations), `05` (controlled vocab), `08` (DTOs, error envelope, OpenAPI gen), `09` (frontend, shadcn, certainty primitives, states), `13` (secure coding, secrets, read-only), `14` (testing strategy, gates, adversarial agent, DoD).
- **Downstream:** every code contribution (human or AI); `14` (CI gates these standards); `17` (pipeline runs lint/type/scan; `tooling/` config; shadcn registry setup).

---

### Change log
| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-06-30 | Founding Principal Architect | Initial coding gold-standard from `00`–`15` v1.0 |
