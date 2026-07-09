# Atlas — Product Requirements Document (Living)

> **What this is:** a consolidated, current-state PRD for Atlas — everything **shipped** today plus the **roadmap** ahead, in one place.
> **Relationship to other docs:** `docs/01-product-requirements.md` is the *blueprint* PRD (formal FR/NFR/US-x with Gherkin, written before the build). **This** document is the *living* view: what actually exists in the codebase now, and what's queued next. When the two disagree, `docs/01` defines the contract and this file records reality — see `docs/PROJECT-BOARD.md` for the authoritative task status.
> **Last updated:** 2026-07-09 · **Stage:** MVP built and running on live data (AWS + Bitbucket); GitHub crawler code-complete pending install creds; Phase P (polish/hardening) in progress → GA.

---

## 1. Product in one sentence

Atlas connects to a company's cloud (AWS, read-only) and code (GitHub / Bitbucket), builds a **continuously-updated knowledge graph** of their infrastructure + code + deployments + dependencies, and lets engineers understand it through a **visual map, search, and a cited AI interface**.

> **The governing principle — P1:** *The knowledge graph is the product. The AI is the interface.* Every requirement ladders back to graph correctness and trust, not chatbot polish.

---

## 2. Who it's for

| Persona | Need Atlas serves |
|---|---|
| **A — New/returning engineer** | "What do we run, and how does it fit together?" — onboard to an unfamiliar estate in minutes, not weeks. |
| **B — On-call / incident responder** | "What broke, what's the blast radius, and which change caused it?" — trace an alarm to the service, deploy, and PR. |
| **C — Staff / platform engineer** | "Where are the risks and single points of failure?" — posture, sprawl, toxic combinations across code + cloud. |
| **D — Eng leader** | "Is our estate healthy and well-owned?" — health, ownership, and activity at a glance. |
| **E — Security reviewer** | "Prove this is read-only and tenant-isolated." — the security package: IAM design, RLS isolation, provenance on every claim. |

---

## 3. Product principles (the non-negotiables)

- **P1 — Graph is the product, AI is the interface.**
- **P2 — Read-only by construction.** No code path can mutate a customer's cloud or repo; enforced at the IAM/App-permission layer.
- **P3 — Prefer a missing edge to a wrong edge.** High precision over recall; ambiguity → multiple low-confidence edges, never one wrong high-confidence one.
- **P4 — Provenance/citations on everything.** No un-sourced edges; every AI claim cites a real node or edge.
- **Trust is visible.** Observed vs inferred vs stale are distinct states; **"I don't know" is a designed answer**, never a fabrication.
- **Tenant isolation is existential (R8).** Every data path is org-scoped (app-role + composite FKs + Postgres RLS). Cross-tenant access returns 404, never 403.

---

## 4. Current features (shipped)

> Status key: ✅ live on real data · 🟢 code-complete, live-verify pending customer creds · 🧪 built + tested in-repo.
> Everything below is implemented, passes the CI gates (format/lint/typecheck/test + PG-RLS integration), and is running in the dev environment.

### 4.1 Platform & identity
- ✅ **Google sign-in** (Supabase-hosted OAuth; Atlas verifies the ES256 JWT via JWKS and mints no tokens). Login is a polished split-screen with legal pages (Terms / Privacy templates).
- ✅ **Organizations, roles & RBAC** — Owner > Admin > Member, enforced by guards. Create org (creator → Owner), rename org, manage members (change role, remove — with last-Owner and Owner-only invariants), invite teammates (capability-token invites), revoke invites. All surfaced in Settings.
- ✅ **Tenant isolation** — three enforcing layers (restricted `atlas_app` Postgres role + composite FKs + RLS with a per-request `atlas.current_org` GUC). Cross-tenant reads resolve to 404. Verified by dedicated integration tests.
- 🧪 **Append-only audit log** — security-relevant mutations (org/member/invitation/connection/demo) recorded to an append-only, org-scoped `audit_events` table; surfaced as an admin-only **Activity log** in Settings.
- ✅ **Personal profile** — edit your own name + avatar (Google photo, generated avatars, or geometric shapes), persisted across logins.

