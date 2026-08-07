# Plan — Operational Intelligence (health → trace → advise)

> **Status:** 📋 **Captured 2026-07-05 — not started.** The product owner's north star, in his words: *"things are connected and I should be able to figure out what's breaking… my AI should trace the issue, map it to the codebase, and tell me which PR probably broke it — and later tell customers how their infra should improve, personalized."*
> **Feasibility verdict (be honest, always):** every layer is buildable **read-only, agent-less** (P2 holds throughout). Two expectation-settings: (1) process-level truth on raw EC2 depends on the customer having the standard **SSM agent** enabled (most do); (2) AI root-cause is **ranked, evidence-cited hypotheses**, not oracle answers — which is the version an engineer trusts anyway (P3/P4 are the moat here, not a limitation).
> **Why Atlas can do this and point tools can't:** the answer to "what broke?" spans **cloud health + topology + deploys + code changes**. Datadog sees metrics, GitHub sees PRs; neither holds the cited path *alarm → service → deploy → PR diff* in one graph. We do — that traversal **is** the product (P1).

---

## Where we honestly are today

The map is an **inventory**, not an operational picture. Three gaps define this plan:

1. **Nothing can turn red.** Zero runtime signal is crawled; the only per-node "status" is sync freshness. A dead service and a healthy one render identically.
2. **We know what's *provisioned*, not what's *running*.** ECS cluster yes; its running tasks + the exact images they execute, no. EC2 instance yes; what's on it, no.
3. **No code↔infra bridge.** Bitbucket repos/PRs/pipelines and the AWS estate share a graph but no `DEPLOYS_TO` edge links them — so "trace the broken service back to the PR" has nothing to walk. **This missing edge is the keystone; it ships first.**

## Graph model (delta)

**Node-kind changes:** none required in Phase A–B beyond what exists; Phase B adds a `health` dimension to nodes (distinct from freshness — trust stays legible: `healthy | degraded | unhealthy | unknown`, and `unknown` is a designed state, never faked, docs/09 §7).

**New / strengthened edges:**
```
bitbucket.repository --DEPLOYS_TO--> aws.ecs.service | aws.lambda.function   (inferred, tiered)
aws.ecs.taskdef      --USES_IMAGE--> aws.ecr.repository                      (observed — exists today, I1.3)
aws.elb              --ROUTES_TO---> targets                                 (observed — exists today)
```

**New time-indexed store — `node_events`** (org-scoped, RLS, composite FK to nodes): `kind: deploy | config_change | pr_merged | alarm_transition | health_transition`, `occurred_at`, `actor`, `evidence` (jsonb), `provenance_id`. The graph answers "what is"; this table answers "**what changed, when, by whom**" — the raw material of every root-cause story. (Signals stay crawl-scoped inference inputs; events are durable operational history. Different lifecycle → different table.)

## Phases

### Phase A — Deploy inference: the code↔infra bridge *(keystone, ships first)*

Derive `repo —DEPLOYS_TO→ service` with tiered confidence (docs/05 discipline — multiple low-confidence edges over one wrong high-confidence one, P3):

| Evidence | Tier |
|---|---|
| ECS task-def image URI → ECR repo whose name matches a crawled repo slug **and** that repo's `bitbucket-pipelines.yml` pushes to that ECR URI | high (two independent witnesses) |

> **ECR-push evidence comes in two forms, and only one was being read.** A raw image URI
> (`<acct>.dkr.ecr.<region>.amazonaws.com/<repo>`) *or* Atlassian's `aws-ecr-push-image` pipe, which
> never writes that URI — it names the account (inside `AWS_OIDC_ROLE_ARN`), region and `IMAGE_NAME`
> as separate pipe variables. The parser matched only the URI form, so the pipe style — the
> idiomatic Bitbucket one — yielded **no evidence at all**. Confirmed against production: zero
> occurrences of `dkr.ecr` across every pipeline file in the estate, while `aws-ecr-push-image`
> appears in each one that deploys. The parser now reassembles the reference from the pipe
> variables, and reads `aws-lambda-deploy` (`FUNCTION_NAME`) and `aws-ecs-deploy`
> (`CLUSTER_NAME`/`SERVICE_NAME`) the same way. All-or-nothing per reference: if account, region or
> repository fails to resolve to a literal, the whole thing is dropped rather than half-trusted (P3).
| Image-URI ↔ repo-slug match alone | medium |
| Name/tag convention only (`repo`/`service`/`aws:cloudformation:stack-name` tags, Lambda naming) | low, shown as such |

