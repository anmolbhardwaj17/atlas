import { Inject, Injectable } from "@nestjs/common";
import type {
  EstateOverview,
  NodeEventFact,
  PrDiff,
  RetrievalPort,
  RetrievedEdge,
  RetrievedNode,
  SearchHit,
  TimelineChange,
  Traversal,
  TraversalOpts,
} from "@atlas/ai";
import { withOrgScope, type Db } from "@atlas/db";
import { FetchBitbucketClient } from "@atlas/connector-bitbucket";
import type { SecretBroker } from "@atlas/ingest";
import { ApiException } from "../common/errors";
import { PG_POOL } from "../core/tokens";
import { SECRET_BROKER } from "../connections/tokens";
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
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
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
        health: healthOf(n.attributes as Record<string, unknown> | undefined),
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

  /**
   * Whole-org aggregate snapshot for estate/aggregate questions (P0 estate slice). Reuses the
   * dashboard summary aggregation so Ask AI and the dashboard report identical figures — the AI
   * never recomputes counts a different way (single source of truth). Org-scoped by GraphService.
   */
  /** Change timeline for one node (Phase C; includes derived PR merges for repos). */
  async nodeEvents(orgId: string, nodeId: string, limit: number): Promise<NodeEventFact[]> {
    try {
      const events = await this.graph.nodeEvents(orgId, nodeId, {
        limit: Math.min(Math.max(limit, 1), 50),
      });
      return events.map((e) => ({
        id: e.id,
        kind: e.kind,
        occurredAt: e.occurredAt,
        actor: e.actor,
        title: e.title,
        source: e.source,
      }));
    } catch (err) {
      if (err instanceof ApiException && err.code === "not_found") return [];
      throw err;
    }
  }

  /**
   * On-demand PR diff (Phase D incident tracing). Resolves the PR node's workspace/repo/id
   * from its URN (`bitbucket:<ws>:pullrequest/<repo>/<id>`), authenticates with the org's
   * OWN Bitbucket connection through the Secrets Broker (org-scoped, R8), and fetches the
   * raw diff read-only. Anything unresolvable → null - the tool reports it honestly.
   */
  async prDiff(orgId: string, prNodeId: string, maxChars: number): Promise<PrDiff | null> {
    let urn: string;
    try {
      urn = (await this.graph.getNode(orgId, prNodeId)).urn;
    } catch {
      return null;
    }
    const m = /^bitbucket:([^:]+):pullrequest\/([^/]+)\/(\d+)$/.exec(urn);
    if (!m) return null;
    const [, workspace, repoSlug, prId] = m as unknown as [string, string, string, string];

    const conn = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ secret_ref: string | null }>(
        `SELECT secret_ref FROM connections
          WHERE provider = 'bitbucket' AND deleted_at IS NULL AND secret_ref IS NOT NULL
          ORDER BY created_at LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    if (!conn?.secret_ref) return null;
    const creds = await this.secrets.get(conn.secret_ref);
    if (!creds.email || !creds.apiToken) return null;

    const client = new FetchBitbucketClient({ email: creds.email, apiToken: creds.apiToken });
    const text = await client.diff(workspace, repoSlug, prId);
    if (text == null) return null;
    const max = Math.min(Math.max(maxChars, 1_000), 20_000);
    return text.length > max
      ? { text: text.slice(0, max), truncated: true }
      : { text, truncated: false };
  }

  async estateOverview(orgId: string): Promise<EstateOverview> {
    const [s, infrastructure] = await Promise.all([
      this.graph.summary(orgId),
      this.graph.infrastructureBreakdown(orgId),
    ]);
    return {
      inventory: {
        resources: s.inventory.resources,
        relationships: s.inventory.relationships,
        services: s.inventory.services,
        datastores: s.inventory.datastores,
        environments: s.inventory.environments,
        clouds: s.inventory.clouds,
        accounts: s.inventory.accounts,
        repositories: s.inventory.repositories,
        projects: s.inventory.projects,
        pipelines: s.inventory.pipelines,
        contributors: s.inventory.contributors,
        pullRequests: s.inventory.pullRequests,
      },
      crossBoundary: {
        crossCloud: s.crossBoundary.crossCloud,
        crossAccount: s.crossBoundary.crossAccount,
      },
      topContributors: s.insights.topContributors.map((c) => ({ name: c.name, count: c.count })),
      mostActiveRepos: s.insights.mostActiveRepos.map((r) => ({ name: r.name, count: r.count })),
      pipelineCoverage: {
        withPipeline: s.insights.pipelineCoverage.withPipeline,
        total: s.insights.pipelineCoverage.total,
      },
      infrastructure,
      findings: s.findings.map((f) => ({
        title: f.title,
        severity: f.severity,
        category: f.category,
        ...(f.count !== undefined ? { count: f.count } : {}),
      })),
      sources: {
        total: s.trust.sources,
        healthy: s.trust.healthySources,
        lastSyncAt: s.trust.lastSyncAt,
      },
    };
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

/** Extract the Phase-B health annotation for citations (unknown → null, never faked). */
function healthOf(
  attributes: Record<string, unknown> | undefined,
): { state: string; reason: string | null } | null {
  const h = attributes?.["health"] as { state?: unknown; reason?: unknown } | undefined;
  if (!h || typeof h.state !== "string") return null;
  return { state: h.state, reason: typeof h.reason === "string" ? h.reason : null };
}