### 4.2 Connectors & ingest (filling the graph)
- ✅ **AWS crawler** (read-only) — connects via **STS AssumeRole + External ID** *or* **static access keys**; per-service permission probing → `degraded` with the exact missing IAM actions (never a silent gap, P3). 14+ service modules (VPC, Subnet, SecurityGroup, EC2, Lambda, ECS, ECR, ELB, Route53, RDS, S3, IAM-role; additive DynamoDB/ElastiCache/API-Gateway). Live-hardened: adaptive retry, pagination, incremental hash-diff (skip unchanged snapshots). **Running on a real account (~150–172 resources).**
- 🟢 **GitHub crawler** — GitHub App auth (installation token, read-only), CODEOWNERS + manifest + workflow-deploy parsing, webhook HMAC ingress. Code-complete; live verification pending an App install.
- ✅ **Bitbucket connector** — a real workspace (Siemba) is connected end-to-end (60 repos, 155 merged PRs, 30-day insights), proving the connector abstraction beyond the MVP design.
- ✅ **Durable encrypted secret store** — credentials stored via a broker as opaque refs (raw secret never on the row); survives restarts so re-sync works.
- 🧪 **Staged, safe sync** — plan → discover → normalize → persist → reconcile, each scope in one transaction; **partial-sync safety** (a failed scope never triggers false deletes, BR-SYNC-2); idempotent upserts by URN; orphaned-run self-healing reaper.
- ✅ **Sync visibility** — the Integrations hub shows live "Syncing…", "Last synced X ago · N resources · scopes skipped", and a missing-IAM-permissions hint on degraded connections.
- ✅ **Connection lifecycle** — connect → verify → sync; disconnect **purges** the source's entire subgraph (nodes/edges/signals/snapshots + orphaned derived nodes) behind a confirm dialog.

### 4.3 Knowledge graph & inference
- 🧪 **Graph-shaped store** — nodes + edges + provenance + raw snapshots + signals, with a deterministic dual identity (UUID + human-readable URN grammar). Composite FKs make cross-tenant edges structurally impossible.
- 🧪 **Inference engine (rules R1–R8 + R10)** — derives cross-source edges from observed signals: `DEPLOYS_TO` (code→infra), `CONNECTS_TO`/`STORES_IN` (env-refs, security-group reachability, IAM access), `IMPLEMENTS`/`RUNS` (derived `atlas.service`), `OWNED_BY`, `CHANGED_BY`. **Convergent** (re-running writes nothing), **retires rather than deletes**, and every inferred edge carries provenance + evidence + rule id. Precision harness: 100% on the labeled set.
- ✅ **R10 log-intelligence** — reverse-engineers what runs inside opaque compute from CloudWatch log-group names and links it to code, with honest confidence tiers (unique match → high, ambiguous → nothing).
- 🧪 **Confidence & freshness model** — every node/edge is **observed**, **inferred-high**, **inferred-low**, or **stale**, and the UI renders those states distinctly.
- 🧪 **Traversals** — bounded blast-radius (inbound impact) and dependencies (outbound needs), each impacted node carrying a **why-chain** (the edges back to root) and a **path confidence** (weakest link).

### 4.4 AI — Ask Atlas
- ✅ **Grounded, cited answers** — retrieval-first RAG over the graph; every factual claim binds to a real node/edge citation with a provenance link (P4). Claude in production, deterministic mock in dev/CI.
- ✅ **Agentic tool-calling loop** — 6 bounded read-only tools (search, get_node, get_neighbors, blast-radius, diagnose, timeline) let the AI "show its work"; streamed over WebSocket (with SSE fallback) and cancellable.
- ✅ **Honest absence** — out-of-scope or ungrounded questions return a designed "I don't know," never a fabrication (US-11). 7-layer anti-hallucination pipeline; AI eval set holds escaped-hallucination rate at 0.
- ✅ **Advisory answers** — a fact/advice trust model: findings are cited as facts, guidance is rendered as clearly-labelled recommendations (Well-Architected-style) with its own "recommendation" confidence tier.
- ✅ **Conversation memory + warm voice** — multi-turn context, deictic follow-ups ("explain that simpler"), bold/code formatting, peekable citations (a citation opens a resource peek drawer instead of navigating away), and per-answer copy.

