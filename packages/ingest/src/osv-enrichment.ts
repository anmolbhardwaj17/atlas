/**
 * OSV enrichment stage (docs/plans/security-vulnerabilities.md, step 2). A post-crawl stage — NOT
 * a connector (connectors are pure/offline) and NOT an inference rule (rules are pure functions of
 * graph state, no network). Reads the org's `external.package` nodes, queries OSV.dev, and upserts
 * `security.vulnerability` nodes + observed `AFFECTS` edges (vulnerability → package). Org-scoped
 * via withOrgScope (RLS, atlas_app). Best-effort: a transient OSV outage never fails the sync.
 */
import { randomUUID } from "node:crypto";
import { withOrgScope, type Db } from "@atlas/db";
import { OsvClient, pkgKey, type OsvEcosystem, type OsvQueryPkg } from "./osv";

export interface OsvEnrichmentDeps {
  db: Db;
}

export interface OsvEnrichmentResult {
  packagesScanned: number;
  vulnerabilitiesFound: number;
  affectsEdges: number;
  /** AFFECTS edges retired this run (vuln withdrawn / package patched, no longer matched). */
  retiredAffects: number;
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
    if (rows.length === 0)
      return { packagesScanned: 0, vulnerabilitiesFound: 0, affectsEdges: 0, retiredAffects: 0 };

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
      return { packagesScanned: 0, vulnerabilitiesFound: 0, affectsEdges: 0, retiredAffects: 0 };

    const scan = await osv.scan(queries);

    // Collect the unique vulns + (vuln→package) affects first (no DB), then persist in BATCHES: one
    // vuln-node upsert, one provenance insert (client-generated UUIDs, so each edge can reference its
    // vuln's provenance without a per-row round-trip), one AFFECTS-edge upsert — instead of the old
    // ~2·(unique vulns) + (affects) serial round-trips. Each unique vuln keeps ONE provenance shared
    // by all its AFFECTS edges (unchanged), and re-seen edges keep their existing provenance on
    // conflict (also unchanged — the fresh provenance rows are the same harmless churn as before).
    const vulns = new Map<
      string,
      { urn: string; connectionId: string; name: string; attributes: string; provId: string }
    >();
    const affects: Array<{ vulnId: string; pkgNodeId: string }> = [];
    for (const pv of scan) {
      const pkg = meta.get(pkgKey(pv.pkg));
      if (!pkg) continue;
      for (const v of pv.vulnerabilities) {
        if (!vulns.has(v.id)) {
          vulns.set(v.id, {
            urn: `external:vuln:${v.id}`,
            connectionId: pkg.connectionId,
            name: v.summary ?? v.id,
            attributes: JSON.stringify({
              osvId: v.id,
              severity: v.severity,
              summary: v.summary,
              aliases: v.aliases,
              fixedVersion: v.fixedVersion,
              reference: v.reference,
              published: v.published,
            }),
            provId: randomUUID(),
          });
        }
        affects.push({ vulnId: v.id, pkgNodeId: pkg.nodeId });
      }
    }

    let affectsEdges = 0;
    const vulnList = [...vulns.values()];
    if (vulnList.length > 0) {
      // Vuln nodes → urn→id.
      const { rows: vrows } = await c.query<{ id: string; urn: string }>(
        `INSERT INTO nodes (org_id, connection_id, urn, kind, name, provider, attributes, status, confidence)
         SELECT $1, u.conn::uuid, u.urn, 'security.vulnerability', u.name, 'external', u.attrs::jsonb,
                'active', 'observed'
           FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[]) AS u(conn, urn, name, attrs)
         ON CONFLICT (org_id, urn) DO UPDATE
           SET attributes = EXCLUDED.attributes, name = EXCLUDED.name,
               status = 'active', last_seen = now(), updated_at = now()
         RETURNING id, urn`,
        [
          orgId,
          vulnList.map((v) => v.connectionId),
          vulnList.map((v) => v.urn),
          vulnList.map((v) => v.name),
          vulnList.map((v) => v.attributes),
        ],
      );
      const nodeIdByUrn = new Map(vrows.map((r) => [r.urn, r.id]));

      // One provenance per vuln (explicit ids), shared by its AFFECTS edges.
      await c.query(
        `INSERT INTO provenance (id, org_id, source, confidence)
         SELECT p, $1, s, 'observed' FROM unnest($2::uuid[], $3::text[]) AS t(p, s)`,
        [orgId, vulnList.map((v) => v.provId), [...vulns.keys()].map((id) => `osv:${id}`)],
      );

      // AFFECTS edges, deduped by (vuln-node, package) so the batch ON CONFLICT can't touch a row twice.
      const edgeByKey = new Map<string, { from: string; to: string; prov: string }>();
      for (const a of affects) {
        const v = vulns.get(a.vulnId);
        const from = v && nodeIdByUrn.get(v.urn);
        if (!from || !v) continue;
        edgeByKey.set(`${from}|${a.pkgNodeId}`, { from, to: a.pkgNodeId, prov: v.provId });
      }
      const edges = [...edgeByKey.values()];
      if (edges.length > 0) {
        await c.query(
          `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, last_seen)
           SELECT $1, f, t2, 'AFFECTS', 'observed', 'observed', pr, now()
             FROM unnest($2::uuid[], $3::uuid[], $4::uuid[]) AS x(f, t2, pr)
           ON CONFLICT ON CONSTRAINT uq_edge DO UPDATE
             SET status = 'active', last_seen = now(), updated_at = now()`,
          [orgId, edges.map((e) => e.from), edges.map((e) => e.to), edges.map((e) => e.prov)],
        );
      }
      affectsEdges = edges.length;
    }

    // Retire AFFECTS edges we no longer produced — a vuln withdrawn from OSV, or a package patched/
    // version-bumped so it no longer matches. Without this the "exposed AND vulnerable" toxic-combo
    // would keep flagging fixed packages. Within this single transaction now() is constant and equals
    // the last_seen stamped on every re-produced edge above, so `last_seen < now()` is exactly the
    // un-reproduced set — scoped to the packages we actually scanned. Convergent, mirrors
    // reconcileObservedEdges (P7).
    const scannedPkgIds = [...meta.values()].map((m) => m.nodeId);
    let retiredAffects = 0;
    if (scannedPkgIds.length > 0) {
      const res = await c.query(
        `UPDATE edges SET status = 'retired', retired_at = now(), updated_at = now()
           WHERE type = 'AFFECTS' AND status = 'active'
             AND to_node_id = ANY($1::uuid[]) AND last_seen < now()`,
        [scannedPkgIds],
      );
      retiredAffects = res.rowCount ?? 0;
    }

    return {
      packagesScanned: queries.length,
      vulnerabilitiesFound: vulns.size,
      affectsEdges,
      retiredAffects,
    };
  });
}
