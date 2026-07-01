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
  InferenceInput,
  InferenceStats,
  InferredEdge,
  NodeLite,
  ObservedEdgeLite,
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
    const input = await buildInput(c);
    const ruleIdByKey = await loadRuleIds(c);
    const stats: InferenceStats = { candidates: 0, upserted: 0, retired: 0 };
    const keptByRule = new Map<string, string[]>();

    for (const rule of rules) {
      const ruleId = ruleIdByKey.get(rule.key);
      if (!ruleId) {
        logger.warn(`inference: no inference_rules row for "${rule.key}" (skipped)`);
        continue;
      }
      const candidates = rule.evaluate(input);
      stats.candidates += candidates.length;
      const kept: string[] = [];
      for (const cand of candidates) {
        const from = input.nodesByUrn.get(cand.fromUrn);
        const to = input.nodesByUrn.get(cand.toUrn);
        if (!from || !to || from.id === to.id) continue; // unresolved endpoint / self-edge
        const { id, wrote } = await upsertInferredEdge(
          c,
          orgId,
          rule.key,
          ruleId,
          from.id,
          to.id,
          cand,
        );
        kept.push(id);
        if (wrote) stats.upserted++;
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

async function buildInput(c: PoolClient): Promise<InferenceInput> {
  const nodes = (
    await c.query<{ id: string; urn: string; kind: string; attributes: Record<string, unknown> }>(
      `SELECT id, urn, kind, attributes FROM nodes WHERE status <> 'deleted'`,
    )
  ).rows;
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    const lite: NodeLite = { id: n.id, urn: n.urn, kind: n.kind, attributes: n.attributes ?? {} };
    nodesByUrn.set(lite.urn, lite);
    const list = nodesByKind.get(lite.kind);
    if (list) list.push(lite);
    else nodesByKind.set(lite.kind, [lite]);
  }

  const signals: SignalLite[] = (
    await c.query<{ subject_urn: string; kind: string; data: Record<string, unknown> }>(
      `SELECT subject_urn, kind, data FROM signals`,
    )
  ).rows.map((s) => ({ subjectUrn: s.subject_urn, kind: s.kind, data: s.data ?? {} }));
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const list = signalsByKind.get(s.kind);
    if (list) list.push(s);
    else signalsByKind.set(s.kind, [s]);
  }

  const observedEdges: ObservedEdgeLite[] = (
    await c.query<{ type: string; from_urn: string; to_urn: string }>(
      `SELECT e.type, nf.urn AS from_urn, nt.urn AS to_urn
         FROM edges e
         JOIN nodes nf ON nf.id = e.from_node_id
         JOIN nodes nt ON nt.id = e.to_node_id
        WHERE e.origin = 'observed' AND e.status = 'active'`,
    )
  ).rows.map((e) => ({ type: e.type, fromUrn: e.from_urn, toUrn: e.to_urn }));

  return { nodesByUrn, nodesByKind, signals, signalsByKind, observedEdges };
}

async function loadRuleIds(c: PoolClient): Promise<Map<string, string>> {
  const rows = (await c.query<{ id: string; key: string }>(`SELECT id, key FROM inference_rules`))
    .rows;
  return new Map(rows.map((r) => [r.key, r.id]));
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
): Promise<{ id: string; wrote: boolean }> {
  const existing = (
    await c.query<{ id: string; status: string; confidence: string }>(
      `SELECT id, status, confidence FROM edges
        WHERE org_id=$1 AND from_node_id=$2 AND to_node_id=$3 AND type=$4 AND inference_rule_id=$5`,
      [orgId, fromId, toId, cand.type, ruleId],
    )
  ).rows[0];

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

  const inserted = await c.query<{ id: string }>(
    `INSERT INTO edges
       (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id, last_seen)
     VALUES ($1,$2,$3,$4,'inferred',$5,$6,$7, now())
     RETURNING id`,
    [orgId, fromId, toId, cand.type, cand.tier, provId, ruleId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("inferred edge insert returned no id");
  return { id, wrote: true };
}