Deliverables: pipeline-yml fetch in the Bitbucket connector (we already fetch file content for manifests — same mechanism), inference rules in the existing engine (they're just new R-rules), edges on map/Explore/impact. **Exit:** clicking `calsaws-chat-*` shows *which repo ships it*, cited to the evidence.

#### Compute is plural — design for **all runtimes, all clouds** (not ECS/Lambda-specific)

`DEPLOYS_TO` must NOT be an ECS rule. The invariant across every runtime and cloud: **code reaches
runtime through an *artifact* that carries *provenance* (a git SHA / repo ref / build id).** So the
bridge is a rule over two abstractions, not over service names:

```
compute_target --RUNS_ARTIFACT--> artifact --BUILT_FROM--> repo@sha
                └──────────────── compose ────────────────┘
                  repo --DEPLOYS_TO--> compute_target   (derived, tiered)
```

Each connector/service-module contributes **witnesses** through one shared interface — "the artifact
this node runs" + "the provenance on that artifact." Adding a runtime = write a witness extractor; the
bridge rule is written **once**. (Note: **Fargate is not a separate service** — it's an ECS/EKS launch
type; the task-def + image URI are identical, so ECS coverage includes Fargate for free.)

Coverage is a **confidence gradient** (P3 — tier reflects how directly the artifact is knowable):

| Compute target | Artifact / provenance path | Tier |
|---|---|---|
| ECS (EC2 **or** Fargate) | task-def image URI → ECR; SHA in image tag | high (have the data) |
| Lambda | zip/image; `CodeSha256`, image tag, SHA in description | high |
| App Runner / Beanstalk / Batch | image, or a **direct repo reference** | high when a repo link exists |
| EKS / Kubernetes | pod images — AWS IAM alone can't see *running* pod images; needs cluster RBAC, or infer from the ECR-push side | medium/low, flagged |
| Raw EC2 | AMI provenance (Packer tags) / SSM inventory / `repo`/stack tags | low — often `unknown`, stated |
| **Azure** (App Service / Container Apps / AKS / Functions / VMs) | ACR image, or App Service deployment-center **direct repo link** | same model |
| **GCP** (Cloud Run / GKE / Cloud Functions / GCE / App Engine) | Artifact Registry image; **Cloud Build native git provenance** (often the strongest signal) | same model |

`unknown` stays first-class — a bare EC2 box with no tags/SSM gets **no fabricated edge** (P3).

**Build discipline:** v1 *implements the witness extractors* for ECS(+Fargate) + Lambda (what the live
calsaws estate has data to verify against), but the **abstraction — `compute_target`/`artifact` node
roles, `RUNS_ARTIFACT`/`BUILT_FROM`/`DEPLOYS_TO` edges, the witness interface, and the tiered inference
rule — is general from day one.** EC2, EKS, App Runner, Azure, GCP are each "add one extractor," never a
redesign.

**DELIVERED (Lambda deploy-provenance witnesses complete).** The high-confidence Lambda tier is rule
**R17** (`lambda_commit_provenance`, `packages/inference/src/rules/r17-lambda-commit.ts`): it promotes a
name/ARN-tier Lambda `DEPLOYS_TO` to `inferred-high` when a **git SHA** off the container **image tag**,
the **`Description`**, a **function tag** (`git-sha`/`commit`/`revision`), or a **commit-keyed env var**
prefix-matches a crawled PR commit — ambiguity → multiple `inferred-low` (P3). `CodeSha256` is
deliberately **never** matched (a zip hash, not a git SHA). ECS's analogue is R12 (image-tag SHA) + the
R1 ECR chain. This pass closed the one **dead witness** in production: Lambda **tags were never
crawled** (`ListFunctions` omits them), so R17's tag path never fired live. The discoverer now captures
tags — free from `GetFunction.Tags` for container Lambdas, a targeted `lambda:ListTags` for zip Lambdas
— best-effort, with a `lambda:ListTags` posture probe (already covered by the granted `lambda:List*`, so
**no new grant**; lights up on the next re-sync). **Remaining Phase-A polish:** duplicate-tier collapse;
extractors for EC2/EKS/App Runner/Azure/GCP (each additive).

### Phase B — Health layer: the map turns red *(can build in parallel with A)*

New read-only collectors, same crawl pattern as I1.3 modules:

| Signal | API (all read-only) |
|---|---|
| Alarm states | `cloudwatch:DescribeAlarms` |
| Target health ("2 of 3 unhealthy") | `elasticloadbalancing:DescribeTargetHealth` |
| Lambda errors/throttles, key metrics | `cloudwatch:GetMetricData` |
| ECS service events, running vs desired tasks, task images | `ecs:DescribeServices`, `ecs:ListTasks` + `ecs:DescribeTasks` |
| RDS status | already in `rds:DescribeDBInstances` |
| What's on raw EC2 (packages/services) | `ssm:DescribeInstanceInformation` + `ssm:ListInventoryEntries` — **only if the customer runs the SSM agent**; absent ⇒ `unknown`, stated, never guessed |

**Cadence:** full crawls are minutes-heavy; "is it broken *now*" needs a **health-only poll** — a new lightweight sync type (`type: 'health'`, cheap calls only, every 1–2 min, BR-SYNC-1-safe since it's a distinct type). Health transitions append to `node_events`.

**Surfaces:** red/amber ring on map nodes + health in the detail panel; findings ("`calsaws-prod-elb`: 2/3 targets unhealthy"); dashboard trust strip. **Exit:** kill a test target → map shows red within ~2 min, finding cites the CloudWatch/ELB evidence.

**DELIVERED (health layer built; lights up on a valid-key AWS re-sync).** Collectors (`packages/connector-aws/src/health-collect.ts`: CloudWatch alarms, ELB target health, ECS running-vs-desired + rollout, RDS status, Lambda error metrics — worst-wins merge, denied probes surfaced never dropped) → interval-gated in-process **health poller** (`HEALTH_INTERVAL_MINUTES`) → `attributes.health` + `node_events` `health_transition` (`packages/ingest/src/health-apply.ts`). Surfaces built: **map red/amber ring + health lens**, **detail-panel health row**, the **"service-health" finding** (broken-right-now, worst-first, cited), the **dashboard live-health trust strip** (`HealthStrip` off a new `DashboardSummary.health` rollup: `monitored`/`unhealthy`/`degraded`/`checkedAt`/`top[]`, three honest states incl. render-nothing when nothing is monitored — `unknown` never faked as healthy), and **`alarm_transition` change-timeline events** — each firing CloudWatch alarm now lands as a distinct event on its node's timeline (named alarm + metric + reason), keyed on the alarm's own `StateUpdatedTimestamp` so a firing records once and a re-fire is a new event; the health_transition still carries the derived node state, this names *which* alarm fired (RCA). The collector carries firing alarms out (`HealthCollectResult.alarms`), the poller writes them via the existing idempotent `applyNodeEvents`, and the Change Timeline already renders the kind (Bell / "Alarm"). **Remaining:** alarm *recovery* (→OK) events are not emitted (would need fetching OK-state alarms + prior-state tracking; the node's later health_transition already shows recovery) — v1 scope; Lambda `GetMetricData` + the productionised (queue-backed) poller are grant/infra-gated.

### Phase C — Change timeline: what changed, when, by whom

- **CloudTrail** `cloudtrail:LookupEvents` — 90 days of management events with zero customer setup: "SG `calsaws-db-sg` modified by X at 14:02". Mapped to nodes by ARN/name → `config_change` events.
- **Pipeline runs** (Bitbucket API, already authenticated) → `deploy` events with timestamps onto the Phase-A `DEPLOYS_TO` edges.
- **Merged PRs** (already crawled) → `pr_merged` events on their repo.

**Exit:** a node's detail view shows a unified, cited timeline: *deployed 13:58 · SG changed 14:02 · alarm fired 14:05*.

**DELIVERED (2026-07-22).** `node_events` (0024) + writers (CloudTrail `config_change`, health-poll `health_transition`, derived Lambda/ECS `deploy`) and the `GET /nodes/:id/events` feed were built at A–D. This pass closed the *unified* + *cited* + *filterable* gaps:
- **Cross-node unification (the north-star join):** a service/Lambda's timeline now also surfaces the merged PRs of every repo that `DEPLOYS_TO` it, cited with the deploying repo + `via: 'DEPLOYS_TO'` in evidence (P4). So a runtime node reads *PR merged → deployed → alarm* on one node — previously PR merges only appeared on the *repository* node, so "service broke → which PR" was broken. (`graph.service.ts nodeEvents`.)
- **Provider-agnostic PR matching:** the derivation matched only `%.pullrequest` (bitbucket), silently dropping every GitHub PR (`.pull_request`). Now matches both.
- **Filter + bound:** `GET /nodes/:id/events?kind=deploy,pr_merged&limit=N` (`NodeEventsQuerySchema`); UI filters client-side over the fetched feed.
- **One cited renderer:** `ChangeTimeline` (Explore) with the full kind taxonomy (icons/colors from the shared `lib/event-taxonomy.ts`), per-event citation links (PR node + "via deploy"), kind-filter chips, show-more. War Room's timeline now shares that taxonomy (single source of truth). Regression-tested (`graph.service.test.ts`, real PG).
- **Deferred:** `alarm_transition` ingestion (enum/UI ready, no writer — `health_transition` already carries the "broke" signal; individual CloudWatch-alarm history is a separate build). CloudTrail `config_change` still needs the pending `cloudtrail:LookupEvents` grant to populate live.

### Phase D — AI incident tracing *(needs B + C; A multiplies its value)*

New tools in the existing agentic retrieval loop (KE-P1 — the loop, grounding gate, and citation binding are already built and evaluated):

- `diagnose(nodeId, window)` — health state + upstream/downstream blast radius + all `node_events` in the window, ranked by (temporal proximity × graph distance).
- `get_pr_diff(prId)` — fetch the actual diff on demand (read-only Bitbucket API) so the model can reason "PR #482 touched `db/pool.ts`; the failing Lambda talks to that DB."

Output contract: **ranked hypotheses, each citing its evidence chain** (alarm → service → deploy edge → PR), and honest absence when the window is quiet ("no deploys or config changes in the 6h before the alarm — likely external/capacity; here's what I checked"). Eval-set additions: golden incident scenarios (seeded fault + planted PR) and the adversarial case — **a quiet timeline must produce "no likely culprit found", never an invented one** (the escaped-hallucination-zero bar from G3 applies).

### Phase E — Posture & personalized advisory *(the "tell me how my infra should improve")*

Deterministic rule library over the real graph — findings, not vibes: SG open to `0.0.0.0/0` reaching a datastore · public ALB with no WAF · single-AZ prod RDS · unencrypted storage · wildcard IAM · **exposed AND vulnerable** (the toxic combo — `docs/plans/security-vulnerabilities.md` Phase 2, now unblocked by live AWS). Each feeds the existing advisory path (KE-P2 knowledge packs: facts cited, advice labelled). Personalization is structural: rules fire on *their* graph, the AI narrates *their* paths — not generic best-practice prose.

**STATUS (2026-07-22) — mostly built; the engine is inline in `GraphService.summary()` (posture SQL in the `grpTopology` group → `Finding[]`), and the compliance monitor (`packages/ai/src/compliance.ts`) consumes those findings by `findingId`.** Already live: `sg-world-open` (world-open SG on a sensitive port), `iam-wildcard`, `rds-single-az`, `unencrypted-datastore` (RDS+S3), `exposed-vulnerable` (the toxic combo, walking `EXPOSED_VIA ← DEPLOYS_TO → DEPENDS_ON_PKG ← AFFECTS`), plus `root-no-mfa`, `s3-public`, `no-cloudtrail`. **Added this pass: `rds-public`** — a database marked `PubliclyAccessible` (a public endpoint on the open internet, a DISTINCT exposure vector R16/`EXPOSED_VIA` deliberately doesn't cover). Full vertical: new RDS connector attribute `publiclyAccessible` (same `DescribeDBInstances` response → **no extra IAM permission**) → `rds-public` high-severity finding (only on known-true, never `unknown` → no false-fire pre-resync) → compliance control `data.no-public-database` (PCI/CIS/NIST/ISO/HIPAA/GDPR mappings, assessable) → guidance via the existing "security posture" category. Tested: connector attribute mapping, real-PG summary-fires-the-finding, and the compliance control (pass/fail/NA). ⚠️ Populates on the next AWS re-sync (the attribute isn't on already-synced RDS nodes yet). **Still open (connector-gated, need new crawls):** public-ALB-**no-WAF** (WAFv2 WebACL associations — entirely new), **EBS** encryption (no EBS posture crawl), and the "world-open SG **reaching a datastore**" refinement (data exists via `PROTECTS`/`EXPOSED_VIA`; would elevate severity when the open SG fronts a DB). Nice follow-up: wire `publiclyAccessible` into R16 so public DBs become first-class `EXPOSED_VIA` facts (feeds the map's exposed lens + any exposure-based logic).

## Code context — how we know the *logic*, not just the PR

> The recurring question: to trace a fault into the code, do we index/vectorize the whole codebase?
> **No — not as the foundation, and not first.** The incident already points at the code. Retrieval is
> *targeted*, driven by the error itself; the LLM supplies comprehension. Atlas's job is **evidence
> assembly, not pre-computed understanding.** Layered, cheapest → most expensive:

| Layer | What | When needed | Cost / staleness |
|---|---|---|---|
| **L0 — structural map** | repos, PR→changed-files, CODEOWNERS, manifests (already crawled) | attribution ranking: stack-trace files ∩ PR diff | free, already have |
| **L1 — targeted fetch at the *deployed SHA*** | pull the blamed files (+ direct imports) at the commit **actually running in prod**, plus the candidate PR diffs; drop into the model's context | every incident | cheap, always fresh, reuses the connector's existing `content()` fetch |
| **L2 — symbol/reference index** | tree-sitter/LSP-style def/ref/import graph → walk from the crashing symbol outward | "what calls this / what does it touch" blast-radius *in code* | per-language work; deterministic + citeable; a later phase |
| **L3 — semantic embeddings** | vectorize code chunks for *fuzzy* retrieval | **fallback only** — when there's no stack trace, just a vague message | most expensive, re-embed on every change, **lowest precision** (P3 distrusts "looks related") |

**Two distinct jobs, don't conflate them:** *localize* the fault (structural — the log's stack trace
does most of the work) vs. *explain* it (the model reads the actual code at the deployed SHA + the diff
and reasons "this hunk produces this error"). We never pre-compute "understanding"; we assemble the
right ~200 lines + evidence at incident time and let a strong model (Opus, 1M ctx) reason over it, every
claim cited to a real file/commit/log line.

**Onset & signatures (the "5-year-old silent bug" answer).** Normalize each error log into a
**signature** (strip volatile tokens → template → hash); track `first_seen` + `rate_before/after`.
- brand-new signature after a deploy → cleanest code attribution.
- old signature, steady → flagged **"not new — first seen <date>"**; reframed as chronic, *not* blamed on today's PR.
- old signature, rate **stepped up** at T → correlate T to what changed then (usually traffic/data/config, not code).

**Attribution is ranked, never asserted.** Candidate changes in `[onset−W, onset]` ranked by: *did this
deploy actually reach the failing node* × temporal proximity × **code-path overlap** (stack-trace
files/symbols ∩ each PR's changed files — the strongest disambiguator, and honest because the log itself
names the code) × dependency/blast-radius overlap. Output is a **classified verdict**:
`code-correlated | config-correlated | dependency-correlated | chronic-no-onset | unknown` — not a single PR.

**Commit-precision depends on deploy provenance, which we *auto-detect*, not ask.** We probe the real
artifacts — ECS image tags, Lambda version/description/`CodeSha256` — for an embedded git SHA. Present →
exact commit. Absent (`:latest`) → repo-level only, **stated out loud** ("traced to `payments-svc`, but
the image is tagged `latest` — I can't pin the commit"). The gap is a trust signal, not a hidden failure;
it also tells the customer the highest-ROI fix is to start SHA-tagging their builds.

**Data-handling (P2 + tenant/BYO-LLM boundary):** reading code is within P2 (read-only; we already fetch
file content). But source → LLM is sensitive: fetch **only failure-path files**, never the whole repo;
route through the org's configured model (BYO or shared Claude) under the same tenant isolation; log what
was fetched. Note in `docs/13` when this ships.

## Decisions (interactive) — 2026-07-11

- **Logs = on-demand at incident time for v1** (bounded Logs Insights queries on the implicated log
  groups + window; persist error *signatures*, not raw lines). **Continuous monitoring later** — a
  configurable poll (15/30/60 min, cadence TBD by cost) that pre-computes onset/signatures. Not a TSDB.
- **v1 scope = acute-onset correlation** (clean onset + ranked candidates + symptom-vs-cause via the
  graph). **Chronic is reframed honestly, not fake-diagnosed**; genuine latent-bug *discovery* (finding a
  5-year-old line) is explicitly out of v1 — pretending to would be the dishonesty we're avoiding.
- **Code context = targeted retrieval (L0→L1) first; embeddings (L3) are a later fallback, not the base.**
- **Deploy-provenance (git SHA) is probed from the artifacts, not asked of the user;** the gap is surfaced.
- **Health/logs need an IAM grant beyond `SecurityAudit`** (`logs:StartQuery`/`GetQueryResults`/
  `FilterLogEvents`, `cloudwatch:GetMetricData`) — track as a distinct grant in the hub (FR-1.6).

## IAM delta (append to the read-only policy)

`cloudwatch:DescribeAlarms` · `cloudwatch:GetMetricData` · `elasticloadbalancing:DescribeTargetHealth` · `ecs:ListTasks` · `ecs:DescribeTasks` · `ecs:DescribeServices` · `cloudtrail:LookupEvents` · `ssm:DescribeInstanceInformation` · `ssm:ListInventoryEntries` · **logs (Phase D):** `logs:DescribeLogGroups` · `logs:StartQuery` · `logs:GetQueryResults` · `logs:FilterLogEvents`. All Describe/List/Get/Query — P2 intact (read-only). Missing grants degrade per FR-1.6 (named in the hub, never silent). Note: several `logs:*` and `cloudwatch:GetMetricData` are **not** in the AWS-managed `SecurityAudit` policy — surface them as a separate grant.

## Hard boundaries (say them out loud)

- **No agents, no writes, no customer-side infra** — so "real-time" = 1–2 min polling, not push (EventBridge would require resources in their account; refused by P2).
- **We are not building a TSDB.** We store alarm/health *states* and the event timeline; for RCA depth the AI queries CloudWatch **on demand**. Metrics products exist; the cited cross-domain traversal is ours.
- **RCA is assistive.** Hypotheses with evidence, confidence-tiered — the trust model is the differentiator, not omniscience.

## Sequencing

**A ∥ B → C → D → E** (E's toxic-combo half can start anytime after the security plan's posture rules). Each phase independently shippable and demo-able on the live calsaws estate. DoD per `docs/15` §5 + `docs/14` gates (incl. adversarial QA on D's honest-absence behavior).

## Cross-refs

Keystone edges follow `docs/05` (inference tiers, P3) · collectors extend `docs/06` service modules (additive, §9) · events table per `docs/04` conventions (org-scoped RLS, composite FKs) · AI tools extend KE-P1 loop + KE-P2 advisory (`docs/plans/ai-knowledge-engine*.md`) · posture rules join `docs/plans/security-vulnerabilities.md` Phase 2 · health UI per `docs/09` §7 (trust states).
