# Atlas — Product Requirements Document (Living)

> **What this is:** a consolidated, current-state PRD for Atlas — everything **shipped** today plus the **roadmap** ahead, in one place.
> **Relationship to other docs:** `docs/01-product-requirements.md` is the *blueprint* PRD (formal FR/NFR/US-x with Gherkin, written before the build). **This** document is the *living* view: what actually exists in the codebase now, and what's queued next. When the two disagree, `docs/01` defines the contract and this file records reality — see `docs/PROJECT-BOARD.md` for authoritative task status.
> **Last updated:** 2026-07-15 · **Stage:** MVP built and running on **live data** (AWS + Bitbucket + Jira); GitHub crawler code-complete pending install creds. Operational-intelligence + intent-verification + security/vulnerability + compliance-monitor epics shipped; a full **privacy/GDPR + security-hardening** pass landed. Remaining to GA is mostly deploy-wiring + org-level certification (SOC 2).

---

## 1. Product in one sentence

Atlas connects to a company's cloud (AWS, read-only) and code (GitHub / Bitbucket / Jira), builds a **continuously-updated knowledge graph** of their infrastructure + code + deployments + dependencies + intent, and lets engineers understand it through a **visual map, search, and a cited AI interface**.

> **The governing principle — P1:** *The knowledge graph is the product. The AI is the interface.* Every requirement ladders back to graph correctness and trust, not chatbot polish.

---

## 2. Who it's for

| Persona | Need Atlas serves |
|---|---|
| **A — New/returning engineer** | "What do we run, and how does it fit together?" — onboard to an unfamiliar estate in minutes, not weeks. |
| **B — On-call / incident responder** | "What broke, what's the blast radius, and which change caused it?" — trace an alarm to the service, deploy, and PR (the War Room). |
| **C — Staff / platform engineer** | "Where are the risks and single points of failure?" — posture, sprawl, toxic combinations across code + cloud. |
| **D — Eng leader** | "Is our estate healthy, well-owned, and did we build what we said?" — health, ownership, activity, and PR-vs-intent coverage. |
| **E — Security / compliance reviewer** | "Prove this is read-only, tenant-isolated, and controls-mapped." — the security package: IAM design, RLS isolation, provenance, audit, DSAR. |

---

## 3. Product principles (the non-negotiables)

- **P1 — Graph is the product, AI is the interface.**
- **P2 — Read-only by construction.** No code path can mutate a customer's cloud or repo; enforced at the IAM/App-permission layer (zero mutating SDK calls exist in the connectors).
- **P3 — Prefer a missing edge to a wrong edge.** High precision over recall; ambiguity → multiple low-confidence edges, never one wrong high-confidence one.
- **P4 — Provenance/citations on everything.** No un-sourced edges; every AI claim cites a real node or edge.
- **Trust is visible.** Observed vs inferred vs stale vs manual are distinct states; **"I don't know" is a designed answer**, never a fabrication.
- **Tenant isolation is existential (R8).** Every data path is org-scoped (restricted app-role + composite FKs + Postgres RLS + a per-request `atlas.current_org` GUC). Cross-tenant access returns 404, never 403.

---

## 4. Current features (shipped)

> Status key: ✅ live on real data · 🟢 code-complete, live-verify pending customer creds · 🧪 built + tested in-repo.
> Everything below is implemented, passes the CI gates (format/lint/typecheck/test + PG-RLS integration + prod build), and runs in the dev environment against live AWS + Bitbucket + Jira data.

### 4.1 Platform & identity
- ✅ **Google sign-in** (Supabase-hosted OAuth; Atlas verifies the ES256 JWT via JWKS and mints no tokens). Polished split-screen login with legal pages.
- ✅ **Organizations, roles & RBAC** — Owner > Admin > Member, enforced by guards, with last-Owner + Owner-only invariants. Create/rename org, manage + invite members (capability-token invites), revoke invites — all in Settings.
- ✅ **Tenant isolation** — three enforcing layers (restricted `atlas_app` role + composite FKs + RLS GUC). Cross-tenant reads resolve to 404. Verified by dedicated integration tests; a boot assertion refuses to start on a SUPERUSER/BYPASSRLS role.
- ✅ **Global authentication by default** — every route requires a valid bearer token unless explicitly `@Public()` (webhook / unsubscribe / health); removes the "forgot a guard" failure mode.
- ✅ **Append-only audit log** — security-relevant mutations (org/member/invitation/connection/LLM-config/alert-policy/data-export/person-erase/demo) recorded to an append-only, org-scoped table; surfaced as an admin-only **Activity log** in Settings.
- ✅ **Personal profile + per-user email preferences** — edit your name/avatar; toggle incident-alert and weekly-digest emails per workspace.

