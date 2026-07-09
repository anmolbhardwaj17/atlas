# Plan — Signal Enrichment (densifying the code↔infra graph)

> **Status:** 🔵 In progress — Slice 1 (tags / R11) ✅ + Slice 2 (image→SHA / R12) ✅ shipped; S3–S6 queued.
> **Note on "observed":** an inference rule can only emit `inferred-high`/`inferred-low` — `observed` is reserved for facts a *connector* reads directly. So R12's SHA match (a correlation of two observed facts) is `inferred-high` (near-observed); the genuinely-observed deploy edge is the CI/CD connector's job (`docs/07c`).
> **Owner-goal:** the map has many resources but few edges; connect more of it *without* lowering precision (P3).
> **Governing principle:** the graph is the product (P1); **prefer a missing edge to a wrong one** (P3); every edge is cited (P4).
> **Cross-refs:** `docs/05` (inference rules), `docs/06` (AWS crawler), `docs/07c` (CI/CD linking), `docs/plans/operational-intelligence.md`, `docs/plans/security-vulnerabilities.md`.

---

## 1. Why the graph is sparse (the honest diagnosis)

The disconnection is **~20% matcher, ~80% signal** — three layers, only one of which is "the algorithm":

1. **Data gap (biggest).** The code that runs on the live AWS account (calsaws) isn't connected — the deploying repos live in a workspace/account nobody has linked. R10 already parsed 22 log groups → 21 workloads but produced **0 repo edges**, correctly, because there was no repo side to match. *No matcher can link absent code.*
2. **We discard / never collect the best keys.** Even for the code we do have, matching rests on a narrow base (CI-file deploy targets, env-var *values*, IAM ARNs, log-group name guesses). The richer, higher-precision keys are unused or uncollected:
   - **Tags are inert.** No rule reads `attributes.tags`, and the compute/data nodes most likely to carry `Service`/`Application`/`Team`/`repository`/CloudFormation-stack tags (Lambda, ECS, RDS, ElastiCache) capture **zero** tags today.
   - **Image digests are stripped.** ECS taskdef image tags/digests (often the git SHA) are dropped at parse; Lambda container images aren't captured.
   - **No IaC is read.** Repos that *declare* their infra (`*.tf`, `serverless.yml`, `template.yaml`) are unparsed.
3. **Deliberate conservatism (P3).** Generic-token stoplists, wildcard-IAM ignored, literal-only parsing, resolve-to-existing-node-only. Correct — it's the trust moat — but it means ambiguity → *no edge*. So the connectivity floor is set by how good our **unambiguous** signals are.

*Caveat:* some real edges (service A → service B over HTTP/an ALB) are physically invisible to a config crawl — only runtime telemetry (traces, VPC flow logs, log content) reveals them.

**Conclusion:** the highest-leverage move is to **collect and use the deterministic keys we ignore** (tags → image digests → IaC), which raises recall *without* touching P3. Fuzzy/semantic matching is worth adding only as a *candidate generator behind human confirmation*.

## 2. Strategy

- **Add high-precision signals first.** Each new signal must be exact/near-observed so it raises recall without lowering precision.
- **Reserve fuzziness for a confirmation loop.** Semantic/LLM matching *proposes* candidates; a one-click human confirm turns a candidate into an observed, human-attested edge. We never fabricate — we ask.
- **Fail open on cost/latency.** Signals that need extra API calls or content reads must degrade gracefully and never block a sync.

## 3. The signal roadmap (sequenced)

