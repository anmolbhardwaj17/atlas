# Atlas Backend — Production-Readiness Audit (2026-07-20)

> Five parallel read-only audits (security/isolation, correctness/concurrency, performance/DB,
> operability, connector resilience) + source verification of the top findings. This is the working
> plan for making the backend production-grade. Check items off as commits land.

**Verdict:** the **security foundation is production-grade** — no cross-tenant leak, auth bypass,
secret exposure, or customer-cloud write (all verified). The gaps are **operational reliability**
(job queue, health, timeouts, config), **scale** (sync batching, inference memory, search), and
**connector resilience** (credential refresh, retries). None are architectural rewrites.

---

## 🔴 Must-fix before production (Critical — source-verified)

- [x] **A1 · Job queue is in-memory in every env.** `connections.module.ts:62` unconditionally returns
  `InMemoryQueue`; `BullMQQueue` (Redis, retries/backoff) exists but is never wired, and `REDIS_URL`
  is dead config. Syncs run in-process in the API; in-flight jobs are **lost on every deploy/crash**
  → graph silently stales (P1). Fix: select BullMQ when `REDIS_URL` set + dedicated worker + drain on
  shutdown (`SyncWorkerBootstrap` has no `OnApplicationShutdown`).
- [x] **A2 · `/health` is a static 200** (`health.controller.ts:9`). Add a readiness endpoint that
  runs `SELECT 1` (short timeout) so a dead-pool pod is evicted from rotation. Keep liveness cheap.
- [x] **C1 (perf) · Sync = ~5 serial DB round-trips per resource, DB connection held across the cloud
  crawl** (`ingest/sync-runner.ts:133-160,273-357`). Batch upserts (`INSERT … unnest … ON CONFLICT`);
  move `discover`/`fetchDetail` network I/O outside the transaction. Done: each scope now crawls in
  Phase 1 (no txn, no connection held) then persists in Phase 2 (one txn) via batched `unnest`
  upserts for nodes/snapshots/provenance/signals/edges; client-generated provenance UUIDs pair
  provenance↔edge without RETURNING-order reliance. All 9 sync-runner invariant tests pass on real PG.