### 4.2 Connectors & ingest (filling the graph)
- ✅ **AWS crawler** (read-only) — STS AssumeRole + External ID *or* static keys; per-service permission probing → `degraded` with the exact missing IAM actions (P3). 14+ service modules; adaptive retry, pagination, incremental hash-diff. Running on a real account (~150 resources, health + metrics).
- ✅ **Bitbucket connector** — a real workspace (Siemba) connected end-to-end (60 repos, 155+ merged PRs, insights), proving the connector abstraction beyond MVP.
- ✅ **Jira connector** — classic-token auth, `/search/jql` crawl, per-connection intent-field discovery (Acceptance Criteria / DoD / Remediation), **reference-driven crawl** (fetch exactly the ticket keys the code references — cost ∝ what's referenced, not the whole backlog). 275 issues synced live.
- 🟢 **GitHub crawler** — GitHub App auth (read-only), CODEOWNERS + manifest + workflow-deploy parsing, webhook HMAC ingress. Code-complete; live verify pending an App install.
- ✅ **Durable encrypted secret store** — AES-256-GCM, key from env (never in DB), fail-closed; credentials stored as opaque refs. **Deleted on disconnect** and on org-delete.
- ✅ **Staged, safe sync** — plan → discover → normalize → persist → reconcile per scope in one transaction; partial-sync safety; idempotent URN upserts; orphaned-run self-healing reaper; observed-edge convergence.
- ✅ **Sync visibility** — the Integrations hub shows live "Syncing…", "Last synced X ago · N resources · scopes skipped", a missing-IAM-permissions hint, and an **egress-IP allow-list note** + unreachable-connection ("needs VPN/whitelist") detection.
- ✅ **Connection lifecycle** — connect → verify → sync; disconnect **purges** the source's entire subgraph + snapshot blobs + the stored credential behind a confirm dialog.

### 4.3 Knowledge graph, inference & manual curation
- ✅ **Graph-shaped store** — nodes + edges + provenance + raw snapshots + signals, dual identity (UUID + human URN grammar). Composite FKs make cross-tenant edges structurally impossible.
- ✅ **Inference engine (R1–R18)** — derives cross-source edges: `DEPLOYS_TO` (incl. image-tag / env-stamped commit-SHA matching, R17), `CONNECTS_TO`/`STORES_IN`, `IMPLEMENTS`/`RUNS`, `OWNED_BY`, `CHANGED_BY`, `EXPOSED_VIA` (R16), `PROTECTS`, log-group attribution (R10). **Convergent**, retires-not-deletes, provenance + evidence + rule id on every edge. Precision harness green.
- ✅ **AI-assisted edge suggestions** — beyond deterministic matching, an LLM proposes repo↔runtime links (Lambda/ECS/EC2) badged **"AI-suggested"** (lowest trust); the user confirms (→ promoted) or rejects (→ remembered, never re-proposed).
- ✅ **Manual graph editing** — a person can hand-draw a link the graph missed ("fix the flow") via a search-based "Connect to…" dialog, and remove a wrong inferred/suggested link. Manual edges are `origin='manual'` (human-vouched); a removed link is remembered so inference never re-adds it.
- ✅ **Confidence & freshness model** — observed / inferred-high / inferred-low / ai-suggested / manual / stale, rendered distinctly in the UI.
- ✅ **Traversals** — bounded blast-radius (inbound) + dependencies (outbound), each impacted node carrying a why-chain + path confidence (weakest link).

### 4.4 AI — Ask Atlas
- ✅ **Grounded, cited answers** — retrieval-first RAG over the graph; every factual claim binds to a real node/edge citation (P4). Claude in prod, deterministic mock in dev/CI; per-org BYO-LLM key supported (AES-GCM stored).
- ✅ **Agentic tool-calling loop** — bounded read-only tools (search, get_node, get_neighbors, blast-radius, diagnose, timeline, get_pr_diff) let the AI show its work; streamed over WebSocket (+ SSE fallback), cancellable.
- ✅ **Honest absence + grounding gate** — out-of-scope/ungrounded questions return a designed "I don't know" (US-11); deterministic citation + suppression gates; AI eval escaped-hallucination rate 0.
- ✅ **Advisory answers** — fact vs advice trust model; guidance rendered as clearly-labelled recommendations with its own confidence tier.
- ✅ **Conversation memory + peekable citations** — multi-turn context, deictic follow-ups, a citation opens a resource peek drawer, per-answer copy.

### 4.5 Product surfaces (the app)
- ✅ **Dashboard** — estate-health ring, open-findings severity bar, source health, inventory, needs-attention rail, recent activity. (Heavy summary read is cached per-org.)
- ✅ **Infrastructure Map** (`/map`) — an operational instrument: resources + connections as one left-to-right flow; **Health / Changed / Exposed / Security lenses**, blast-radius on click, find/ask box, kind filters, collapsible unlinked shelves, an in-canvas **cited AI chat** that spotlights citations on the graph, "Connect to…" manual linking, and a **"Load full map"** action for large estates.
- ✅ **Explore** (`/explore`) — list-first (a11y) node browser with multi-select facets + Health column; answer-first node detail (health hero, key facts, risks, timeline, provenance); "why?" edge-evidence page.
- ✅ **Ask Atlas** (`/ask`) — full SSE/WS chat with the four designed states, a sources rail, and history.
- ✅ **Insights** (`/insights`) — prioritized posture: "Fix first" strip, posture-by-pillar bars, trend, findings table with lifecycle (open/regressed/fixed, aging), mute/accept-risk, "I fixed it → recheck", per-finding "Ask Atlas how to fix", and answer-first finding detail (severity hero, personalized blast-radius, affected resources, numbered fix steps, provenance).
- ✅ **Integrations hub** — connect/verify/sync/disconnect AWS + GitHub + Bitbucket + Jira with sync visibility, least-privilege setup, and egress-IP guidance.
- ✅ **Settings** — profile, org identity, member management, BYO-LLM config, alert policy + channels, email preferences, **Privacy & data** (DSAR export + person erasure), the audit activity log, and the danger zone.
- ✅ **Onboarding** — empty-estate first-run with "Load sample data" + AWS/GitHub setup paths.
- ✅ **Motion system** — subtle, reduced-motion-safe entrance + interaction animations across pages (surfaces, tabs, notifications, the map, the War Room replay).

### 4.6 Operational intelligence (the north star — shipped)
- ✅ **Health layer** — runtime health (ELB target-health / ECS running-vs-desired / RDS status / CloudWatch alarms + Lambda metric-health) polled; unhealthy resources go red across map, Explore, dashboard.
- ✅ **Change timeline** — deploys + config-changes + merged-PRs + alarm transitions unified in `node_events`, driving "what changed lately" and RCA correlation.
- ✅ **One-click Diagnose** — every degraded node → the culprit-tracing agentic loop (health + blast radius + change timeline → cited hypotheses, ranked verdict).
- ✅ **War Room** — a dedicated incident page: a live blast-radius map + a streamed, cited diagnosis (each step a real tool call lighting the graph) + a ranked "likely cause" verdict, persisted to Insights and **replayed** when reopened.
- ✅ **Proactive notifications** — in-app bell/inbox **plus** multi-channel push (Slack / Discord / Microsoft Teams webhooks) on health transitions, a daily digest, and per-user opt-outs.

### 4.7 Intent verification (spec → code)
- ✅ **PR-implements-issue linking (R18 + fuzzy)** — links PRs to the Jira ticket they implement, by explicit key and by a deterministic fuzzy matcher (title/branch overlap + temporal + author↔assignee signals) when no key is present; ambiguity → nothing (P3). Live: 163 PRs linked.
- ✅ **Coverage judge** — given a ticket's intent (acceptance criteria / remediation / description) + the PR diff, an LLM judges per-criterion whether the code actually implements it, with a **deterministic suppression gate** (an "implemented" claim without a valid hunk cite is downgraded). Fills the silent-wrong-no-signal gap op-intel can't.

### 4.8 Security, vulnerability & compliance intelligence
- ✅ **Dependency intelligence (Phase 1)** — manifest parsing (npm/pypi/go/maven) → `external.package` + `DEPENDS_ON_PKG` → **OSV.dev** enrichment → `security.vulnerability` + `AFFECTS` → Vulnerabilities / blast-radius / dependency-sprawl findings (cited, with guidance).
- ✅ **Cloud posture rules** — world-open security groups, public-vs-name LB mismatch, single-AZ DBs, wildcard-IAM, root-no-MFA, public buckets, unencrypted data, no-CloudTrail — deterministic findings with Well-Architected guidance.
- ✅ **Exposed-AND-vulnerable toxic combination (Phase 2)** — cross code + cloud: an internet-reachable service (R16 `EXPOSED_VIA`) running a vulnerable dependency, deep-linked into the map's Exposed lens.
- ✅ **Compliance monitor** — a technical-controls monitor across **6 frameworks** (PCI / CIS / NIST / ISO / HIPAA / GDPR) from one shared control catalog, with an honest **"not assessable"** state (never a fabricated pass). *(This is a customer-facing feature — it helps customers with their compliance; it is distinct from Atlas-the-company's own certification, see §5.3.)*

### 4.9 Privacy & data governance (Atlas-as-a-system)
- ✅ **Erasure on disconnect / org-delete** — disconnect purges the subgraph + the stored credential + the raw snapshot blobs; org-delete cascades every row and erases Storage objects (snapshots + logo). No orphaned PII.
- ✅ **Retention** — a daily cross-org sweep purges rows past their window (raw snapshots 30d, activity 365d, sync history 90d) + the aged blobs. Audit is kept long.
- ✅ **DSAR — right of access + right to be forgotten** — an admin can **export** the personal data Atlas holds for the org (members + ingested contributor identities), and **erase a person** (redact their identity + scrub their name from author/assignee/reporter fields), **durably** re-applied after every sync so a re-crawl can't undo it. Surfaced as a **Privacy & data** settings card.
- ✅ **Secrets & transport hardening** — AES-256-GCM secrets (fail-fast if the key is unset in prod), SSRF-safe webhook validation, PII masked in logs, `nonce`-based CSP + HSTS on the web app, nosniff/frame/referrer on the API, locked CORS, durable rate limiting.

### 4.10 Extensibility (Phase-2 contingencies, staged)
- ✅ **SIFT integration** (`/sift`) — a setup surface for a code-review/ticket-intelligence connector (model / review-effort / test-depth config over real repos), staged as a **"Coming soon"** Phase-2 contingency that further proves the connector abstraction.

### 4.11 Quality & hardening
- ✅ **CI gates** — format + lint (no-`any`) + typecheck + unit tests + a Postgres RLS integration job + a production `next build` job; green on every push.
- ✅ **Observability baseline** — request correlation ids + structured JSON access logs; the error envelope reuses the request id; 500s sanitized (no stack/SQL leak).
- ✅ **Performance pass** — per-org dashboard-summary cache (single-flight), `/graph` payload slimmed to scalar attributes (−34.5% measured), inference existence-check batched to one preload; navigation feel (prefetched skeletons, `staleTimes`).
- 🧪 **Adversarial QA agent + E2E/contract/load/mutation CI stages** — designed; come online as PRs begin.

---

## 5. Roadmap (planned)

> Honest status: **not built yet** (or infra-bound deferrals). Tracked so nothing is silently lost.

### 5.1 Near-term — finish the MVP → GA (deploy)
| Item | Why it's not done yet |
|---|---|
| **Production worker + Redis/BullMQ + scheduler** | Queue/worker/scheduler code exists; the dev API uses an in-process worker. A running worker + Redis is a deploy-wiring step. |
| **DB co-location (Sydney compute)** | Platform is round-trip-bound to the Sydney DB; deploying compute in-region is the dominant prod-latency lever (no data move). |
| **OpenSearch hybrid search** | Runs today on Postgres `pg_trgm` behind a `SearchProvider`; BM25 + kNN + embeddings is the deploy target (also unblocks enterprise-scale fuzzy intent-linking). |
| **Live GitHub verification** | Needs a customer App installation; crawler is code-complete. GitHub `get_pr_diff` is the one remaining connector gap (build during onboarding — needs a live installation to verify). |
| **DR drill + load/perf NFR validation + adversarial-QA/E2E CI** | Infra-bound; run against staging. |

### 5.2 Deepen the built epics
- **Op-intel** — CI/CD deployment linking (`docs/07c`, Jenkins-first): upgrade `DEPLOYS_TO` from a naming *inference* to an *observed* fact via CI-declared targets + artifact digests. AWS logs/GetMetricData grants unlock log-based incident onset + Phase-2b posture tail.
- **Security** — full AWS Well-Architected rule library + per-resource `describe_config` reasoning tools.
- **Intent verification** — scale fuzzy linking through OpenSearch top-K; richer intent-field extraction.

### 5.3 Compliance & enterprise (org + product)
- **SOC 2 Type II** — the technical control set is largely in place (see `docs/SOC2-CONTROLS-MAPPING.md`); remaining is org/process (policies, access reviews, vendor DDQ, pen test, evidence tooling) + an auditor. **First certification to pursue.**
- **ISO 27001** (international/enterprise), **HIPAA** (only if targeting healthcare — needs BAAs incl. the LLM provider), **CMMC** (only if targeting US DoD — needs US-region infra). See `docs/SOC2-CONTROLS-MAPPING.md` §6.
- **Legal finalization** — the privacy-policy draft (`app/legal/privacy`) is aligned to reality but needs counsel to set lawful basis / SCCs / DSAR turnaround; a **DPA** + finalized **Terms** are net-new legal docs.
- **Enterprise on-ramp** — SSO/SAML + SCIM, custom RBAC, data residency, domain auto-join via Google `hd`, multi-account AWS.

### 5.4 Breadth & scale (later)
- GCP / Azure, GitLab, Datadog / PagerDuty · dedicated graph DB (when the `docs/05` trigger is met) + partitioning · MCP / public API · connector marketplace.

---

## 6. Non-goals (deliberately out of scope)
- **Not a mutation tool.** Atlas never writes to a customer's cloud or repo (P2). No remediation actions, no IaC apply.
- **Not an APM / metrics store.** It reads health signals to colour the graph; it is not a time-series monitoring product.
- **Not a chatbot.** The AI is grounded in the graph and refuses beyond it; conversational breadth is secondary to citation integrity.
- **Not a general search engine.** Search is a projection over the graph, never a separate source of truth.

---

## 7. Success metrics
- **Trust** — % of AI answers fully cited to real nodes/edges; escaped-hallucination rate (target < 1%, currently 0 on the eval set).
- **Graph correctness** — inference precision on the labeled set (target ≥ 95%); zero cross-tenant leakage.
- **Activation** — time-to-first-insight after connecting a source (target < 30 min).
- **Daily relevance** — incident/diagnose/War-Room engagement; notification opens; intent-coverage reviews.
- **Coverage** — % of the estate observed vs inferred vs unknown, shown honestly in-product.

---

## 8. Cross-references
- **Formal requirements (FR/NFR/US-x + Gherkin):** `docs/01-product-requirements.md`
- **Where we are / task status:** `docs/PROJECT-BOARD.md`
- **Vision & principles:** `docs/00` · **Architecture:** `docs/02` · **Graph & inference:** `docs/05` · **AI engine:** `docs/10`
- **Security:** `docs/13` · **SOC 2 controls mapping:** `docs/SOC2-CONTROLS-MAPPING.md` · **Roadmap & DoD:** `docs/15`
- **Feature deep-dives:** `docs/plans/*` (operational-intelligence, security-vulnerabilities, war-room, intent-verification, ai-knowledge-engine) · `docs/07c` (CI/CD linking)
