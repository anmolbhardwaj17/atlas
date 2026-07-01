/**
 * Pure evaluation of the full rule set over an InferenceInput — the same dependency-
 * ordered fold the engine performs (each rule's derived nodes + kept edges are folded
 * back so later rules see them), but WITHOUT any DB. This is what the determinism
 * golden-file and precision-sampling tests run (docs/14 §10), and it mirrors the engine
 * so the two can't drift: identical inputs ⇒ identical planned nodes+edges (IE-1/A19).
 */
import type { DerivedNode, InferenceInput, InferredEdge, NodeLite, Rule } from "./types";

export interface EvaluatedPlan {
  nodes: DerivedNode[];
  edges: InferredEdge[];
}

export function evaluateAll(base: InferenceInput, rules: readonly Rule[]): EvaluatedPlan {
  // Work on copies so the fold is self-contained (no mutation of the caller's input).
  const nodesByUrn = new Map(base.nodesByUrn);
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const [k, v] of base.nodesByKind) nodesByKind.set(k, [...v]);
  const inferredEdges = [...base.inferredEdges];
  const input: InferenceInput = { ...base, nodesByUrn, nodesByKind, inferredEdges };

  const nodes: DerivedNode[] = [];
  const edges: InferredEdge[] = [];

  for (const rule of rules) {
    const out = rule.evaluate(input);
    for (const dn of out.nodes) {
      nodes.push(dn);
      const lite: NodeLite = { id: dn.urn, urn: dn.urn, kind: dn.kind, attributes: dn.attributes };
      nodesByUrn.set(dn.urn, lite);
      const list = nodesByKind.get(dn.kind);
      if (list) list.push(lite);
      else nodesByKind.set(dn.kind, [lite]);
    }
    for (const e of out.edges) {
      const from = nodesByUrn.get(e.fromUrn);
      const to = nodesByUrn.get(e.toUrn);
      if (!from || !to || from.id === to.id) continue; // mirror the engine's skip
      edges.push(e);
      inferredEdges.push({ type: e.type, fromUrn: e.fromUrn, toUrn: e.toUrn, tier: e.tier });
    }
  }
  return { nodes, edges };
}
