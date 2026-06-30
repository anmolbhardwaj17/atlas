import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "./client";

/**
 * Integration tests for the F2.3 graph schema (docs/04 §5.3–5.4, docs/05): org-scoped
 * RLS on nodes/edges + the STRUCTURAL same-org edge guarantee (composite FKs,
 * BR-EDGE-1/R8) + observed-edge dedupe (uq_edge NULLS NOT DISTINCT). Two connections:
 *   - admin (postgres / BYPASSRLS): seed + teardown + FK/constraint probes
 *   - app   (atlas_app / non-bypass): scoped reads (RLS enforced)
 * Env-gated: skipped unless BOTH TEST_DATABASE_URL and TEST_ADMIN_DATABASE_URL are set.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected at least one row");
  return row;
}

suite("F2.3 graph RLS + structural integrity", () => {
  let admin: Pool;
  let app: Pool;
  let orgA: string;
  let orgB: string;
  let nodeA1: string;
  let nodeA2: string;
  let nodeB1: string;
  const KIND = "mock.resource";

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });

    await admin.query(
      `INSERT INTO node_kinds (kind, provider, category, description)
       VALUES ($1, 'mock', 'derived', 'test kind') ON CONFLICT (kind) DO NOTHING`,
      [KIND],
    );

    const newOrg = async (): Promise<string> =>
      first(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO organizations (slug, name) VALUES ($1, 'Org') RETURNING id",
            [`gs-${randomUUID().slice(0, 8)}`],
          )
        ).rows,
      ).id;
    const newConn = async (org: string): Promise<string> =>
      first(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO connections (org_id, provider, display_name) VALUES ($1, 'aws', 'c') RETURNING id",
            [org],
          )
        ).rows,
      ).id;
    const newNode = async (org: string, conn: string, urn: string): Promise<string> =>
      first(
        (
          await admin.query<{ id: string }>(
            `INSERT INTO nodes (org_id, connection_id, urn, kind, name, provider)
             VALUES ($1, $2, $3, $4, $5, 'mock') RETURNING id`,
            [org, conn, urn, KIND, urn],
          )
        ).rows,
      ).id;

    orgA = await newOrg();
    orgB = await newOrg();
    const connA = await newConn(orgA);
    const connB = await newConn(orgB);
    nodeA1 = await newNode(orgA, connA, "urn:mock:a1");
    nodeA2 = await newNode(orgA, connA, "urn:mock:a2");
    nodeB1 = await newNode(orgB, connB, "urn:mock:b1");

    const provA = first(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source) VALUES ($1, 'test://seed') RETURNING id",
          [orgA],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
       VALUES ($1, $2, $3, 'CONNECTS_TO', 'observed', 'observed', $4)`,
      [orgA, nodeA1, nodeA2, provA],
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
      await admin.query("DELETE FROM node_kinds WHERE kind = $1", [KIND]);
      await admin.end();
    }
    if (app) await app.end();
  });

  it("nodes: the app sees only the scoped org's nodes", async () => {
    const a = await withOrgScope(
      app,
      orgA,
      async (c) => (await c.query("SELECT id FROM nodes")).rows,
    );
    expect(a.length).toBe(2);
    const b = await withOrgScope(
      app,
      orgB,
      async (c) => (await c.query("SELECT id FROM nodes")).rows,
    );
    expect(b.length).toBe(1);
  });

  it("edges: the app sees only the scoped org's edges", async () => {
    const a = await withOrgScope(
      app,
      orgA,
      async (c) => (await c.query<{ type: string }>("SELECT type FROM edges")).rows,
    );
    expect(a.map((r) => r.type)).toEqual(["CONNECTS_TO"]);
    const b = await withOrgScope(
      app,
      orgB,
      async (c) => (await c.query("SELECT id FROM edges")).rows,
    );
    expect(b.length).toBe(0);
  });

  it("cross-tenant edge is structurally impossible (composite FK, BR-EDGE-1)", async () => {
    const provA = first(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source) VALUES ($1, 'test://x') RETURNING id",
          [orgA],
        )
      ).rows,
    ).id;
    // org_id=orgA but to_node lives in orgB → fk_edge_to has no (nodeB1, orgA) match.
    await expect(
      admin.query(
        `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
         VALUES ($1, $2, $3, 'CONNECTS_TO', 'observed', 'observed', $4)`,
        [orgA, nodeA1, nodeB1, provA],
      ),
    ).rejects.toThrow();
  });

  it("observed-edge dedupe holds (uq_edge NULLS NOT DISTINCT)", async () => {
    const provA = first(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source) VALUES ($1, 'test://dup') RETURNING id",
          [orgA],
        )
      ).rows,
    ).id;
    // Same (org, from, to, type) with NULL rule as the seeded edge → must conflict.
    await expect(
      admin.query(
        `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
         VALUES ($1, $2, $3, 'CONNECTS_TO', 'observed', 'observed', $4)`,
        [orgA, nodeA1, nodeA2, provA],
      ),
    ).rejects.toThrow();
  });
});
