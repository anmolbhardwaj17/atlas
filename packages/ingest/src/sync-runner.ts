import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import type {
  Connection,
  Connector,
  ConnectorLogger,
  CrawlContext,
  EdgeUpsert,
  NodeUpsert,
  SecretAccessor,
  Signal,
  SyncRunType,
} from "@atlas/connector-sdk";
import type { SnapshotStore } from "./snapshot-store";
import { silentLogger } from "./runtime";

/** The sync_run being executed (the runner reads/writes the DB row by id). */
export interface SyncRunRecord {
  id: string;
  orgId: string;
  connectionId: string;
  type: SyncRunType;
}

export interface SyncStats {
  discovered: number;
  persisted: number;
  /** Resources whose content hash was unchanged since the last snapshot (docs/06 §6). */
  unchanged: number;
  edges: number;
  /** Inference-input signals persisted (docs/05 §6.3). */
  signals: number;
  staled: number;
  /** Observed edges retired because this SUCCEEDED run no longer saw them (BR-SYNC-2). */
  retiredEdges: number;
  scopesOk: number;
  scopesFailed: number;
}

export interface SyncResult {
  status: "succeeded" | "partial" | "failed";
  stats: SyncStats;
  completedScopes: string[];
  failedScopes: string[];
}

export interface RunnerDeps {
  db: Db;
  snapshots: SnapshotStore;
  secrets: SecretAccessor;
  logger?: ConnectorLogger;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** How often the crawl touches `sync_runs.updated_at` to prove liveness (≪ the 15-min reap threshold). */
const HEARTBEAT_MS = 60_000;

/** Best-effort liveness bump so a slow-but-alive scope isn't false-reaped. The trigger stamps
 *  updated_at; the `status='running'` guard makes a heartbeat on an already-reaped run a harmless
 *  no-op, and any failure here must never break the sync.
 *
 *  It also publishes the running totals. `stats` used to be written once, at finalize, which meant
 *  the UI could say nothing about a first sync beyond "syncing…" for its entire duration — the
 *  longest, least-reassuring wait in the product, right after a customer hands over cloud
 *  credentials. Since this UPDATE already runs on a timer with the right guard, carrying the
 *  counters costs one extra jsonb parameter and no additional round-trip. The values are a
 *  monotonically-growing snapshot, never read back by the runner, so a lost write is harmless. */
async function heartbeat(db: Db, run: SyncRunRecord, stats: SyncStats): Promise<void> {
  await withOrgScope(db, run.orgId, (c) =>
    c.query(
      "UPDATE sync_runs SET updated_at = now(), stats = $2::jsonb WHERE id = $1 AND status = 'running'",
      [run.id, JSON.stringify(stats)],
    ),
  ).catch(() => undefined);
}

/**
 * Run one staged sync (docs/06 §3, docs/02 §5.2): plan → per scope (discover →
 * fetchDetail → normalize/observedEdges → persist) → reconcile. Properties:
 *
 * - **Idempotent** — nodes/edges upsert by URN / uq_edge (re-runs don't duplicate).
 * - **Resumable** — completed scopes are recorded on `sync_runs.checkpoint`; a
 *   re-run of the same run skips them (P7).
 * - **No false deletes (BR-SYNC-2, docs/06 §7.4)** — each scope is one transaction
 *   (a failed scope rolls back wholly and is skipped, never half-persisted), and the
 *   reconcile that marks unseen nodes `stale` runs ONLY when every scope succeeded.
 *   Any scope failure ⇒ status `partial` and reconcile is skipped, so a transient
 *   provider error can never delete real resources.
 *
 * All DB work is org-scoped via `withOrgScope` (RLS-enforced, atlas_app role).
 */
export async function runStagedSync(
  deps: RunnerDeps,
  connector: Connector,
  connection: Connection,
  run: SyncRunRecord,
): Promise<SyncResult> {
  const { db, snapshots, secrets } = deps;
  const logger = deps.logger ?? silentLogger;
  const stats: SyncStats = {
    discovered: 0,
    persisted: 0,
    unchanged: 0,
    edges: 0,
    signals: 0,
    staled: 0,
    retiredEdges: 0,
    scopesOk: 0,
    scopesFailed: 0,
  };
  const failedScopes: string[] = [];

  await withOrgScope(db, run.orgId, (c) =>
    c.query(
      "UPDATE sync_runs SET status='running', started_at = COALESCE(started_at, now()) WHERE id = $1",
      [run.id],
    ),
  );

  // Resume: which scopes already completed (persisted to the run's checkpoint)?
  const completed = new Set<string>(await loadCompletedScopes(db, run));

  const ctx: CrawlContext = {
    connection,
    run: {
      id: run.id,
      orgId: run.orgId,
      connectionId: run.connectionId,
      type: run.type,
      checkpoint: {},
    },
    secrets,
    log: logger,
  };

  let plan;
  try {
    plan = await connector.plan(connection, ctx.run);
  } catch (err) {
    await finalize(db, run, "failed", stats, [...completed], failedScopes);
    logger.error(`plan failed: ${(err as Error).message}`);
    return { status: "failed", stats, completedScopes: [...completed], failedScopes };
  }

  for (const scope of plan.scopes) {
    if (completed.has(scope.key)) {
      logger.debug(`skip completed scope ${scope.key}`);
      continue;
    }
    try {
      // Phase 1 — CRAWL (no DB transaction, C1). discover → fetchDetail → normalize are network I/O
      // against the provider and a big scope can take minutes; running them here (not inside the
      // persist txn) means we no longer hold a pooled DB connection + an open transaction across the
      // whole cloud crawl (which starved the pool and held the txn open). Results are buffered per
      // scope (bounded) then persisted in one batched transaction below.
      const itemsByUrn = new Map<string, CrawlItem>();
      let lastBeat = Date.now();
      for await (const ref of connector.discover(scope, ctx)) {
        stats.discovered++;
        // Heartbeat: the crawl holds no DB connection (C1), so a scope that takes minutes would let
        // sync_runs.updated_at go stale and the reaper would false-reap this live run mid-flight (its
        // replacement could then interleave). Touch updated_at periodically — well under the 15-min
        // reap threshold — so a legitimately-slow scope is never mistaken for an orphaned one.
        if (Date.now() - lastBeat > HEARTBEAT_MS) {
          await heartbeat(db, run, stats);
          lastBeat = Date.now();
        }
        const raw = await connector.fetchDetail(ref, ctx);
        const node = connector.normalize(raw);
        const payload = JSON.stringify(raw.payload);
        // Dedupe by URN: a connector emitting the same URN twice in a scope would break the batch
        // upsert's ON CONFLICT ("cannot affect row a second time"); last write wins, matching the
        // old per-row upsert's overwrite semantics.
        itemsByUrn.set(node.urn, {
          node,
          provider: node.urn.split(":")[0] || connection.provider,
          region: typeof node.attributes.region === "string" ? node.attributes.region : null,
          accountRef:
            typeof node.attributes.accountRef === "string" ? node.attributes.accountRef : null,
          payload,
          contentHash: sha256(payload),
          source: raw.ref.externalId,
          signals: connector.extractSignals(raw),
          edges: connector.observedEdges(raw),
        });
      }

      // Phase 2 — PERSIST (one transaction per scope → a failure rolls the whole scope back, no
      // partial persist; BR-SYNC-2). Every write is batched (one round-trip per kind of write)
      // instead of the old ~5 serial round-trips per resource.
      const items = [...itemsByUrn.values()];
      await withOrgScope(db, run.orgId, async (c) => {
        const { urnToId, unchanged } = await persistNodesBatch(c, run, snapshots, items);
        stats.persisted += items.length;
        stats.unchanged += unchanged;
        stats.signals += await persistSignalsBatch(c, run, items);
        stats.edges += await persistEdgesBatch(c, run, urnToId, items);
      });
      completed.add(scope.key);
      stats.scopesOk++;
      // Publish the checkpoint AND the running totals. Most scopes finish well inside one heartbeat
      // interval, so without this the counters would only move once a minute — the progress would
      // look stalled on exactly the fast, healthy syncs. Same statement, one more parameter.
      await withOrgScope(db, run.orgId, (c) =>
        c.query("UPDATE sync_runs SET checkpoint = $2, stats = $3::jsonb WHERE id = $1", [
          run.id,
          JSON.stringify({ completedScopes: [...completed] }),
          JSON.stringify(stats),
        ]),
      );
    } catch (err) {
      logger.error(`scope ${scope.key} failed: ${(err as Error).message}`);
      failedScopes.push(scope.key);
      stats.scopesFailed++;
    }
  }

  const anyFailed = failedScopes.length > 0;
  if (!anyFailed) {
    stats.staled = await reconcileStaleNodes(db, run);
    stats.retiredEdges = await reconcileObservedEdges(db, run);
  }
  const status: SyncResult["status"] = anyFailed
    ? stats.scopesOk > 0
      ? "partial"
      : "failed"
    : "succeeded";
  await finalize(db, run, status, stats, [...completed], failedScopes);
  return { status, stats, completedScopes: [...completed], failedScopes };
}

/**
 * Reconcile (BR-SYNC-2): after a SUCCEEDED run, mark this connection's `active` nodes that the run
 * did NOT re-observe (last_sync_run_id ≠ this run) as `stale`. Returns the count staled.
 *
 * GUARD (`EXISTS ... status='running'`): only reconcile while THIS run is still the authoritative
 * running run. A run that stalled >15 min, got reaped to `failed`, and only NOW finished crawling
 * must NOT stale the FRESH nodes of its replacement run B (whose last_sync_run_id ≠ this run) — a
 * false delete (violates the "never delete-mark on a non-succeeding/superseded run" invariant).
 * `uq_sync_inflight` guarantees at most one *running* run per connection, so a live `running` status
 * here means no replacement exists yet; a reaped run makes the EXISTS fail → 0 rows, harmlessly.
 */
export async function reconcileStaleNodes(db: Db, run: SyncRunRecord): Promise<number> {
  return withOrgScope(db, run.orgId, async (c) => {
    const r = await c.query(
      `UPDATE nodes SET status = 'stale'
         WHERE connection_id = $1 AND status = 'active' AND last_sync_run_id IS DISTINCT FROM $2
           AND EXISTS (SELECT 1 FROM sync_runs WHERE id = $2 AND status = 'running')`,
      [run.connectionId, run.id],
    );
    return r.rowCount ?? 0;
  });
}

/**
 * Reconcile OBSERVED edges (BR-SYNC-2, docs/05): after a SUCCEEDED run, retire this connection's
 * `active` observed edges that the run no longer saw (`last_sync_run_id ≠ this run`) — a relationship
 * that vanished from source. Mirrors the node reconcile above; only `origin='observed'` edges are
 * touched (the inference engine owns retirement of `origin='inferred'` edges via convergence). Same
 * reaper guard as `reconcileStaleNodes` so a reaped-but-late run can't retire a replacement run's
 * fresh edges. `persistEdge` re-stamps `last_sync_run_id` on every re-observed edge, so a still-valid
 * edge is never retired. Returns the count retired.
 */
export async function reconcileObservedEdges(db: Db, run: SyncRunRecord): Promise<number> {
  return withOrgScope(db, run.orgId, async (c) => {
    const r = await c.query(
      `UPDATE edges SET status = 'retired', retired_at = now()
         WHERE origin = 'observed' AND status = 'active' AND last_sync_run_id IS DISTINCT FROM $2
           AND (from_node_id IN (SELECT id FROM nodes WHERE connection_id = $1)
                OR to_node_id IN (SELECT id FROM nodes WHERE connection_id = $1))
           AND EXISTS (SELECT 1 FROM sync_runs WHERE id = $2 AND status = 'running')`,
      [run.connectionId, run.id],
    );
    return r.rowCount ?? 0;
  });
}

async function loadCompletedScopes(db: Db, run: SyncRunRecord): Promise<string[]> {
  return withOrgScope(db, run.orgId, async (c) => {
    const { rows } = await c.query<{ checkpoint: { completedScopes?: string[] } }>(
      "SELECT checkpoint FROM sync_runs WHERE id = $1",
      [run.id],
    );
    return rows[0]?.checkpoint?.completedScopes ?? [];
  });
}

async function finalize(
  db: Db,
  run: SyncRunRecord,
  status: SyncResult["status"],
  stats: SyncStats,
  completedScopes: string[],
  failedScopes: string[],
): Promise<void> {
  await withOrgScope(db, run.orgId, async (c) => {
    // Compare-and-set on `status='running'`: if the reaper already gave up on this run (marked it
    // 'failed' after 15 min of no progress), a slow-but-late worker must NOT resurrect it back to
    // 'succeeded' and stamp a bogus freshness. The reaped run stays failed; this finalize no-ops.
    const res = await c.query(
      "UPDATE sync_runs SET status = $2, stats = $3, scope_result = $4, finished_at = now() WHERE id = $1 AND status = 'running'",
      [run.id, status, JSON.stringify(stats), JSON.stringify({ completedScopes, failedScopes })],
    );
    if (res.rowCount === 0) return; // reaped (or already finalized) — don't touch freshness
    // Stamp the connection's freshness so the UI can show "synced N ago". Only on a run that
    // actually persisted data (a hard failure leaves the prior last_synced_at untouched).
    if (status === "succeeded" || status === "partial") {
      await c.query("UPDATE connections SET last_synced_at = now() WHERE id = $1", [
        run.connectionId,
      ]);
    }
  });
}

/** One crawled resource, buffered in Phase 1 (network) for the batched Phase-2 persist. */
interface CrawlItem {
  node: NodeUpsert;
  /** URN-prefix provider (`<provider>:…`, docs/05) — authoritative even when it differs from
   *  connection.provider (a node one connector references but another owns). */
  provider: string;
  region: string | null;
  accountRef: string | null;
  /** Canonical JSON of `raw.payload` — content-hashed + snapshotted (P4). */
  payload: string;
  contentHash: string;
  /** `raw.ref.externalId` — the provenance source id. */
  source: string;
  signals: Signal[];
  edges: EdgeUpsert[];
}

/**
 * Batch-persist a scope's nodes (C1). Collapses the old ~5 serial round-trips per resource into a
 * handful of set-based statements: node_kinds seed → nodes upsert → snapshot existence check →
 * (for changed only) storage put + raw_snapshots + provenance. Returns urn→id for edge resolution
 * and the count of unchanged nodes (same content hash as an existing snapshot ⇒ skip re-snapshot,
 * docs/06 §6). Node upsert semantics (health-annotation preservation, last_seen/last_sync_run_id
 * re-stamp) are unchanged from the old per-row path.
 */
async function persistNodesBatch(
  c: PoolClient,
  run: SyncRunRecord,
  snapshots: SnapshotStore,
  items: CrawlItem[],
): Promise<{ urnToId: Map<string, string>; unchanged: number }> {
  const urnToId = new Map<string, string>();
  if (items.length === 0) return { urnToId, unchanged: 0 };

  // Self-bootstrap the kind vocabulary (no separate seed step). DISTINCT (kind,provider); first
  // provider wins per kind via ON CONFLICT, same as the old per-row insert.
  await c.query(
    `INSERT INTO node_kinds (kind, provider, category, description)
     SELECT DISTINCT k, p, 'unknown', k FROM unnest($1::text[], $2::text[]) AS t(k, p)
     ON CONFLICT (kind) DO NOTHING`,
    [items.map((i) => i.node.kind), items.map((i) => i.provider)],
  );

  const { rows } = await c.query<{ id: string; urn: string }>(
    `INSERT INTO nodes
       (org_id, connection_id, urn, kind, name, provider, region, account_ref, attributes,
        status, confidence, last_seen, last_sync_run_id)
     SELECT $1, $2, u.urn, u.kind, u.name, u.provider, u.region, u.account_ref, u.attributes::jsonb,
            'active', 'observed', now(), $3
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
            AS u(urn, kind, name, provider, region, account_ref, attributes)
     ON CONFLICT (org_id, urn) DO UPDATE SET
       name = EXCLUDED.name, provider = EXCLUDED.provider,
       -- Crawl attributes replace wholesale, but the health poll's out-of-band annotation must
       -- survive a sync (else every crawl flickers nodes back to health-unknown until the next poll).
       attributes = CASE
         WHEN nodes.attributes ? 'health'
           THEN EXCLUDED.attributes || jsonb_build_object('health', nodes.attributes->'health')
         ELSE EXCLUDED.attributes
       END,
       region = EXCLUDED.region, account_ref = EXCLUDED.account_ref,
       connection_id = EXCLUDED.connection_id, status = 'active', last_seen = now(),
       last_sync_run_id = EXCLUDED.last_sync_run_id
     RETURNING id, urn`,
    [
      run.orgId,
      run.connectionId,
      run.id,
      items.map((i) => i.node.urn),
      items.map((i) => i.node.kind),
      items.map((i) => i.node.displayName),
      items.map((i) => i.provider),
      items.map((i) => i.region),
      items.map((i) => i.accountRef),
      items.map((i) => JSON.stringify(i.node.attributes)),
    ],
  );
  for (const r of rows) urnToId.set(r.urn, r.id);
  if (urnToId.size !== items.length) throw new Error("node batch upsert returned unexpected rows");

  // Incremental: a node whose latest content hash already has a snapshot is unchanged — the upsert
  // above refreshed last_seen; skip re-snapshot/re-provenance/storage-write (docs/06 §6, §5.3).
  const nodeIds = items.map((i) => urnToId.get(i.node.urn) as string);
  const existing = new Set<string>();
  const ex = await c.query<{ node_id: string; content_hash: string }>(
    `SELECT node_id, content_hash FROM raw_snapshots
      WHERE org_id = $1
        AND (node_id, content_hash) IN (SELECT n, h FROM unnest($2::uuid[], $3::text[]) AS t(n, h))`,
    [run.orgId, nodeIds, items.map((i) => i.contentHash)],
  );
  for (const r of ex.rows) existing.add(`${r.node_id}|${r.content_hash}`);

  const changed = items.filter((i) => !existing.has(`${urnToId.get(i.node.urn)}|${i.contentHash}`));
  const unchanged = items.length - changed.length;
  if (changed.length === 0) return { urnToId, unchanged };

  // Storage put stays inside the txn (append-only, content-addressed, and only for CHANGED nodes —
  // bounded, unlike the crawl which is now outside). A rolled-back scope leaves at most an orphan,
  // content-deduped blob. Provenance links back to snapshots by node_id (order-independent).
  const changedNodeIds: string[] = [];
  const storageRefs: string[] = [];
  const changedHashes: string[] = [];
  for (const i of changed) {
    storageRefs.push(await snapshots.put(run.orgId, i.contentHash, i.payload));
    changedNodeIds.push(urnToId.get(i.node.urn) as string);
    changedHashes.push(i.contentHash);
  }
  const snaps = await c.query<{ id: string; node_id: string }>(
    `INSERT INTO raw_snapshots (org_id, node_id, storage_ref, content_hash, sync_run_id)
     SELECT $1, n, r, h, $2 FROM unnest($3::uuid[], $4::text[], $5::text[]) AS t(n, r, h)
     RETURNING id, node_id`,
    [run.orgId, run.id, changedNodeIds, storageRefs, changedHashes],
  );
  const snapByNode = new Map(snaps.rows.map((s) => [s.node_id, s.id]));
  await c.query(
    `INSERT INTO provenance (org_id, source, sync_run_id, confidence, raw_snapshot_id)
     SELECT $1, s, $2, 'observed', r FROM unnest($3::text[], $4::uuid[]) AS t(s, r)`,
    [
      run.orgId,
      run.id,
      changed.map((i) => i.source),
      changed.map((i) => snapByNode.get(urnToId.get(i.node.urn) as string) ?? null),
    ],
  );
  return { urnToId, unchanged };
}

/**
 * Batch-upsert a scope's signals, deduped by (subject_urn, kind) last-wins (the batch's ON CONFLICT
 * can't touch the same row twice). Upsert-by-(org,subject_urn,kind) so re-syncs refresh in place
 * (docs/05 §6.3). Returns the number of distinct signals persisted.
 */
async function persistSignalsBatch(
  c: PoolClient,
  run: SyncRunRecord,
  items: CrawlItem[],
): Promise<number> {
  const byKey = new Map<string, Signal>();
  for (const i of items) for (const s of i.signals) byKey.set(`${s.subjectUrn}|${s.kind}`, s);
  const sigs = [...byKey.values()];
  if (sigs.length === 0) return 0;
  await c.query(
    `INSERT INTO signals (org_id, connection_id, subject_urn, kind, data, last_sync_run_id)
     SELECT $1, $2, s, k, d::jsonb, $3 FROM unnest($4::text[], $5::text[], $6::text[]) AS t(s, k, d)
     ON CONFLICT (org_id, subject_urn, kind) DO UPDATE SET
       data = EXCLUDED.data, connection_id = EXCLUDED.connection_id,
       last_seen = now(), last_sync_run_id = EXCLUDED.last_sync_run_id`,
    [
      run.orgId,
      run.connectionId,
      run.id,
      sigs.map((s) => s.subjectUrn),
      sigs.map((s) => s.kind),
      sigs.map((s) => JSON.stringify(s.data)),
    ],
  );
  return sigs.length;
}

/**
 * Batch-upsert a scope's observed edges. Resolves endpoints against this scope's urn→id plus one
 * batched lookup for URNs owned by other scopes/prior runs; skips unresolved endpoints + self-edges
 * (the inference engine handles forward refs, G1). Deduped by (from,to,type) last-wins. Each edge
 * gets a client-generated provenance UUID so provenance↔edge pair without relying on RETURNING order
 * — evidence (e.g. a dependency `version`) lives on provenance, not a column (docs/05, BR-EDGE-2).
 * Returns the number of distinct edges upserted.
 */
async function persistEdgesBatch(
  c: PoolClient,
  run: SyncRunRecord,
  urnToId: Map<string, string>,
  items: CrawlItem[],
): Promise<number> {
  const allEdges = items.flatMap((i) => i.edges);
  if (allEdges.length === 0) return 0;

  const resolved = new Map(urnToId);
  const needLookup = new Set<string>();
  for (const e of allEdges) {
    if (!resolved.has(e.fromUrn)) needLookup.add(e.fromUrn);
    if (!resolved.has(e.toUrn)) needLookup.add(e.toUrn);
  }
  if (needLookup.size > 0) {
    const { rows } = await c.query<{ id: string; urn: string }>(
      "SELECT id, urn FROM nodes WHERE urn = ANY($1::text[])",
      [[...needLookup]],
    );
    for (const r of rows) resolved.set(r.urn, r.id);
  }

  const byKey = new Map<
    string,
    { fromId: string; toId: string; type: string; evidence: Record<string, unknown> }
  >();
  for (const e of allEdges) {
    const fromId = resolved.get(e.fromUrn);
    const toId = resolved.get(e.toUrn);
    if (!fromId || !toId || fromId === toId) continue;
    byKey.set(`${fromId}|${toId}|${e.type}`, {
      fromId,
      toId,
      type: e.type,
      evidence: e.attributes ?? {},
    });
  }
  const edges = [...byKey.values()];
  if (edges.length === 0) return 0;

  const provIds = edges.map(() => randomUUID());
  await c.query(
    `INSERT INTO provenance (id, org_id, source, sync_run_id, confidence, evidence)
     SELECT p, $1, 'edge:' || typ, $2, 'observed', ev::jsonb
       FROM unnest($3::uuid[], $4::text[], $5::text[]) AS t(p, typ, ev)`,
    [
      run.orgId,
      run.id,
      provIds,
      edges.map((e) => e.type),
      edges.map((e) => JSON.stringify(e.evidence)),
    ],
  );
  await c.query(
    `INSERT INTO edges
       (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, last_seen, last_sync_run_id)
     SELECT $1, f, t2, typ, 'observed', 'observed', p, now(), $2
       FROM unnest($3::uuid[], $4::uuid[], $5::text[], $6::uuid[]) AS x(f, t2, typ, p)
     ON CONFLICT (org_id, from_node_id, to_node_id, type, inference_rule_id) DO UPDATE SET
       last_seen = now(), last_sync_run_id = EXCLUDED.last_sync_run_id, status = 'active',
       provenance_id = EXCLUDED.provenance_id`,
    [
      run.orgId,
      run.id,
      edges.map((e) => e.fromId),
      edges.map((e) => e.toId),
      edges.map((e) => e.type),
      provIds,
    ],
  );
  return edges.length;
}
