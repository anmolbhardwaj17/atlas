import { Inject, Injectable } from "@nestjs/common";
import type {
  RetrievalPort,
  RetrievedEdge,
  RetrievedNode,
  SearchHit,
  TimelineChange,
  Traversal,
  TraversalOpts,
} from "@atlas/ai";
import { ApiException } from "../common/errors";
import { GraphService } from "../graph/graph.service";
import { SEARCH_PROVIDER, type SearchProvider } from "../search/search.provider";

/**
 * Adapts the AI engine's RetrievalPort (docs/10 §4.3) onto the G2 read layer
 * (GraphService + SearchProvider). All operations are org-scoped by those services (RLS),
 * so the engine only ever sees one tenant's data (AE-7/R8). This is the only seam between
 * the NestJS-free AI package and the API.
 */
@Injectable()
export class GraphRetrievalPort implements RetrievalPort {
  constructor(
    private readonly graph: GraphService,
    @Inject(SEARCH_PROVIDER) private readonly search_: SearchProvider,
  ) {}

  async search(orgId: string, q: string, limit: number): Promise<SearchHit[]> {
    const res = await this.search_.search(orgId, { q, type: "hybrid", limit });
    return res.data.map((r) => ({
      id: r.node.id,
      kind: r.node.kind,
      name: r.node.name,
      score: r.score,
    }));
  }

  async getNode(orgId: string, id: string): Promise<RetrievedNode | null> {
    try {
      const n = await this.graph.getNode(orgId, id);
      const prov = n.provenance as { source?: string; rawSnapshotRef?: string } | null;
      return {
        id: n.id,
        urn: n.urn,
        kind: n.kind,
        name: n.name,
        status: n.status,
        confidence: n.confidence,
        region: n.region,
        provenance: prov
          ? { source: prov.source ?? null, rawSnapshotRef: prov.rawSnapshotRef ?? null }
          : null,
      };
    } catch (err) {
      if (err instanceof ApiException && err.code === "not_found") return null;
      throw err;
    }
  }

  async blastRadius(orgId: string, id: string, opts: TraversalOpts): Promise<Traversal> {
    return this.graph.blastRadius(orgId, id, traversalQuery(opts));
  }
  async dependencies(orgId: string, id: string, opts: TraversalOpts): Promise<Traversal> {
    return this.graph.dependencies(orgId, id, traversalQuery(opts));
  }

  async edges(
    orgId: string,
    id: string,
    direction: "in" | "out" | "both",
  ): Promise<RetrievedEdge[]> {
    const rows = await this.graph.nodeEdges(orgId, id, { direction, limit: 100 });
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      confidence: e.confidence,
      from: { id: e.from.id, urn: e.from.urn, name: e.from.name },
      to: { id: e.to.id, urn: e.to.urn, name: e.to.name },
    }));
  }

  async timeline(
    orgId: string,
    since: string,
    kinds: string[] | null,
    limit: number,
  ): Promise<TimelineChange[]> {
    const q: { since: Date; limit: number; kinds?: string } = { since: new Date(since), limit };
    if (kinds && kinds.length > 0) q.kinds = kinds.join(",");
    const res = await this.graph.timeline(orgId, q);
    return res.data as TimelineChange[];
  }
}

function traversalQuery(opts: TraversalOpts): {
  depth: number;
  nodeBudget: number;
  minConfidence?: "observed" | "inferred-high" | "inferred-low";
} {
  const q: {
    depth: number;
    nodeBudget: number;
    minConfidence?: "observed" | "inferred-high" | "inferred-low";
  } = {
    depth: opts.depth ?? 5,
    nodeBudget: 500,
  };
  if (opts.minConfidence) q.minConfidence = opts.minConfidence;
  return q;
}
