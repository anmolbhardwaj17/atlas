import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresSearchProvider } from "./postgres-search.provider";

/**
 * G2.4 search (docs/11): pg_trgm keyword/identifier match over `nodes`, org-scoped.
 * Env-gated on TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("G2.4 PostgresSearchProvider", () => {
  let admin: Pool;
  let app: Pool;
  let search: PostgresSearchProvider;
  let orgId: string;
  let otherOrgId: string;
  let connId: string;

  const insertNode = async (
    org: string,
    urn: string,
    kind: string,
    name: string,
    attributes: Record<string, unknown> = {},
  ): Promise<void> => {
    await admin.query(
      `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, name, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        org,
        org === orgId ? connId : null,
        urn,
        kind,
        kind.split(".")[0],
        name,
        JSON.stringify(attributes),
      ],
    );
  };

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    search = new PostgresSearchProvider(app);
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
            [`se-${randomUUID().slice(0, 8)}`],
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
    await insertNode(orgId, "aws:us-east-1:1:rds:prod-orders", "aws.rds.instance", "prod-orders", {
      engine: "postgres",
    });
    await insertNode(
      orgId,
      "aws:us-east-1:1:lambda:checkout",
      "aws.lambda.function",
      "checkout-processor",
    );
    await insertNode(
      otherOrgId,
      "aws:us-east-1:2:rds:prod-orders",
      "aws.rds.instance",
      "prod-orders",
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgId, otherOrgId],
    ]);
  });

  it("finds nodes by identifier substring + returns highlights", async () => {
    const res = await search.search(orgId, { q: "orders", type: "keyword", limit: 10 });
    expect(res.data.map((r) => r.node.name)).toContain("prod-orders");
    const hit = res.data.find((r) => r.node.name === "prod-orders");
    expect(hit?.match.semantic).toBeNull();
    expect(hit?.score).toBeGreaterThan(0);
    expect(hit?.highlights[0]).toContain("<em>orders</em>");
  });

  it("filters by kind", async () => {
    const res = await search.search(orgId, {
      q: "checkout",
      kind: "aws.lambda.function",
      type: "keyword",
      limit: 10,
    });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.node.kind).toBe("aws.lambda.function");
  });

  it("matches on attributes (engine) via keyword", async () => {
    const res = await search.search(orgId, { q: "postgres", type: "keyword", limit: 10 });
    expect(res.data.some((r) => r.node.name === "prod-orders")).toBe(true);
  });

  it("is tenant-isolated — only this org's nodes (R8/SE-4)", async () => {
    const res = await search.search(otherOrgId, { q: "checkout", type: "keyword", limit: 10 });
    expect(res.data).toHaveLength(0); // 'checkout' node belongs to orgId only
  });
});