### 4.5 Product surfaces (the app)
- ✅ **Dashboard** — estate-health score ring (honest heuristic roll-up), open-findings severity bar, source health, inventory stats, needs-attention rail, recent activity.
- ✅ **Infrastructure Map** (`/map`) — an operational instrument, not a static diagram: resources + connections framed into environment lanes; **Health lens** (recolour by runtime health — "what's on fire"), **blast-radius on click**, find/ask box, kind filters, collapsible unlinked shelves, and an in-canvas **cited AI chat** that spotlights the answer's citations on the graph.
- ✅ **Explore** (`/explore`) — list-first (a11y) node browser with multi-select facets (Type/Source/Health/Status), a **Health column**, result counts, an answer-first node detail page (health hero, key facts, risks, timeline, provenance), and a "why?" edge-evidence page.
- ✅ **Ask Atlas** (`/ask`) — full SSE/WS chat with the four designed states (empty / streaming / answered-and-cited / honest-absence), a sources rail, and history that marks map-started chats.
- ✅ **Insights** (`/insights`) — prioritized posture view: a "Fix first" strip, posture-by-pillar bars, a "this week" trend, a scannable findings table with lifecycle (open / regressed / fixed tabs, aging), **mute/accept-risk**, "I fixed it → recheck", per-finding "Ask Atlas how to fix", and an answer-first finding detail page (severity hero, personalized blast-radius impact, affected resources with health, numbered fix steps, lifecycle, provenance).
- ✅ **Integrations hub** — connect/verify/sync/disconnect AWS + GitHub + Bitbucket with sync visibility and least-privilege setup instructions (copy-ready IAM policy + External ID / App scopes).
- ✅ **Settings** — profile, organization identity (inline rename, role badge, member count, copyable org ID), member management, BYO-LLM model config, alert channels, and the audit activity log.
- ✅ **Onboarding** — empty-estate first-run: "Load sample data" (a seeded demo estate) for time-to-first-insight < 30 min, plus AWS/GitHub setup paths.

### 4.6 Operational intelligence (built slices)
- ✅ **Health layer** — runtime health annotations (RDS/DocDB/ECS/target-health) with a health poll; unhealthy resources surface red across map, Explore, and dashboard.
- ✅ **One-click Diagnose** — every degraded node has a "Diagnose with Atlas AI" button → auto-runs the culprit-tracing agentic loop (health + blast radius + change timeline → cited hypotheses).
- ✅ **Proactive notifications** — an in-app notification center (bell + inbox with resource icons) **plus** multi-channel push alerts (Slack / Discord / Microsoft Teams incoming webhooks) on health transitions, and a daily digest. This is the first retention mechanic.

### 4.7 Security & vulnerability intelligence (Phase 1)
- ✅ **Dependency intelligence, live end-to-end** — manifest parsing (npm / pypi / go / maven) → `external.package` nodes + `DEPENDS_ON_PKG` edges → **OSV.dev** enrichment → `security.vulnerability` nodes + `AFFECTS` edges → **Vulnerabilities / blast-radius / dependency-sprawl** findings in the dashboard and Ask Atlas (cited, with knowledge-pack guidance).
- ✅ **Cloud posture rules (first slice)** — world-open security groups, public-vs-name mismatch on load balancers, single-AZ databases, wildcard-IAM — deterministic findings on the real AWS estate with Well-Architected guidance.

### 4.8 Quality & hardening (in progress under Phase P)
- 🧪 **CI gates** — format + lint (no-`any`) + typecheck + unit tests + a Postgres RLS integration job + a production `next build` job, green on every push.
- 🧪 **Observability baseline** — request correlation ids + structured JSON access logs; the error envelope reuses the request id so logs, responses, and client correlate.
- 🧪 **Security headers** — `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy: no-referrer` on all API responses.

---

## 5. Roadmap (planned)

> Honest status: these are **not built yet** (or are infra-bound deferrals inside completed sprints). The binding build order is intact (F → I → G → P → GA). Tracked so nothing is silently lost.

### 5.1 Near-term — finish the MVP → GA (Phase P2 + deploy)
| Item | Why it's not done yet |
|---|---|
| **Production worker + Redis/BullMQ** | Queue/worker code exists; the dev API uses an in-process worker. A running worker process + Redis is a deploy-wiring step before live scheduled sync. |
| **Scheduler** | Per-connection incremental/nightly cadence, leader-elected, periodic health re-check + GitHub reconcile — lands with the worker process. |
| **Live GitHub verification** | Needs a customer App installation (app id + installation id + private key). Crawler is code-complete. |
| **OpenSearch hybrid search** | Search runs today on Postgres `pg_trgm` (keyword) behind a `SearchProvider`; the BM25 + kNN + embeddings driver is the deploy target. |
| **Adversarial QA agent + E2E / contract / load / mutation CI stages** | CI is format/lint/typecheck/test + PG-RLS integration today; the independent "try to break it" QA agent and heavier stages come online as PRs begin. |
| **DR drill + load/perf NFR validation** | Infra-bound; run against staging. |
| **AWS additive live discoverers** | DynamoDB/ElastiCache/API-Gateway service modules are built; their live fetch layer needs creds to verify. |
| **GitHub depth** | team→member resolution (US-10), IaC (Terraform/CloudFormation) ref parsing, more manifest ecosystems, multi-branch parse. |