- [x] **C2 (perf) · Inference loads the whole org graph into memory each run**
  (`inference/engine.ts:129-200`, no LIMIT, JSONB attributes/data). OOM risk on big tenants. Scope
  loads to the kinds the registered rules consume; drop heavy JSONB. **Done via a per-rule consumption
  contract.** `Rule` gains required `consumesKinds`/`consumesSignalKinds` (declared from each rule's own
  const arrays so they can't drift). `buildInput` still loads ALL nodes (id/urn/kind/name → endpoint
  resolution never misses one) but projects the heavy `attributes` JSONB only for consumed kinds
  (`CASE … ELSE '{}'`) and loads only consumed signal kinds. Since no rule reads attributes off a
  `nodesByUrn` endpoint, the only risk is `nodesByKind.get`/`signalsByKind.get` of an undeclared kind —
  which `consumption-contract.test.ts` turns into a red test (recording proxy over each rule; proven to
  catch a dropped kind, incl. r8's data-gated ARN path). Full inference suite green on real PG (146).
- [x] **CX1 (connector) · AWS AssumeRole creds never refresh mid-crawl** (`connector-aws/aws/client-config.ts:16-27`
  static object, not a provider). >1h crawl → `ExpiredToken` → misclassified as `access-denied`
  (`aws/retry.ts:21-24`) → silent data loss + false "permission missing". Use a refreshing provider +
  explicit expired-token branch. Done: `refreshingCredentials()` (self-refreshing `AwsCredentialProvider`,
  re-assumes ~5min before expiry, static keys never refresh, shared in-flight); `clientConfig` accepts
  a provider (`CrawlCredentials`) and `discover()` uses one per run; `classifyAwsError` + `isAccessDenied`
  get an explicit `ExpiredToken`→transient branch. 20 new/updated unit tests, full suite green (92).

## 🟠 High — reliability + correctness bugs

- [x] **H1 (correctness) · Health alerts silently lost on transient webhook failure**
  (`notifications/notification.service.ts:449-456`) — `last_alert_at` advances even when `postWebhook`
  returned false (429/500/DNS blip) → alert dropped forever. Only advance the watermark on success;
  disable a channel after N consecutive failures.
- [x] **M5 (correctness) · BullMQ retries inert** — `runStagedSync` catches per-scope errors and
  *returns* `failed` (`ingest/sync-runner.ts:169-173`, `sync-worker.ts:51-94`), so the job is marked
  completed and `attempts:3` never fires. Rethrow when `status==='failed'` (keep `partial` non-throwing).
- [x] **CH1 (connector) · REST clients don't retry thrown network/timeout errors** (only non-2xx) —
  github/bitbucket/jira/jenkins `client.ts`. One socket reset aborts a repo. Wrap fetch in try/catch +
  backoff-retry (GETs are idempotent). Done in all four clients (bounded exp backoff; a caller-initiated
  abort is not retried).
- [x] **CH2 (connector) · GitHub secondary rate-limit aborts the crawl** (`github/client.ts:113-124`) —
  403 w/o `retry-after` and `remaining>0` isn't retried. Back off ~60s w/ jitter. Done: detect the
  secondary-limit body message ("secondary rate limit"/"abuse detection") → ~60s jittered backoff; a
  plain permission 403 stays non-retryable. Also paginated PR changed-files (was first-100-only, →
  bounded `MAX_PR_FILES=600`) so a large PR keeps the file that links it to a service (r6/r18).
- [x] **H4 (perf) · Dashboard reports a capped resource count** — `graph.service.ts:581` `LIMIT 5000`
  + `:961` `resources: meta.rows.length` → estate >5000 shows "5000". Use `count(*)`; push
  clouds/accounts to SQL aggregates; stop selecting `attributes`.
- [x] **H3 (perf) · Search seq-scans + casts `attributes::text ILIKE` every row**
  (`search/postgres-search.provider.ts:45`) — and it's the AI-retrieval fallback (every Ask turn).
  Fixed by indexing, not dropping (migration 0063): added `ix_nodes_urn_trgm` and the functional
  `ix_nodes_attrs_text_trgm` so the whole WHERE is index-backed via a BitmapOr — preserves
  attribute-keyword matching (small scalar maps; test-covered) instead of regressing recall.
- [x] **H1 (ops) · Outbound fetches without timeout** — email (`core/email.service.ts:210`),
  notification webhooks (`notification.service.ts:532`), Slack (`slack.service.ts:287,298`), Discord
  (`discord.service.ts:284,294`). Route through a `fetchWithTimeout` (~10s).
- [ ] **H2 (ops) · `SECRET_ENCRYPTION_KEY` optional → in-memory broker** → creds wiped on restart.
  Prod fail-fast guard (see A3).
- [x] **H5 (perf) · Pool starvation** — per-request scope fan-out (dashboard 4, finding-detail 7) vs
  `max:16` (`db/client.ts:31`). Right-size pool + cap per-request fan-out. Pool `max` is now
  env-tunable (`PG_POOL_MAX`, default 16); `findingDetail`'s blast-radius fan-out is capped at 3
  concurrent (`mapWithConcurrency`), so a detail request holds ≤4 connections instead of 7.
- [x] **M3 (correctness) · OSV `AFFECTS` edges never retired** (`ingest/osv-enrichment.ts:43-101`) —
  patched/withdrawn vulns keep flagging. Retire un-reproduced edges, mirroring `reconcileObservedEdges`.

## 🟡 Medium — hardening + optimization

- [x] **A3 · Config fail-fast in prod** — when `NODE_ENV==='production'`, require `SECRET_ENCRYPTION_KEY`,
  `DATABASE_URL`, `REDIS_URL`, Supabase Storage keys; fail at boot (today: silent degrade).
- [x] **Ops metrics/tracing** — no counters/histograms/`/metrics`, no tracing. Add a Prometheus
  registry (request latency, job outcomes, queue depth). Done: `MetricsService` (default process
  metrics + `http_requests_total`/`http_request_duration_seconds` by method+route-pattern,
  `atlas_sync_jobs_total` by outcome, `atlas_sync_queue_depth` by state) + `GET /metrics`
  (`@Public`, optional timing-safe `METRICS_TOKEN`). Recorded from the `LoggingInterceptor` + the
  sync worker (`onJobResult` hook + `JobQueue.depth()`/BullMQ `getJobCounts`). Distributed tracing
  (spans) still open — a bigger lift (OTel), left for when a collector exists.
- [ ] **Indexes** — `ix_nodes_urn_trgm` (GIN trgm), `ix_nodes_health_state` partial expression index.
  Batch inference/OSV writes. Cache `overview()`; `listNodes` count only on page 1.
- [ ] **Sync-run enqueue not atomic** (`connection.service.ts:368-388`) → orphaned `queued` row blocks
  the connection 15 min on a Redis blip. Mark `failed` on enqueue error, or transactional outbox.
- [ ] **Long-scope false-reap race** (`sync-runner.ts:133-168`) — `updated_at` frozen within a scope →
  a >15-min scope is reaped mid-flight → replacement run interleaves. Emit an `updated_at` heartbeat.
- [ ] **Digest loses a week on mid-send crash** (`digest/weekly-digest.service.ts:74-82`) — claim-then-send.
  Provisional claim / per-org send ledger.
- [ ] **DB `statement_timeout`** + Fastify request timeout (none today). Non-`CONCURRENTLY` index builds
  lock writes on deploy (`db/migrate.ts:164`).
- [ ] **RLS backstop CI-skipped** — `db/rls-coverage.test.ts` exists but `describe.skip` unless
  `TEST_ADMIN_DATABASE_URL` set. Wire an admin DB into CI so a future org-scoped table w/o RLS fails.
- [ ] **Incidents/alerts controllers bypass zod** (`incidents.controller.ts:41,82`, `alerts.controller.ts:33`)
  — route through `parseBody` with size caps.
- [ ] **Connectors** — constant 1s backoff no jitter (thundering herd); `withRetry` dead code; GitHub PR
  files first 100 only (`github/crawl.ts:216`); AWS per-item describe aborts scope on one bad item.
- [x] **`LOG_LEVEL` parsed but unused**; logs lack org context. Done: `LOG_LEVEL` now gates the
  access-log emission and sets Nest's own logger levels (main.ts); the access line carries the
  resolved `orgId` when present.

## 🟢 Verified solid (no action)

Tenant isolation (GUC+RLS, cross-tenant→404, minimal SECURITY DEFINER resolvers) · auth (global guard,
every `@Public` route independently + timing-safe authed, WS authed) · secrets (AES-256-GCM,
`secret_ref`, never logged/returned) · SSRF host-allowlists + token-egress guards · **P2 read-only
enforced by a CI fitness test** · all SQL parameterized · sync idempotency + reconcile compare-and-set
· inference serialized via advisory lock · `withOrgScope` atomic · CORS locked to `WEB_ORIGIN` ·
rate-limiting on the abusable surfaces · pool self-heal · partial graceful shutdown · connector
timeouts + honest partial-failure in multi-region collectors.

## Sequencing

- **Phase A — prod blockers:** queue+worker+shutdown-drain (A1), health readiness (A2), config
  fail-fast (A3), outbound timeouts.
- **Phase B — correctness bugs:** alert watermark (H1), sync-retry rethrow (M5), resource-count (H4),
  OSV retire (M3).
- **Phase C — scale:** ✅ DONE — sync batching + I/O-outside-txn (C1), indexes + search (H3), pool
  right-sizing (H5), inference-memory scoping via a per-rule consumption contract (C2). All landed +
  verified on real Postgres.
- **Phase D — connectors:** ✅ DONE — AWS cred refresh (CX1), network-error retries across all four
  REST clients (CH1), GitHub secondary-limit + PR-file pagination (CH2). All green.
- **Phase E — observability:** ✅ DONE — Prometheus `/metrics` (http + sync + queue + default),
  org-tagged access logs, `LOG_LEVEL` wired. Distributed tracing (OTel spans) deferred.

## Found during the audit (out of scope, flagged)

- **`graph()` frontier drops a real neighbour at a tiny budget** (`graph.service.ts` map query).
  With `?limit=1` the edge-aware frontier is capped at `inView.size >= hardCap` (`= limit*2`), so a
  budget node with two cross-budget neighbours keeps only ONE — the exact "false unlinked" the
  feature (commit `f73942f`) meant to prevent (its own comment: "never split a repo from its
  runtime, P3/P4"). The frontier already only pulls from the over-fetched `mapped` set (bounded), so
  the extra cap mostly just drops real links. Also: that commit's test
  (`graph.service.test.ts` "keeps a repo linked … when the budget truncates") seeds an inferred edge
  with an invalid `provenance.confidence='inferred'` and no `inference_rule_id`, so it errors before
  asserting — it has never actually run against a migrated DB. Fix = loosen the frontier cap (small
  map-sizing change) + correct the seed. Needs a product call on max map size, so left for the user.
