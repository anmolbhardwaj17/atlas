# Performance — findings & plan

> Status: **P1–P4 code fixes shipped (2026-07-10).** Owner concern (2026-07-10): "data takes time
> to load; switching pages feels slow; the URL takes time to even switch, then loading comes."
> This doc records what was measured, the root cause, and the prioritized plan. **Remaining: P0
> (co-locate the API with the DB region) — infra-only, unblocked once we deploy.**
>
> **Key correction to the round-trip model:** within a single `withOrgScope`, multiple `c.query`
> calls on the *same* connection serialize — node-postgres has no pipelining. So the real levers
> are (a) reducing/parallelizing *scopes* (each = separate pooled connection = true parallelism),
> and (b) merging multiple SQL round-trips into one statement (LATERAL joins / scalar subqueries).
> Promise.all of queries on one client does NOT parallelize them.

---

## What was measured (2026-07-10)

Timed real round-trips from the dev machine to the live Supabase Postgres:

| Measurement | Result |
|---|---|
| Supabase region | **ap-southeast-2 (Sydney)** — `aws-1-ap-southeast-2.pooler.supabase.com` |
| Single query round-trip (RTT) | **~137 ms** |
| 5 sequential `SELECT 1` | **692 ms** (= 5 × RTT — pure network) |
| Cold connect | ~709 ms |
| **`withOrgScope` single-query read** (BEGIN → set_config → query → COMMIT) | **610 ms** |
| …with BEGIN+set_config folded into one round-trip | 457 ms |
| …everything batched into ONE round-trip | **170 ms** |

**Root cause: latency, not compute.** The DB work is milliseconds; the cost is the *number of
sequential DB round-trips* multiplied by the RTT. The dev API runs on a laptop ~137 ms from Sydney,
so every hop is expensive and they stack.

### Contributing factors
1. **Non-co-located DB.** Local/dev API → Sydney = ~137 ms/hop. In prod (ECS in the DB's region)
   this drops to ~1–3 ms and most of the pain disappears. **This is the dominant prod lever.**
2. **`withOrgScope` overhead** — was 4 round-trips per scoped op (BEGIN, set_config, query, COMMIT).
   Any endpoint that opens several scopes pays the overhead N times.
3. **Per-page `/me`** — every page's `requireShell()` re-fetches `/me` on navigation; the client
   `OrgSwitcher` and `NotificationBell` fetch `/me`-shaped data again. Several identical round-trips.
4. **No client cache** — every visit + every `router.refresh()` (org switch, profile save) re-fetches
   from scratch. `force-dynamic` on all 14 pages + `no-store`.
5. **Dev-mode on-demand compilation** — a large share of the "URL freezes on first click" feeling in
   dev; **gone in a prod build**. Measure a prod build before attributing lag to the app.

---

## Plan (highest ROI first)

### P0 — Co-locate the API with the DB region (prod) · biggest win, infra
Deploy the ECS API/workers in **ap-southeast-2** (same region as Supabase), or move Supabase to the
API's region. Turns every ~137 ms hop into ~1–3 ms. Also evaluate the Supabase **transaction pooler
(6543)** vs session pooler for the worker pool. *No app code — deployment/config.* Until then, dev
latency is inherent to laptop→Sydney and can't be fully "fixed" in code.

### P1 — Cut sequential DB round-trips per request ✅ (shipped 2026-07-10)
- ✅ **Fold BEGIN + set_config** in `withOrgScope` → −1 hop everywhere (`packages/db/src/client.ts`).
- ✅ **Parallelize/consolidate multi-scope endpoints** (`apps/api/src/graph/graph.service.ts`,
  `notifications/notification.service.ts`):
  - `summary()` — the sequential 4th scope (`recentActivity`) folded into the parallel fan-out
    (now one 4-way concurrent wave). Speeds `/summary` **and** every caller of `summary()`
    (insights, findingDetail, findingsForNode).
  - `findingDetail()` — the affected-node lookup + up-to-6 blast-radius traversals now run as ONE
    concurrent wave (was up to 7 back-to-back scopes — the worst endpoint in the audit).
  - `listFeed()` (the bell, every page) — `syncFeed`'s write merged into the read scope (2 scopes → 1).
- ✅ **Merge independent SELECTs into one statement** (real batching, not same-client Promise.all):
  - `getNode()` — node + latest snapshot/provenance in one `LEFT JOIN LATERAL` (was 2 queries).
  - node-metrics — node + its provider connection in one `LATERAL` (was 2).
  - `listFeed()` — unread count folded into the items query via an uncorrelated scalar subquery.
- ✅ **Pool ceiling** raised 10 → 16 so the intentional parallel scopes don't queue (`client.ts`).

### P2 — Kill the redundant `/me` round-trips ✅ (shipped 2026-07-10)
- ✅ **P2a** — `requireShell()` now carries the user's memberships through to the client; `OrgSwitcher`
  hydrates from that server render instead of firing its own duplicate `/me` on every mount. It only
  re-fetches on an explicit org name/logo change (`ORG_UPDATED_EVENT`). (`lib/shell.ts`,
  `app-shell.tsx`, `org-switcher.tsx`, `(app)/layout.tsx`.)
  - *Not done (deliberately):* HTTP-caching `/me` in Next's data cache — it's token-bearing and the
    shared cache isn't keyed by auth, so caching it risks cross-user leakage (R8). Left `no-store`.
- ✅ **P2b** — `/me` server path: user-mirror upsert + membership read run concurrently, and the two
  independent upserts inside `ensureUser` run concurrently (`me.controller.ts`, `user-mirror.service.ts`).

### P3 — Suspense streaming ✅ (shipped 2026-07-10)
- ✅ dashboard, map, insights now commit as soon as the (fast) auth/shell resolves and STREAM their
  heavy fetch (`/summary`, `/graph`, `/insights`) behind a `<Suspense>` boundary — each boundary's
  fallback is the route's own `loading.tsx` skeleton, so the nav-loading → streamed-content hand-off
  is one continuous skeleton (no flash).

### P4 — Prefetch & polish ✅ (code-split shipped 2026-07-10)
- ✅ `InfraMap` loaded via `next/dynamic({ ssr: false })` behind a thin client wrapper
  (`infra-map-lazy.tsx`), keeping `@xyflow/react` + its CSS out of the initial route JS and off the
  server render.
- ⏳ *Remaining nicety:* Next `<Link>` already prefetches in prod by default (verify in a prod build);
  optionally code-split the Explore `node-graph` too. Low priority.

---

## Done
- **2026-07-10** — `withOrgScope` folds BEGIN + set_config into one round-trip (−1 hop per scoped op).
  RLS verified intact (unscoped count returns the org's rows, 0 for another org, as `atlas_app`).
- **2026-07-10** — **P1–P4 code fixes** shipped (commits `perf(api): cut sequential DB round-trips…`
  and `perf(web): hydrate OrgSwitcher, stream heavy pages, code-split React Flow`). No behaviour
  change; each scope still sets its own `atlas.current_org` GUC so RLS/tenant isolation is unchanged.
  Typecheck + lint + prettier clean; API and web dev servers recompiled and booted without error.
  **Only P0 (co-locate API with the Sydney DB region) remains — infra, unblocked at deploy.**
