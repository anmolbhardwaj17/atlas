/**
 * OSV enrichment stage (docs/plans/security-vulnerabilities.md, step 2). A post-crawl stage — NOT
 * a connector (connectors are pure/offline) and NOT an inference rule (rules are pure functions of
 * graph state, no network). Reads the org's `external.package` nodes, queries OSV.dev, and upserts
 * `security.vulnerability` nodes + observed `AFFECTS` edges (vulnerability → package). Org-scoped
 * via withOrgScope (RLS, atlas_app). Best-effort: a transient OSV outage never fails the sync.
 */
import { withOrgScope, type Db } from "@atlas/db";
import type { PoolClient } from "pg";
import {
  OsvClient,
  pkgKey,
  type OsvEcosystem,
  type OsvQueryPkg,
  type OsvVulnerability,
} from "./osv";

export interface OsvEnrichmentDeps {
  db: Db;
}

export interface OsvEnrichmentResult {
  packagesScanned: number;
  vulnerabilitiesFound: number;
  affectsEdges: number;
}

/** Manifest ecosystem (lowercase, from the parsers) → OSV ecosystem identifier. */
const ECOSYSTEM: Record<string, OsvEcosystem> = {
  npm: "npm",
  pypi: "PyPI",
  go: "Go",
  maven: "Maven",
};

/** Strip range operators to a concrete-ish version OSV can match (`^4.17.11` → `4.17.11`). */
function cleanVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /(\d+[\w.\-+]*)/.exec(v); // first version-looking token
  return m ? (m[1] as string) : null;
}

export async function runOsvEnrichment(
  deps: OsvEnrichmentDeps,
  orgId: string,
  osv: OsvClient = new OsvClient(),
): Promise<OsvEnrichmentResult> {
  return withOrgScope(deps.db, orgId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      connection_id: string;
      attributes: { ecosystem?: string; name?: string; version?: string | null };
    }>(
      `SELECT id, connection_id, attributes FROM nodes
        WHERE kind = 'external.package' AND status = 'active'`,
    );
    if (rows.length === 0) return { packagesScanned: 0, vulnerabilitiesFound: 0, affectsEdges: 0 };

    // Build OSV queries + a map back to each package's node/connection (skip unversioned or
    // unsupported ecosystems — OSV needs a concrete version).
    const queries: OsvQueryPkg[] = [];
    const meta = new Map<string, { nodeId: string; connectionId: string }>();
    for (const r of rows) {
      const ecosystem = ECOSYSTEM[(r.attributes.ecosystem ?? "").toLowerCase()];
      const name = r.attributes.name;
      const version = cleanVersion(r.attributes.version);
      if (!ecosystem || !name || !version) continue;
      const q: OsvQueryPkg = { name, version, ecosystem };
      queries.push(q);
      meta.set(pkgKey(q), { nodeId: r.id, connectionId: r.connection_id });
    }
    if (queries.length === 0)
      return { packagesScanned: 0, vulnerabilitiesFound: 0, affectsEdges: 0 };

    const scan = await osv.scan(queries);

    // Upsert each unique vulnerability node once (with one provenance row), then AFFECTS edges.
    const vulnCache = new Map<string, { nodeId: string; provId: string }>();
    let affectsEdges = 0;
    for (const pv of scan) {
      const pkg = meta.get(pkgKey(pv.pkg));
      if (!pkg) continue;
      for (const v of pv.vulnerabilities) {
        let cached = vulnCache.get(v.id);
        if (!cached) {
          const nodeId = await upsertVulnNode(c, orgId, pkg.connectionId, v);
          const provId = await insertProvenance(c, orgId, `osv:${v.id}`);
          cached = { nodeId, provId };
          vulnCache.set(v.id, cached);
        }
        await upsertAffectsEdge(c, orgId, cached.nodeId, pkg.nodeId, cached.provId);
        affectsEdges += 1;
      }
    }
    return {
      packagesScanned: queries.length,
      vulnerabilitiesFound: vulnCache.size,
      affectsEdges,
    };
  });
}

async function upsertVulnNode(
  c: PoolClient,
  orgId: string,
  connectionId: string,
  v: OsvVulnerability,
): Promise<string> {
  const attributes = {
    osvId: v.id,
    severity: v.severity,
    summary: v.summary,
    aliases: v.aliases,
    fixedVersion: v.fixedVersion,
    reference: v.reference,
    published: v.published,
  };
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO nodes (org_id, connection_id, urn, kind, name, provider, attributes, status, confidence)
     VALUES ($1, $2, $3, 'security.vulnerability', $4, 'external', $5, 'active', 'observed')
     ON CONFLICT (org_id, urn) DO UPDATE
       SET attributes = EXCLUDED.attributes, name = EXCLUDED.name,
           status = 'active', last_seen = now(), updated_at = now()
     RETURNING id`,
    [orgId, connectionId, `external:vuln:${v.id}`, v.summary ?? v.id, JSON.stringify(attributes)],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`vulnerability node upsert returned no id for ${v.id}`);
  return id;
}

async function insertProvenance(c: PoolClient, orgId: string, source: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO provenance (org_id, source, confidence) VALUES ($1, $2, 'observed') RETURNING id`,
    [orgId, source],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`provenance insert returned no id for ${source}`);
  return id;
}

async function upsertAffectsEdge(
  c: PoolClient,
  orgId: string,
  vulnNodeId: string,
  pkgNodeId: string,
  provId: string,
): Promise<void> {
  await c.query(
    `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
     VALUES ($1, $2, $3, 'AFFECTS', 'observed', 'observed', $4)
     ON CONFLICT ON CONSTRAINT uq_edge DO UPDATE
       SET status = 'active', last_seen = now(), updated_at = now()`,
    [orgId, vulnNodeId, pkgNodeId, provId],
  );
}
