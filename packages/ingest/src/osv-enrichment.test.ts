import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runOsvEnrichment } from "./osv-enrichment";
import { pkgKey, type OsvClient, type OsvQueryPkg, type OsvVulnerability } from "./osv";

/**
 * OSV enrichment (docs/plans/security-vulnerabilities.md): upserts `security.vulnerability` nodes +
 * observed `AFFECTS` edges from a scan, idempotently, and retires edges no longer produced. Env-gated
 * (real Postgres) — skipped without TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

/** A canned OSV client: returns the vulnerabilities registered per package key. */
function mockOsv(byPkg: Map<string, OsvVulnerability[]>): OsvClient {
  return {
    scan: async (pkgs: OsvQueryPkg[]) =>
      pkgs.map((pkg) => ({ pkg, vulnerabilities: byPkg.get(pkgKey(pkg)) ?? [] })),
  } as unknown as OsvClient;
}

const vuln = (id: string, sev: OsvVulnerability["severity"] = "high"): OsvVulnerability => ({
  id,
  summary: `${id} summary`,
  severity: sev,
  aliases: [],
  fixedVersion: "9.9.9",
  reference: `https://osv.dev/${id}`,
  published: "2026-01-01T00:00:00Z",
});

suite("OSV enrichment", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const deps = () => ({ db: app });

  const insertPkg = async (name: string, version: string): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, connection_id, urn, kind, name, provider, attributes)
           VALUES ($1,$2,$3,'external.package',$4,'external',$5) RETURNING id`,
          [
            orgId,
            connId,
            `external:pkg:npm:${name}`,
            name,
            JSON.stringify({ ecosystem: "npm", name, version }),
          ],
        )
      ).rows,
    ).id;

  const countVulnNodes = async (): Promise<number> =>
    one(
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM nodes WHERE org_id = $1 AND kind = 'security.vulnerability'",
          [orgId],
        )
      ).rows,
    ).n;
  const activeAffects = async (): Promise<number> =>
    one(
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM edges WHERE org_id = $1 AND type = 'AFFECTS' AND status = 'active'",
          [orgId],
        )
      ).rows,
    ).n;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    orgId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`osv-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'github','c') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("upserts vuln nodes + AFFECTS edges, deduping a vuln shared across packages", async () => {
    const a = await insertPkg("lodash", "4.17.11");
    const b = await insertPkg("express", "4.16.0");
    void a;
    void b;
    const shared = vuln("GHSA-shared");
    const byPkg = new Map([
      [
        pkgKey({ name: "lodash", version: "4.17.11", ecosystem: "npm" }),
        [vuln("GHSA-lodash"), shared],
      ],
      [pkgKey({ name: "express", version: "4.16.0", ecosystem: "npm" }), [shared]],
    ]);

    const res = await runOsvEnrichment(deps(), orgId, mockOsv(byPkg));
    expect(res.packagesScanned).toBe(2);
    expect(res.vulnerabilitiesFound).toBe(2); // GHSA-lodash + GHSA-shared (deduped)
    expect(res.affectsEdges).toBe(3); // lodash→(GHSA-lodash, shared) + express→shared
    expect(await countVulnNodes()).toBe(2);
    expect(await activeAffects()).toBe(3);
  });

  it("is idempotent — a re-run with the same scan writes no duplicates", async () => {
    await insertPkg("lodash", "4.17.11");
    const byPkg = new Map([
      [pkgKey({ name: "lodash", version: "4.17.11", ecosystem: "npm" }), [vuln("GHSA-lodash")]],
    ]);
    await runOsvEnrichment(deps(), orgId, mockOsv(byPkg));
    const second = await runOsvEnrichment(deps(), orgId, mockOsv(byPkg));
    expect(second.vulnerabilitiesFound).toBe(1);
    expect(await countVulnNodes()).toBe(1);
    expect(await activeAffects()).toBe(1);
  });

  it("retires an AFFECTS edge when the vuln is no longer produced (package patched)", async () => {
    await insertPkg("lodash", "4.17.11");
    const key = pkgKey({ name: "lodash", version: "4.17.11", ecosystem: "npm" });
    await runOsvEnrichment(deps(), orgId, mockOsv(new Map([[key, [vuln("GHSA-lodash")]]])));
    expect(await activeAffects()).toBe(1);

    // Next run: OSV no longer reports the vuln for this package → its AFFECTS edge is retired.
    const res = await runOsvEnrichment(deps(), orgId, mockOsv(new Map([[key, []]])));
    expect(res.retiredAffects).toBe(1);
    expect(await activeAffects()).toBe(0);
  });
});
