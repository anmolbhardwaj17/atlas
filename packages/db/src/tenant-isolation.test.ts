import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "./client";

/**
 * Integration test for the RLS tenant-isolation backstop (docs/04 §10, docs/13 §6,
 * foundation of US-12). Uses two connections, mirroring production:
 *   - admin  (owner/postgres, TEST_ADMIN_DATABASE_URL): seed + teardown (bypasses RLS)
 *   - app    (atlas_app,       TEST_DATABASE_URL):       scoped reads (RLS enforced)
 * Env-gated: skipped unless BOTH are set (unit `pnpm test`/CI stay green without a DB).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected at least one row");
  return row;
}

suite("tenant isolation (RLS on memberships)", () => {
  let admin: Pool;
  let app: Pool;
  let orgA: string;
  let orgB: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });

    const newOrg = async (): Promise<string> => {
      const { rows } = await admin.query<{ id: string }>(
        "INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id",
        [`test-${randomUUID().slice(0, 8)}`, "Test Org"],
      );
      return firstRow(rows).id;
    };
    const newUser = async (): Promise<string> => {
      const { rows } = await admin.query<{ id: string }>(
        "INSERT INTO users (email) VALUES ($1) RETURNING id",
        [`${randomUUID().slice(0, 12)}@example.com`],
      );
      const id = firstRow(rows).id;
      userIds.push(id);
      return id;
    };

    orgA = await newOrg();
    orgB = await newOrg();
    const uA = await newUser();
    const uB = await newUser();
    await admin.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'Owner')", [
      orgA,
      uA,
    ]);
    await admin.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'Owner')", [
      orgB,
      uB,
    ]);
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
      if (userIds.length) await admin.query("DELETE FROM users WHERE id = ANY($1)", [userIds]);
      await admin.end();
    }
    if (app) await app.end();
  });

  it("under an org context, the app sees only that org's memberships", async () => {
    const rows = await withOrgScope(app, orgA, async (c) => {
      const r = await c.query<{ org_id: string }>("SELECT org_id FROM memberships");
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA)).toBe(true);
    expect(rows.some((r) => r.org_id === orgB)).toBe(false);
  });

  it("scopes to org B separately", async () => {
    const rows = await withOrgScope(app, orgB, async (c) => {
      const r = await c.query<{ org_id: string }>("SELECT org_id FROM memberships");
      return r.rows;
    });
    expect(rows.every((r) => r.org_id === orgB)).toBe(true);
    expect(rows.some((r) => r.org_id === orgA)).toBe(false);
  });

  it("fails closed: the app with no org context sees nothing", async () => {
    const client = await app.connect();
    try {
      const { rows } = await client.query("SELECT org_id FROM memberships");
      expect(rows.length).toBe(0);
    } finally {
      client.release();
    }
  });
});
