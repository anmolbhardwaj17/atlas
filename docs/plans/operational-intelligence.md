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
| Image-URI ↔ repo-slug match alone | medium |
| Name/tag convention only (`repo`/`service`/`aws:cloudformation:stack-name` tags, Lambda naming) | low, shown as such |

Deliverables: pipeline-yml fetch in the Bitbucket connector (we already fetch file content for manifests — same mechanism), inference rules in the existing engine (they're just new R-rules), edges on map/Explore/impact. **Exit:** clicking `calsaws-chat-*` shows *which repo ships it*, cited to the evidence.

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

### Phase C — Change timeline: what changed, when, by whom

- **CloudTrail** `cloudtrail:LookupEvents` — 90 days of management events with zero customer setup: "SG `calsaws-db-sg` modified by X at 14:02". Mapped to nodes by ARN/name → `config_change` events.
- **Pipeline runs** (Bitbucket API, already authenticated) → `deploy` events with timestamps onto the Phase-A `DEPLOYS_TO` edges.
- **Merged PRs** (already crawled) → `pr_merged` events on their repo.

**Exit:** a node's detail view shows a unified, cited timeline: *deployed 13:58 · SG changed 14:02 · alarm fired 14:05*.

### Phase D — AI incident tracing *(needs B + C; A multiplies its value)*

New tools in the existing agentic retrieval loop (KE-P1 — the loop, grounding gate, and citation binding are already built and evaluated):

- `diagnose(nodeId, window)` — health state + upstream/downstream blast radius + all `node_events` in the window, ranked by (temporal proximity × graph distance).
- `get_pr_diff(prId)` — fetch the actual diff on demand (read-only Bitbucket API) so the model can reason "PR #482 touched `db/pool.ts`; the failing Lambda talks to that DB."

Output contract: **ranked hypotheses, each citing its evidence chain** (alarm → service → deploy edge → PR), and honest absence when the window is quiet ("no deploys or config changes in the 6h before the alarm — likely external/capacity; here's what I checked"). Eval-set additions: golden incident scenarios (seeded fault + planted PR) and the adversarial case — **a quiet timeline must produce "no likely culprit found", never an invented one** (the escaped-hallucination-zero bar from G3 applies).

### Phase E — Posture & personalized advisory *(the "tell me how my infra should improve")*

Deterministic rule library over the real graph — findings, not vibes: SG open to `0.0.0.0/0` reaching a datastore · public ALB with no WAF · single-AZ prod RDS · unencrypted storage · wildcard IAM · **exposed AND vulnerable** (the toxic combo — `docs/plans/security-vulnerabilities.md` Phase 2, now unblocked by live AWS). Each feeds the existing advisory path (KE-P2 knowledge packs: facts cited, advice labelled). Personalization is structural: rules fire on *their* graph, the AI narrates *their* paths — not generic best-practice prose.

## IAM delta (append to the read-only policy)

`cloudwatch:DescribeAlarms` · `cloudwatch:GetMetricData` · `elasticloadbalancing:DescribeTargetHealth` · `ecs:ListTasks` · `ecs:DescribeTasks` · `ecs:DescribeServices` · `cloudtrail:LookupEvents` · `ssm:DescribeInstanceInformation` · `ssm:ListInventoryEntries`. All Describe/List/Get — P2 intact. Missing grants degrade per FR-1.6 (named in the hub, never silent).

## Hard boundaries (say them out loud)

- **No agents, no writes, no customer-side infra** — so "real-time" = 1–2 min polling, not push (EventBridge would require resources in their account; refused by P2).
- **We are not building a TSDB.** We store alarm/health *states* and the event timeline; for RCA depth the AI queries CloudWatch **on demand**. Metrics products exist; the cited cross-domain traversal is ours.
- **RCA is assistive.** Hypotheses with evidence, confidence-tiered — the trust model is the differentiator, not omniscience.

## Sequencing

**A ∥ B → C → D → E** (E's toxic-combo half can start anytime after the security plan's posture rules). Each phase independently shippable and demo-able on the live calsaws estate. DoD per `docs/15` §5 + `docs/14` gates (incl. adversarial QA on D's honest-absence behavior).

## Cross-refs

Keystone edges follow `docs/05` (inference tiers, P3) · collectors extend `docs/06` service modules (additive, §9) · events table per `docs/04` conventions (org-scoped RLS, composite FKs) · AI tools extend KE-P1 loop + KE-P2 advisory (`docs/plans/ai-knowledge-engine*.md`) · posture rules join `docs/plans/security-vulnerabilities.md` Phase 2 · health UI per `docs/09` §7 (trust states).