| # | Slice | New signal | Edge | Precision guarantee | Needs | Status |
|---|---|---|---|---|---|---|
| **S1** | **Resource tags (R11)** | AWS tags naming the owning code (`repository`/`service`/`application`/CFN stack) | `DEPLOYS_TO` repo→compute | exact normalized equality to one repo → high; ambiguous → low each; generic/short → skip | tag capture in normalize (+ live tag-fetch for Lambda/ECS/ElastiCache) | 🔵 **building** |
| **S2** | Image tag → git SHA (R12) | ECR image tag carrying the commit SHA, matched to a crawled PR's commit | `DEPLOYS_TO` repo→ECS at **inferred-high** (near-observed) | SHA-prefix match to a real commit is near-certain provenance | PR commit-SHA capture (Bitbucket live; GitHub parity) + ECS image SHA extraction | ✅ **built** |
| **S3** | IaC parsing | Terraform/CFN/serverless/CDK resource declarations in repos | declared repo→resource | the repo literally defines the resource | repo-side IaC parser (extends GitHub/Bitbucket connectors) | 📋 |
| **S4** | Observability service names | `OTEL_SERVICE_NAME` / `DD_SERVICE` env values | repo↔service | canonical self-reported name; small extension of R3's env read | none new (already read env values) | 📋 |
| **S5** | Log-content mining | self-reported identity + downstream hosts in log *content* / stream names | repo match + runtime `CONNECTS_TO` config can't see | free-text → candidate-confirm only; stream names are safe metadata | `logs:GetLogEvents`/`FilterLogEvents` IAM + redaction | 📋 Phase 2 |
| **S6** | Semantic + human confirm | embedding similarity of names/descriptions | any (via confirm) | candidate-only; confirmed → observed (human-attested) | confirm UI + a candidate store | 📋 |

## 4. Slice 1 — Resource tags → `DEPLOYS_TO` (R11) *(this change)*

**Rule `tag_code_correlation` (R11) → `DEPLOYS_TO`.** A tag is a *deliberate human label*, so it's stronger than a name guess (R10):

- **Inputs:** compute-runtime nodes (`aws.lambda.function`, `aws.ecs.service`, `aws.ec2.instance`) carrying `attributes.tags`, plus crawled `bitbucket.repository` / `github.repository` nodes.
- **Recognized keys** (case-insensitive): `repository`, `repo`, `git_repository`, `service`, `application`, `app`, `project`, `component`, `service-name`/`app-name` variants, and `aws:cloudformation:stack-name`.
- **Match:** take the repo-identifying segment of the tag value (last path segment, strip `.git`), normalize (lowercase, strip env suffix + non-alphanum, reusing R10's `normalizeWorkload`), and require **exact equality** to a repo slug. Generic or <4-char values are skipped (reusing R10's `GENERIC_TOKENS`).
- **Confidence:** unique exact match → `inferred-high` (an explicit label to one repo). Value matching several repos → `inferred-low` per repo (P3 — many low, never one wrong high).
- **Scope:** only compute runtimes are `DEPLOYS_TO` targets. A `service`/`team` tag on a *datastore* is ownership, not deployment — deferred (would be an `OWNED_BY` follow-up).
- **Evidence (P4):** `{ rule: "tag-code", tagKey, tagValue, matchedRepoSlug, source }`.

**Connector change:** capture `tags` in `normalize` for Lambda, ECS service, ECS taskdef, RDS, and ElastiCache (EC2/S3/DynamoDB already do). This is additive/pure — any tags in the payload are stored.

**Live-fetch note (follow-up, needs IAM):** the primary Describe calls include tags for **EC2** (DescribeInstances) and **RDS** (DescribeDBInstances `TagList`) — so those flow immediately. **Lambda / ECS / ElastiCache** need an extra tag call (`lambda:ListTags`, ECS `DescribeServices include=TAGS`, `elasticache:ListTagsForResource`) — a discoverer wiring step gated on IAM grants. The cheapest cross-service alternative is the **Resource Groups Tagging API** (`tag:GetResources`, one permission, all resources), tracked as an option. Until then R11 is fixture-complete and fires on whatever tags the payload carries.

## 5. Precision guardrails (apply to every slice)

- Exact/normalized-equality over substring wherever the signal is an explicit label.
- Generic-token + min-length guards (shared with R10).
- Ambiguity → multiple `inferred-low`, never one `inferred-high` (BR-EDGE-4/5).
- Resolve to an **existing** node only — never invent a target.
- Free-text / semantic signals never auto-create edges — candidate + confirm.

## 6. Definition of Done (per slice)
Tests (pure golden fixtures incl. negative cases) + `docs/05` rule catalog updated in the same change + migration seeds the rule row + `pnpm run check` green + board activity-log entry.