### 5.2 Operational Intelligence — the north star (`docs/plans/operational-intelligence.md`)
"The map turns red when things break; the AI traces the alarm to the culprit PR." Read-only and agent-less; RCA is **cited hypotheses, never oracle claims**.
- **Phase A — Deploy inference** (repo→service, the keystone code↔infra edge) ∥ **Phase B — Health layer** ✅ *(built)*.
- **Phase C — Change timeline** — CloudTrail + deploys + PRs unified in `node_events`.
- **Phase D — AI incident tracing** ✅ *(Diagnose slice built)* — deepen with `get_pr_diff` and richer diagnose tools.
- **Phase E — Posture & advisory** 🟢 *(first rules live)* — expand the rule library.
- **CI/CD deployment linking** (`docs/07c`, Jenkins-first) — the **keystone**: upgrades `DEPLOYS_TO` from a naming *inference* to an *observed* fact via CI-declared targets, artifact digests, and deploy-tags — closing the code and infra graph islands into one system graph. Generalizes to GitHub Actions / GitLab / Argo / CodePipeline.

### 5.3 Security & Vulnerability Intelligence — Phase 2 (`docs/plans/security-vulnerabilities.md`)
- **The "exposed AND vulnerable" toxic combination** — cross code + cloud (a public, internet-reachable service running a vulnerable dependency). Unblocked now that AWS data is live.
- **Full AWS Well-Architected rule library** — `describe_config` / `find_by_condition` per-resource config tools + the broader posture rule set.

### 5.4 AI Knowledge Engine — later phases (`docs/plans/ai-knowledge-engine.md`)
- **P3 / P4** — deeper agentic retrieval, provider knowledge packs beyond the current set, and per-resource config reasoning tools (need the AWS config projections).

### 5.5 Backlog by version (`docs/15` §8)
- **v1.1 Trust & Depth** — richer inference, culprit-PR ranking (US-6), saved views / deep-links.
- **v1.2 Enterprise on-ramp** — multi-account AWS, **domain auto-join via Google `hd` claim**, real-time CloudTrail ingestion.
- **v1.3 Enterprise security** — SSO/SAML + SCIM, custom RBAC, SOC 2 Type II, data residency.
- **v2.0 Breadth** — GCP / Azure, GitLab, Datadog / PagerDuty.
- **v2.x Scale** — dedicated graph DB (when the `docs/05` trigger is met), partitioning.
- **v3.0 Platform** — proactive alerts, incident root-cause automation, **MCP / public API**, connector marketplace.

---

## 6. Non-goals (deliberately out of scope)
- **Not a mutation tool.** Atlas never writes to a customer's cloud or repo (P2). No remediation actions, no IaC apply.
- **Not an APM / metrics store.** It reads health signals to colour the graph; it is not a time-series monitoring product.
- **Not a chatbot.** The AI is grounded in the graph and refuses to answer beyond it; conversational breadth is explicitly secondary to citation integrity.
- **Not a general search engine.** Search is a projection over the graph, never a separate source of truth.

---

## 7. Success metrics
- **Trust** — % of AI answers fully cited to real nodes/edges; escaped-hallucination rate (target < 1%, currently 0 on the eval set).
- **Graph correctness** — inference precision on the labeled set (target ≥ 95%, currently 100%); zero cross-tenant leakage.
- **Activation** — time-to-first-insight after connecting a source (target < 30 min).
- **Retention** — weekly active engineers; notifications/diagnose engagement (the daily-relevance mechanics).
- **Coverage** — % of the estate observed vs inferred vs unknown, shown honestly in-product.

---

## 8. Cross-references
- **Formal requirements (FR/NFR/US-x + Gherkin):** `docs/01-product-requirements.md`
- **Where we are / task status:** `docs/PROJECT-BOARD.md`
- **Vision & principles:** `docs/00-project-overview.md` · **Architecture:** `docs/02` · **Graph & inference:** `docs/05`
- **AI engine:** `docs/10` · **Security:** `docs/13` · **Roadmap & DoD:** `docs/15`
- **Feature deep-dives:** `docs/plans/operational-intelligence.md` · `docs/plans/security-vulnerabilities.md` · `docs/plans/ai-knowledge-engine.md` · `docs/07c` (CI/CD linking)
