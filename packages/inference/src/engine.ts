/**
 * The inference engine (docs/05 §6.2, §6.5). Runs the registered rules over an org's
 * current nodes + signals + observed edges, then:
 *  - **upserts** surviving inferred edges with provenance (rule id + version + evidence),
 *  - **retires** (status='retired', not delete — P4) any active inferred edge a rule no
 *    longer produces.
 * Rules are pure (IE-1) so the active inferred-edge set is a deterministic function of
 * the inputs — re-running with unchanged inputs writes nothing (IE-4 convergence). All
 * work is org-scoped via withOrgScope (RLS, atlas_app role).
 */
import type { PoolClient } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import type {
  DerivedNode,
  EdgeLite,
  InferenceInput,
  InferenceStats,
  InferredEdge,
  NodeLite,
  Rule,
  SignalLite,
} from "./types";

export interface InferenceLogger {
  warn(message: string): void;
}
export interface InferenceDeps {
  db: Db;
  logger?: InferenceLogger;
}

const NOOP: InferenceLogger = { warn: () => undefined };

export async function runInference(
  deps: InferenceDeps,
  orgId: string,
  rules: readonly Rule[],
): Promise<InferenceStats> {
  const logger = deps.logger ?? NOOP;
  return withOrgScope(deps.db, orgId, async (c) => {
    // Serialize inference runs per org. Admin "Rebuild links" (reindex) can fire while the
    // post-sync inference is mid-run; without this they race in upsertInferredEdge — both see "no
    // edge yet", both INSERT, and the loser hits uq_edge (23505), which rolls back the WHOLE run.
    // A transaction-scoped advisory lock makes the second run wait for the first to commit (then it
    // sees the first run's edges and converges); it auto-releases on COMMIT/ROLLBACK.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('atlas_inference'), hashtext($1))`, [
      orgId,
    ]);

    // C2: scope the heavy JSONB load to what the registered rules actually consume. All nodes are
    // still loaded (id/urn/kind/name) so endpoint resolution never misses one — only `attributes`
    // (for non-consumed kinds) and non-consumed signals are dropped, bounding memory on big tenants.
    // The `consumption-contract` test guarantees each rule declares every kind/signal it reads.
    const consumedKinds = [...new Set(rules.flatMap((r) => r.consumesKinds))];
    const consumedSignalKinds = [...new Set(rules.flatMap((r) => r.consumesSignalKinds))];
    const input = await buildInput(c, consumedKinds, consumedSignalKinds);
    const ruleIdByKey = await loadRuleIds(c);
    // Preload every existing rule-produced edge once, keyed by (from,to,type,rule). In steady state
    // (IE-4) almost every candidate is already converged, so the old per-candidate existence SELECT
    // was N sequential round-trips to a remote DB that returned "already there, no-op". This collapses
    // those N reads into one, turning the convergence check into an in-memory lookup. Writes still
    // happen per changed edge (each needs its own provenance row); the INSERT's ON CONFLICT still
    // guards against a concurrent writer the preload couldn't have seen.
    const existingInferred = await loadExistingInferredEdges(c);
    const stats: InferenceStats = { candidates: 0, upserted: 0, retired: 0, derivedNodes: 0 };
    const keptByRule = new Map<string, string[]>();

    // Rules run in dependency order (R1 → R4 → R5/R6); each rule's derived nodes and kept
    // edges are folded back into `input` so later rules see them (single-pass convergence).
    for (const rule of rules) {
      const ruleId = ruleIdByKey.get(rule.key);
      if (!ruleId) {
        logger.warn(`inference: no inference_rules row for "${rule.key}" (skipped)`);
        continue;
      }
      const output = rule.evaluate(input);

      for (const node of output.nodes) {
        const id = await upsertDerivedNode(c, orgId, node);
        input.nodesByUrn.set(node.urn, {
          id,
          urn: node.urn,
          kind: node.kind,
          attributes: node.attributes,
        });
        stats.derivedNodes++;
      }

      stats.candidates += output.edges.length;
      const kept: string[] = [];
      for (const cand of output.edges) {
        const from = input.nodesByUrn.get(cand.fromUrn);
        const to = input.nodesByUrn.get(cand.toUrn);
        if (!from || !to || from.id === to.id) continue; // unresolved endpoint / self-edge
        // The user removed/rejected this exact link — don't re-infer it (it stays retired via the
        // convergence pass below, since we never add it to `kept`).
        if (input.rejectedEdgeKeys?.has(`${from.id}→${to.id}→${cand.type}`)) continue;
        const { id, wrote } = await upsertInferredEdge(
          c,
          orgId,
          rule.key,
          ruleId,
          from.id,
          to.id,
          cand,
          existingInferred.get(`${from.id}|${to.id}|${cand.type}|${ruleId}`),
        );
        kept.push(id);
        if (wrote) stats.upserted++;
        // Expose to later rules (converged edges included, so R4 sees R1's DEPLOYS_TO).
        input.inferredEdges.push({
          type: cand.type,
          fromUrn: cand.fromUrn,
          toUrn: cand.toUrn,
          tier: cand.tier,
        });
      }
      keptByRule.set(ruleId, kept);
    }

    // Convergence: retire active inferred edges the rule no longer produced this run.
    for (const [ruleId, kept] of keptByRule) {
      const r = await c.query(
        `UPDATE edges SET status='retired', retired_at=now()
         WHERE org_id=$1 AND origin='inferred' AND inference_rule_id=$2 AND status='active'
           AND NOT (id = ANY($3::uuid[]))`,
        [orgId, ruleId, kept],
      );
      stats.retired += r.rowCount ?? 0;
    }
    return stats;
  });
}

