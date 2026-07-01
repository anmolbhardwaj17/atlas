/**
 * Context builder (docs/10 §4.4, DD-3). Assembles a compact, structured CONTEXT block
 * where EVERY fact carries a stable citation marker (N1, E1…). The LLM is told it may use
 * only these facts (the single most important hallucination defense, AE-1/L2). The `cites`
 * map lets the Citation Engine (G3.4) bind the model's markers back to real node/edge ids
 * deterministically (DD-5). Confidence + freshness travel into the context so the narrator
 * states them faithfully.
 */
import type { RetrievalResult } from "./retrieval";

export interface Cite {
  marker: string;
  kind: "node" | "edge";
  id: string;
  confidence: string | null;
}

export interface BuiltContext {
  context: string;
  cites: Cite[];
  /** Distinct node ids surfaced (for the `retrieval` SSE "nodes considered" + audit). */
  nodesConsidered: number;
  /** Staleness/truncation notes → answer caveats (docs/10 §5). */
  freshnessNotes: string[];
}

export function buildContext(orgId: string, result: RetrievalResult): BuiltContext {
  const cites: Cite[] = [];
  const nodeMarker = new Map<string, string>();
  const edgeMarker = new Map<string, string>();
  const nodeLines: string[] = [];
  const edgeLines: string[] = [];
  const notes: string[] = [];

  const nodeRef = (
    id: string,
    kind: string,
    name: string | null,
    confidence?: string | null,
  ): string => {
    let marker = nodeMarker.get(id);
    if (!marker) {
      marker = `N${nodeMarker.size + 1}`;
      nodeMarker.set(id, marker);
      cites.push({ marker, kind: "node", id, confidence: confidence ?? null });
      nodeLines.push(
        `  ${marker} (cite:${id}) kind=${kind} name=${name ?? "?"}${confidence ? ` confidence=${confidence}` : ""}`,
      );
    }
    return marker;
  };
  const edgeRef = (
    id: string,
    fromMarker: string,
    type: string,
    toMarker: string,
    confidence: string,
    evidence?: Record<string, unknown>,
  ): void => {
    if (edgeMarker.has(id)) return;
    const marker = `E${edgeMarker.size + 1}`;
    edgeMarker.set(id, marker);
    cites.push({ marker, kind: "edge", id, confidence });
    const ev =
      evidence && Object.keys(evidence).length > 0 ? `  evidence: ${compact(evidence)}` : "";
    edgeLines.push(
      `  ${marker} (cite:${id}) ${fromMarker} --${type}--> ${toMarker} confidence=${confidence}${ev}`,
    );
  };

  if (result.rootNode) {
    const r = result.rootNode;
    nodeRef(r.id, r.kind, r.name, r.confidence);
  }

  if (result.traversal) {
    const t = result.traversal;
    const rootMarker = nodeRef(t.root.id, t.root.kind, t.root.name);
    for (const imp of t.impacted) {
      const fromMarker = nodeRef(imp.node.id, imp.node.kind, imp.node.name);
      // The why-chain: the first via edge connects impacted node toward the root.
      const via = imp.via[0];
      if (via) edgeRef(via.edgeId, fromMarker, via.type, rootMarker, via.confidence, via.evidence);
    }
    if (t.truncated) notes.push("results truncated to the node budget");
    for (const w of t.warnings) notes.push(w);
  }

  for (const e of result.edges ?? []) {
    const fromMarker = nodeRef(e.from.id, "", e.from.name);
    const toMarker = nodeRef(e.to.id, "", e.to.name);
    edgeRef(e.id, fromMarker, e.type, toMarker, e.confidence);
  }

  const timelineLines = (result.timeline ?? []).map(
    (c) => `  ${c.at} ${c.changeKind} ${c.changeType}: ${compact(c.entity)}`,
  );

  const sections: string[] = [`[CONTEXT — org:${orgId} — these are the ONLY facts you may use]`];
  if (nodeLines.length) sections.push("NODES:", ...nodeLines);
  if (edgeLines.length) sections.push("EDGES:", ...edgeLines);
  if (timelineLines.length) sections.push("CHANGES:", ...timelineLines);
  if (notes.length) sections.push("FRESHNESS:", ...notes.map((n) => `  ${n}`));
  sections.push("[END CONTEXT]");

  return {
    context: sections.join("\n"),
    cites,
    nodesConsidered: nodeMarker.size,
    freshnessNotes: notes,
  };
}

/** Compact single-line JSON-ish rendering (token-frugal; untrusted data stays delimited). */
function compact(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}
