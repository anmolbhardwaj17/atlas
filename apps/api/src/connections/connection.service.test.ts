import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemorySecretBroker, InMemoryQueue } from "@atlas/ingest";
import { ConnectionService } from "./connection.service";
import { ConnectorRegistry } from "./connector-registry";

/**
 * F2.8 + purge-on-delete (docs/03, docs/04): disconnecting a source purges its graph data
 * (nodes/edges/provenance/snapshots/signals) + orphaned derived nodes, org-scoped, while
 * keeping the connection row (soft-deleted). Env-gated on TEST_DATABASE_URL (atlas_app) +
 * TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("F2.8 ConnectionService.disconnect purge", () => {
  let admin: Pool;
  let app: Pool;
  let svc: ConnectionService;
  let orgId: string;
  let otherOrgId: string;
  let connId: string;
  let ruleId: string;

  const mkOrg = async (): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`purge-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;

  const mkConn = async (org: string): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'aws','c') RETURNING id",
          [org],
        )
      ).rows,
    ).id;

  const mkNode = async (
    org: string,
    conn: string | null,
    urn: string,
    kind: string,
    confidence = "observed",
  ): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, confidence)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [org, conn, urn, kind, kind.split(".")[0], confidence],
        )
      ).rows,
    ).id;

  const mkProv = async (org: string, confidence: string, rule: string | null): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO provenance (org_id, source, confidence, inference_rule_id)
           VALUES ($1,'edge',$2,$3) RETURNING id`,
          [org, confidence, rule],
        )
      ).rows,
    ).id;

  const mkEdge = async (
    org: string,
    from: string,
    to: string,
    type: string,
    origin: string,
    confidence: string,
    prov: string,
    rule: string | null,
  ): Promise<void> => {
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [org, from, to, type, origin, confidence, prov, rule],
    );
  };

  const countIn = async (table: string, org: string): Promise<number> =>
    Number(
      one(
        (
          await admin.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM ${table} WHERE org_id = $1`,
            [org],
          )
        ).rows,
      ).n,
    );

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    svc = new ConnectionService(
      app,
      new InMemorySecretBroker(),
      new InMemoryQueue(),
      new ConnectorRegistry(),
    );
    ruleId = one(
      (await admin.query<{ id: string }>("SELECT id FROM inference_rules LIMIT 1")).rows,
    ).id;
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  beforeEach(async () => {
    orgId = await mkOrg();
    otherOrgId = await mkOrg();
    connId = await mkConn(orgId);

    // Observed graph for the connection: node1 -CONNECTS_TO-> node2, a signal + snapshot,
    // and a derived atlas.service node reached by an inferred IMPLEMENTS edge from node1.
    const n1 = await mkNode(
      orgId,
      connId,
      "aws:us-east-1:1:lambda/checkout",
      "aws.lambda.function",
    );
    const n2 = await mkNode(orgId, connId, "aws:us-east-1:1:rds/orders", "aws.rds.instance");
    const svcNode = await mkNode(
      orgId,
      null,
      "atlas:acme:service/checkout",
      "atlas.service",
      "inferred-high",
    );

    const pObs = await mkProv(orgId, "observed", null);
    await mkEdge(orgId, n1, n2, "CONNECTS_TO", "observed", "observed", pObs, null);
    const pInf = await mkProv(orgId, "inferred-high", ruleId);
    await mkEdge(orgId, n1, svcNode, "IMPLEMENTS", "inferred", "inferred-high", pInf, ruleId);

    await admin.query(
      `INSERT INTO signals (org_id, connection_id, subject_urn, kind, data)
       VALUES ($1,$2,$3,'github.workflow.deploy','{}'::jsonb)`,
      [orgId, connId, "aws:us-east-1:1:lambda/checkout"],
    );
    await admin.query(
      `INSERT INTO raw_snapshots (org_id, node_id, storage_ref, content_hash)
       VALUES ($1,$2,'bucket/x','h')`,
      [orgId, n1],
    );

    // Untouched other-org data.
    const oc = await mkConn(otherOrgId);
    await mkNode(otherOrgId, oc, "aws:us-east-1:2:lambda/other", "aws.lambda.function");
  });

  it("purges the source's nodes/edges/signals + orphaned derived nodes, keeps the row", async () => {
    expect(await countIn("nodes", orgId)).toBe(3); // 2 observed + 1 derived
    expect(await countIn("edges", orgId)).toBe(2);

    const dto = await svc.disconnect(orgId, connId);
    expect(dto.status).toBe("disconnected");

    // Connection row survives (soft-deleted) for history/audit.
    const conn = one(
      (
        await admin.query<{ deleted_at: Date | null }>(
          "SELECT deleted_at FROM connections WHERE id = $1",
          [connId],
        )
      ).rows,
    );
    expect(conn.deleted_at).not.toBeNull();

    // Graph data is gone: observed nodes, cascaded edges, the orphaned derived node, signals.
    expect(await countIn("nodes", orgId)).toBe(0);
    expect(await countIn("edges", orgId)).toBe(0);
    expect(await countIn("signals", orgId)).toBe(0);
    expect(await countIn("provenance", orgId)).toBe(0);
    expect(await countIn("raw_snapshots", orgId)).toBe(0);
  });

  it("is org-scoped — another org's graph is untouched", async () => {
    await svc.disconnect(orgId, connId);
    expect(await countIn("nodes", otherOrgId)).toBe(1);
  });
});