async function buildInput(
  c: PoolClient,
  consumedKinds: string[],
  consumedSignalKinds: string[],
): Promise<InferenceInput> {
  // Org slug for derived URNs — RLS scopes `organizations` to the current org.
  const orgSlug =
    (await c.query<{ slug: string }>(`SELECT slug FROM organizations LIMIT 1`)).rows[0]?.slug ?? "";

  // Load every node (id/urn/kind/name — cheap, keeps endpoint resolution complete), but project the
  // heavy `attributes` JSONB ONLY for the kinds some rule consumes (C2); others come back as `{}`.
  const nodes = (
    await c.query<{
      id: string;
      urn: string;
      kind: string;
      name: string | null;
      attributes: Record<string, unknown>;
    }>(
      `SELECT id, urn, kind, name,
              CASE WHEN kind = ANY($1::text[]) THEN attributes ELSE '{}'::jsonb END AS attributes
         FROM nodes WHERE status <> 'deleted'`,
      [consumedKinds],
    )
  ).rows;
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    const lite: NodeLite = {
      id: n.id,
      urn: n.urn,
      kind: n.kind,
      name: n.name,
      attributes: n.attributes ?? {},
    };
    nodesByUrn.set(lite.urn, lite);
    const list = nodesByKind.get(lite.kind);
    if (list) list.push(lite);
    else nodesByKind.set(lite.kind, [lite]);
  }

  // Signals: load only the kinds some rule consumes (C2) — signal `data` (IAM policy statements, SG
  // rules, PR file lists) is the heaviest JSONB, and no rule reads a signal kind it didn't declare.
  const signals: SignalLite[] = (
    await c.query<{ subject_urn: string; kind: string; data: Record<string, unknown> }>(
      `SELECT subject_urn, kind, data FROM signals WHERE kind = ANY($1::text[])`,
      [consumedSignalKinds],
    )
  ).rows.map((s) => ({ subjectUrn: s.subject_urn, kind: s.kind, data: s.data ?? {} }));
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const list = signalsByKind.get(s.kind);
    if (list) list.push(s);
    else signalsByKind.set(s.kind, [s]);
  }

  const observedEdges: EdgeLite[] = (
    await c.query<{ type: string; from_urn: string; to_urn: string }>(
      `SELECT e.type, nf.urn AS from_urn, nt.urn AS to_urn
         FROM edges e
         JOIN nodes nf ON nf.id = e.from_node_id
         JOIN nodes nt ON nt.id = e.to_node_id
        WHERE e.origin = 'observed' AND e.status = 'active'`,
    )
  ).rows.map((e) => ({ type: e.type, fromUrn: e.from_urn, toUrn: e.to_urn }));

  // Pairs the user explicitly removed/rejected — the engine must not re-infer them (docs/05).
  const rejectedEdgeKeys = new Set(
    (
      await c.query<{ from_node_id: string; to_node_id: string; type: string }>(
        `SELECT from_node_id, to_node_id, type FROM edge_suggestion_rejections`,
      )
    ).rows.map((r) => `${r.from_node_id}→${r.to_node_id}→${r.type}`),
  );

  return {
    orgSlug,
    nodesByUrn,
    nodesByKind,
    signals,
    signalsByKind,
    rejectedEdgeKeys,
    observedEdges,
    inferredEdges: [],
  };
}

