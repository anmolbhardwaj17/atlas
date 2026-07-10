# Performance — findings & plan

> Status: **investigation done, first fix shipped.** Owner concern (2026-07-10): "data takes time
> to load; switching pages feels slow; the URL takes time to even switch, then loading comes."
> This doc records what was measured, the root cause, and the prioritized plan. Resume at **P0/P1**.

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

### P1 — Cut sequential DB round-trips per request
- ✅ **Fold BEGIN + set_config** in `withOrgScope` → −1 hop everywhere (shipped, `packages/db/src/client.ts`).
- ⏳ **Consolidate multi-scope endpoints**: find endpoints that call `withOrgScope` more than once per
  request and merge into a single transaction (one BEGIN/set_config/COMMIT, queries inside). Audit
  dashboard metrics, map data, insights first (heaviest / landing).
- ⏳ **Batch independent reads**: within a scope, run independent SELECTs as one simple-query batch
  (measured 170 ms vs 610 ms), or fan out across pooled connections for true parallelism.

### P2 — Kill the redundant `/me` round-trips + client cache
- ⏳ The shell fetches `/me` on every navigation. De-dupe: cache `/me` on the client (SWR/React-Query,
  stale-while-revalidate) so revisits + org switches are instant; have `OrgSwitcher` /
  `NotificationBell` read the same cache instead of their own fetches.
- ⏳ Trim the `/me` payload / query cost.

### P3 — Suspense streaming
- ⏳ Render the shell + skeleton instantly and stream data via `<Suspense>` on heavy pages, so the URL
  and layout paint immediately (loading.tsx skeletons already exist for every route).

### P4 — Prefetch & polish
- ⏳ Prefetch-on-hover for nav; confirm prod Link prefetch; audit client bundle (React Flow on Map is
  heavy — code-split / lazy-load offscreen).

---

## Done
- **2026-07-10** — `withOrgScope` folds BEGIN + set_config into one round-trip (−1 hop per scoped op).
  RLS verified intact (unscoped count returns the org's rows, 0 for another org, as `atlas_app`).
