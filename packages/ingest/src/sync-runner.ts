import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import type {
  Connection,
  Connector,
  ConnectorLogger,
  CrawlContext,
  EdgeUpsert,
  NodeUpsert,
  RawResource,
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
      // One transaction per scope → a failure rolls the whole scope back (no partial).
      await withOrgScope(db, run.orgId, async (c) => {
        const urnToId = new Map<string, string>();
        const pendingEdges: EdgeUpsert[] = [];
        for await (const ref of connector.discover(scope, ctx)) {
          stats.discovered++;
          const raw = await connector.fetchDetail(ref, ctx);
          const node = connector.normalize(raw);
          const { id: nodeId, changed } = await persistNode(
            c,
            run,
            connection,
            node,
            raw,
            snapshots,
          );
          urnToId.set(node.urn, nodeId);
          stats.persisted++;
          if (!changed) stats.unchanged++;
          pendingEdges.push(...connector.observedEdges(raw));
          for (const signal of connector.extractSignals(raw)) {
            await persistSignal(c, run, connection, signal);
            stats.signals++;
          }
        }
        for (const edge of pendingEdges) {
          if (await persistEdge(c, run, urnToId, edge)) stats.edges++;
        }
      });
      completed.add(scope.key);
      stats.scopesOk++;
      await withOrgScope(db, run.orgId, (c) =>
        c.query("UPDATE sync_runs SET checkpoint = $2 WHERE id = $1", [
          run.id,
          JSON.stringify({ completedScopes: [...completed] }),
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
    await withOrgScope(db, run.orgId, async (c) => {
      const r = await c.query(
        `UPDATE nodes SET status = 'stale'
         WHERE connection_id = $1 AND status = 'active' AND last_sync_run_id IS DISTINCT FROM $2`,
        [run.connectionId, run.id],
      );
      stats.staled = r.rowCount ?? 0;
    });
  }
  const status: SyncResult["status"] = anyFailed
    ? stats.scopesOk > 0
      ? "partial"
      : "failed"
    : "succeeded";
  await finalize(db, run, status, stats, [...completed], failedScopes);
  return { status, stats, completedScopes: [...completed], failedScopes };
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

async function persistNode(
  c: PoolClient,
  run: SyncRunRecord,
  connection: Connection,
  node: NodeUpsert,
  raw: RawResource,
  snapshots: SnapshotStore,
): Promise<{ id: string; changed: boolean }> {
  // A node's provider is its URN prefix — the canonical identity (`<provider>:…`, docs/05).
  // For a well-behaved connector this equals connection.provider; it only differs for a node
  // one connector references but another owns (e.g. a cross-cloud datastore), where the URN is
  // authoritative. Deriving it here keeps `provider` consistent with the URN by construction.
  const provider = node.urn.split(":")[0] || connection.provider;
  // Self-bootstrap the kind vocabulary so we don't need a separate seed step.
  await c.query(
    `INSERT INTO node_kinds (kind, provider, category, description)
     VALUES ($1, $2, 'unknown', $1) ON CONFLICT (kind) DO NOTHING`,
    [node.kind, provider],
  );
  const region = typeof node.attributes.region === "string" ? node.attributes.region : null;
  const accountRef =
    typeof node.attributes.accountRef === "string" ? node.attributes.accountRef : null;

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO nodes
       (org_id, connection_id, urn, kind, name, provider, region, account_ref, attributes,
        status, confidence, last_seen, last_sync_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','observed', now(), $10)
     ON CONFLICT (org_id, urn) DO UPDATE SET
       name = EXCLUDED.name, provider = EXCLUDED.provider,
       -- Crawl attributes replace wholesale, but the health poll's out-of-band annotation
       -- must survive a sync (else every crawl flickers nodes back to health-unknown until
       -- the next poll tick).
       attributes = CASE
         WHEN nodes.attributes ? 'health'
           THEN EXCLUDED.attributes || jsonb_build_object('health', nodes.attributes->'health')
         ELSE EXCLUDED.attributes
       END,
       region = EXCLUDED.region, account_ref = EXCLUDED.account_ref,
       connection_id = EXCLUDED.connection_id, status = 'active', last_seen = now(),
       last_sync_run_id = EXCLUDED.last_sync_run_id
     RETURNING id`,
    [
      run.orgId,
      run.connectionId,
      node.urn,
      node.kind,
      node.displayName,
      provider,
      region,
      accountRef,
      JSON.stringify(node.attributes),
      run.id,
    ],
  );
  const nodeId = rows[0]?.id;
  if (!nodeId) throw new Error("node upsert returned no id");

  const payload = JSON.stringify(raw.payload);
  const contentHash = sha256(payload);

  // Incremental: if this node already has a snapshot with the same content hash, the
  // resource is unchanged — the upsert above refreshed last_seen; skip re-snapshot and
  // re-provenance (and the storage write) and signal "unchanged" so downstream
  // infer/index can be skipped too (docs/06 §6, §5.3).
  const existing = await c.query(
    "SELECT 1 FROM raw_snapshots WHERE org_id = $1 AND node_id = $2 AND content_hash = $3 LIMIT 1",
    [run.orgId, nodeId, contentHash],
  );
  if ((existing.rowCount ?? 0) > 0) {
    return { id: nodeId, changed: false };
  }

  const storageRef = await snapshots.put(run.orgId, contentHash, payload);
  const snap = await c.query<{ id: string }>(
    `INSERT INTO raw_snapshots (org_id, node_id, storage_ref, content_hash, sync_run_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [run.orgId, nodeId, storageRef, contentHash, run.id],
  );
  await c.query(
    `INSERT INTO provenance (org_id, source, sync_run_id, confidence, raw_snapshot_id)
     VALUES ($1,$2,$3,'observed',$4)`,
    [run.orgId, raw.ref.externalId, run.id, snap.rows[0]?.id ?? null],
  );
  return { id: nodeId, changed: true };
}

async function persistSignal(
  c: PoolClient,
  run: SyncRunRecord,
  connection: Connection,
  signal: Signal,
): Promise<void> {
  // Upsert by (org, subject_urn, kind) so re-syncs refresh in place (docs/05 §6.3).
  await c.query(
    `INSERT INTO signals (org_id, connection_id, subject_urn, kind, data, last_sync_run_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, subject_urn, kind) DO UPDATE SET
       data = EXCLUDED.data, connection_id = EXCLUDED.connection_id,
       last_seen = now(), last_sync_run_id = EXCLUDED.last_sync_run_id`,
    [
      run.orgId,
      run.connectionId,
      signal.subjectUrn,
      signal.kind,
      JSON.stringify(signal.data),
      run.id,
    ],
  );
}

async function persistEdge(
  c: PoolClient,
  run: SyncRunRecord,
  urnToId: Map<string, string>,
  edge: EdgeUpsert,
): Promise<boolean> {
  const fromId = urnToId.get(edge.fromUrn) ?? (await lookupNodeId(c, edge.fromUrn));
  const toId = urnToId.get(edge.toUrn) ?? (await lookupNodeId(c, edge.toUrn));
  // Skip unresolved endpoints / self-edges (the inference engine handles forward refs, G1).
  if (!fromId || !toId || fromId === toId) return false;

  // Edge metadata (e.g. a DEPENDS_ON_PKG's dependency `version`) has no column on `edges` by
  // design — it lives in the edge's provenance evidence (docs/05). Store it so downstream
  // queries (dependency sprawl) can read it back.
  const prov = await c.query<{ id: string }>(
    "INSERT INTO provenance (org_id, source, sync_run_id, confidence, evidence) VALUES ($1,$2,$3,'observed',$4) RETURNING id",
    [run.orgId, `edge:${edge.type}`, run.id, JSON.stringify(edge.attributes ?? {})],
  );
  await c.query(
    `INSERT INTO edges
       (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, last_seen, last_sync_run_id)
     VALUES ($1,$2,$3,$4,'observed','observed',$5, now(), $6)
     ON CONFLICT (org_id, from_node_id, to_node_id, type, inference_rule_id) DO UPDATE SET
       last_seen = now(), last_sync_run_id = EXCLUDED.last_sync_run_id, status = 'active',
       provenance_id = EXCLUDED.provenance_id`,
    [run.orgId, fromId, toId, edge.type, prov.rows[0]?.id, run.id],
  );
  return true;
}

async function lookupNodeId(c: PoolClient, urn: string): Promise<string | undefined> {
  const { rows } = await c.query<{ id: string }>("SELECT id FROM nodes WHERE urn = $1", [urn]);
  return rows[0]?.id;
}