/** Upsert a rule-derived node (e.g. atlas.service) by URN. No connection_id (derived). */
async function upsertDerivedNode(c: PoolClient, orgId: string, node: DerivedNode): Promise<string> {
  const provider = node.kind.split(".")[0] ?? "atlas";
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO nodes (org_id, urn, kind, name, provider, attributes, status, confidence, last_seen)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7, now())
     ON CONFLICT (org_id, urn) DO UPDATE SET
       name = EXCLUDED.name, attributes = EXCLUDED.attributes,
       status = 'active', confidence = EXCLUDED.confidence, last_seen = now()
     RETURNING id`,
    [
      orgId,
      node.urn,
      node.kind,
      node.displayName,
      provider,
      JSON.stringify(node.attributes),
      node.tier,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("derived node upsert returned no id");
  return id;
}

async function loadRuleIds(c: PoolClient): Promise<Map<string, string>> {
  const rows = (await c.query<{ id: string; key: string }>(`SELECT id, key FROM inference_rules`))
    .rows;
  return new Map(rows.map((r) => [r.key, r.id]));
}

/** A rule-produced edge as the convergence check needs it (id + current status/tier). */
interface ExistingEdge {
  id: string;
  status: string;
  confidence: string;
}

/**
 * Preload every rule-produced edge for the org (any status), keyed `${from}|${to}|${type}|${ruleId}`
 * — the same tuple {@link upsertInferredEdge} matched with a per-candidate SELECT. `uq_edge` makes the
 * key unique, and only inferred edges carry `inference_rule_id`, so this is exactly the set that
 * per-edge query could have returned. RLS scopes to the current org.
 */
async function loadExistingInferredEdges(c: PoolClient): Promise<Map<string, ExistingEdge>> {
  const rows = (
    await c.query<{
      id: string;
      from_node_id: string;
      to_node_id: string;
      type: string;
      inference_rule_id: string;
      status: string;
      confidence: string;
    }>(
      `SELECT id, from_node_id, to_node_id, type, inference_rule_id, status, confidence
         FROM edges WHERE inference_rule_id IS NOT NULL`,
    )
  ).rows;
  const m = new Map<string, ExistingEdge>();
  for (const r of rows) {
    m.set(`${r.from_node_id}|${r.to_node_id}|${r.type}|${r.inference_rule_id}`, {
      id: r.id,
      status: r.status,
      confidence: r.confidence,
    });
  }
  return m;
}

/**
 * Upsert one inferred edge. If an identical active edge already exists (same rule, from,
 * to, type, confidence) it's a no-op — the key to convergence (IE-4). Otherwise a fresh
 * provenance row (evidence) is written and the edge is (re)activated.
 */
async function upsertInferredEdge(
  c: PoolClient,
  orgId: string,
  ruleKey: string,
  ruleId: string,
  fromId: string,
  toId: string,
  cand: InferredEdge,
  existing: ExistingEdge | undefined,
): Promise<{ id: string; wrote: boolean }> {
  if (existing && existing.status === "active" && existing.confidence === cand.tier) {
    return { id: existing.id, wrote: false }; // already converged
  }

  const prov = await c.query<{ id: string }>(
    `INSERT INTO provenance (org_id, source, confidence, inference_rule_id, evidence)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, `rule:${ruleKey}`, cand.tier, ruleId, JSON.stringify(cand.evidence)],
  );
  const provId = prov.rows[0]?.id;

  if (existing) {
    await c.query(
      `UPDATE edges SET status='active', confidence=$2, provenance_id=$3, retired_at=NULL, last_seen=now()
        WHERE id=$1`,
      [existing.id, cand.tier, provId],
    );
    return { id: existing.id, wrote: true };
  }

  // ON CONFLICT (defense-in-depth beyond the per-run advisory lock): if a concurrent writer already
  // created this exact edge, reactivate it in place instead of crashing on uq_edge.
  const inserted = await c.query<{ id: string }>(
    `INSERT INTO edges
       (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id, last_seen)
     VALUES ($1,$2,$3,$4,'inferred',$5,$6,$7, now())
     ON CONFLICT ON CONSTRAINT uq_edge DO UPDATE
       SET status='active', origin='inferred', confidence=EXCLUDED.confidence,
           provenance_id=EXCLUDED.provenance_id, retired_at=NULL, last_seen=now()
     RETURNING id`,
    [orgId, fromId, toId, cand.type, cand.tier, provId, ruleId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("inferred edge insert returned no id");
  return { id, wrote: true };
}
