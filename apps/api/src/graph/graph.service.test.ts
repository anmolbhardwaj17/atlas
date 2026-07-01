import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GraphService } from "./graph.service";
import { ApiException } from "../common/errors";

/**
 * G2.1 read API (docs/08 §9): node list/detail/edges/neighbors over a real Postgres,
 * org-scoped (RLS). Env-gated on TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

const LAMBDA = "aws:us-east-1:111122223333:lambda:checkout";
const RDS = "aws:us-east-1:111122223333:rds:prod-orders";

suite("G2.1 GraphService", () => {
  let admin: Pool;
  let app: Pool;
  let graph: GraphService;
  let orgId: string;
  let otherOrgId: string;
  let connId: string;
  let lambdaId: string;
  let rdsId: string;

  const insertNode = async (
    org: string,
    conn: string | null,
    urn: string,
    kind: string,
    region: string | null,
    name: string,
  ): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, region, name)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [org, conn, urn, kind, kind.split(".")[0], region, name],
        )
      ).rows,
    ).id;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    graph = new GraphService(app);
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    const mkOrg = async (): Promise<string> =>
      one(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
            [`g2-${randomUUID().slice(0, 8)}`],
          )
        ).rows,
      ).id;
    orgId = await mkOrg();
    otherOrgId = await mkOrg();
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'aws','c') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    lambdaId = await insertNode(
      orgId,
      connId,
      LAMBDA,
      "aws.lambda.function",
      "us-east-1",
      "checkout",
    );
    rdsId = await insertNode(orgId, connId, RDS, "aws.rds.instance", "us-east-1", "prod-orders");
    // CONNECTS_TO(lambda→rds) with provenance; + a raw snapshot/provenance for the lambda.
    const provEdge = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence) VALUES ($1,'edge','observed') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
       VALUES ($1,$2,$3,'CONNECTS_TO','observed','observed',$4)`,
      [orgId, lambdaId, rdsId, provEdge],
    );
    const snap = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO raw_snapshots (org_id, node_id, storage_ref, content_hash) VALUES ($1,$2,'bucket/x.json','h') RETURNING id",
          [orgId, lambdaId],
        )
      ).rows,
    ).id;
    await admin.query(
      "INSERT INTO provenance (org_id, source, confidence, raw_snapshot_id) VALUES ($1,'lambda:GetFunctionConfiguration','observed',$2)",
      [orgId, snap],
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgId, otherOrgId],
    ]);
  });

  it("lists nodes, filters by kind, and paginates by keyset cursor", async () => {
    const all = await graph.listNodes(orgId, { limit: 50 });
    expect(all.data.map((n) => n.urn).sort()).toEqual([LAMBDA, RDS].sort());

    const lambdas = await graph.listNodes(orgId, { limit: 50, kind: "aws.lambda.function" });
    expect(lambdas.data.map((n) => n.urn)).toEqual([LAMBDA]);

    const page1 = await graph.listNodes(orgId, { limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.page.hasMore).toBe(true);
    expect(page1.page.nextCursor).toBeTruthy();
    const page2 = await graph.listNodes(orgId, {
      limit: 1,
      cursor: page1.page.nextCursor as string,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
    expect(page2.page.hasMore).toBe(false);
  });

  it("returns node detail with provenance (raw-snapshot click-through, P4)", async () => {
    const node = await graph.getNode(orgId, lambdaId);
    expect(node.urn).toBe(LAMBDA);
    expect(node.provenance).toMatchObject({
      source: "lambda:GetFunctionConfiguration",
      rawSnapshotRef: "bucket/x.json",
    });
  });

  it("404s on missing or malformed ids", async () => {
    await expect(graph.getNode(orgId, randomUUID())).rejects.toBeInstanceOf(ApiException);
    await expect(graph.getNode(orgId, "not-a-uuid")).rejects.toBeInstanceOf(ApiException);
  });

  it("returns direction-filtered edges", async () => {
    const out = await graph.nodeEdges(orgId, lambdaId, { direction: "out", limit: 100 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "CONNECTS_TO", to: { urn: RDS } });
    expect(await graph.nodeEdges(orgId, lambdaId, { direction: "in", limit: 100 })).toHaveLength(0);
    const rdsIn = await graph.nodeEdges(orgId, rdsId, { direction: "in", limit: 100 });
    expect(rdsIn[0]).toMatchObject({ from: { urn: LAMBDA } });
  });

  it("returns a depth-1 neighbor subgraph", async () => {
    const sub = await graph.nodeNeighbors(orgId, lambdaId, { nodeBudget: 100 });
    expect(sub.nodes.map((n) => n.urn).sort()).toEqual([LAMBDA, RDS].sort());
    expect(sub.edges).toHaveLength(1);
  });

  it("is tenant-isolated — another org sees nothing (R8)", async () => {
    expect((await graph.listNodes(otherOrgId, { limit: 50 })).data).toHaveLength(0);
    await expect(graph.getNode(otherOrgId, lambdaId)).rejects.toBeInstanceOf(ApiException);
  });
});
