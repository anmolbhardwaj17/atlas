import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "./client";

/**
 * Integration tests for the F1.6 org-scoped RLS surfaces (docs/04 §10, docs/12 §4–6,
 * US-12). Same two-connection model as tenant-isolation.test.ts:
 *   - admin (postgres / BYPASSRLS): seed + teardown
 *   - app   (atlas_app / non-bypass): scoped access (RLS enforced)
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
const hash = (t: string): string => createHash("sha256").update(t).digest("hex");

suite("F1.6 org-scoped RLS + resolvers", () => {
  let admin: Pool;
  let app: Pool;
  let orgA: string;
  let orgB: string;
  let userA: string;
  let tokenA: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });

    const newOrg = async (): Promise<string> =>
      first(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id",
            [`os-${randomUUID().slice(0, 8)}`, "Org"],
          )
        ).rows,
      ).id;

    orgA = await newOrg();
    orgB = await newOrg();
    userA = first(
      (
        await admin.query<{ id: string }>("INSERT INTO users (email) VALUES ($1) RETURNING id", [
          `${randomUUID().slice(0, 12)}@example.com`,
        ])
      ).rows,
    ).id;
    await admin.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'Owner')", [
      orgA,
      userA,
    ]);

    tokenA = randomUUID();
    await admin.query(
      `INSERT INTO invitations (org_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, 'Member', $3, now() + interval '7 days')`,
      [orgA, "invitee@example.com", hash(tokenA)],
    );
    await admin.query(
      `INSERT INTO invitations (org_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, 'Member', $3, now() + interval '7 days')`,
      [orgB, "other@example.com", hash(randomUUID())],
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
      await admin.query("DELETE FROM users WHERE id = $1", [userA]);
      await admin.end();
    }
    if (app) await app.end();
  });

  it("organizations: the app sees only the scoped org", async () => {
    const rows = await withOrgScope(
      app,
      orgA,
      async (c) => (await c.query<{ id: string }>("SELECT id FROM organizations")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([orgA]);
  });

  it("organizations: no scope → sees nothing (fail closed)", async () => {
    const client = await app.connect();
    try {
      const { rows } = await client.query("SELECT id FROM organizations");
      expect(rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  it("invitations: the app sees only the scoped org's invitations", async () => {
    const rows = await withOrgScope(
      app,
      orgA,
      async (c) => (await c.query<{ org_id: string }>("SELECT org_id FROM invitations")).rows,
    );
    expect(rows.length).toBe(1);
    expect(first(rows).org_id).toBe(orgA);
  });

  it("app_user_memberships resolves a user's orgs across tenants (SECURITY DEFINER)", async () => {
    const { rows } = await app.query<{ org_id: string; role: string }>(
      "SELECT org_id, role FROM app_user_memberships($1)",
      [userA],
    );
    expect(rows.length).toBe(1);
    expect(first(rows)).toMatchObject({ org_id: orgA, role: "Owner" });
  });

  it("app_invitation_by_token resolves by token hash, empty for unknown", async () => {
    const hit = await app.query("SELECT org_id FROM app_invitation_by_token($1)", [hash(tokenA)]);
    expect(hit.rows.length).toBe(1);
    const miss = await app.query("SELECT org_id FROM app_invitation_by_token($1)", [hash("nope")]);
    expect(miss.rows.length).toBe(0);
  });

  it("write guard: cannot insert a row for another org while scoped (WITH CHECK)", async () => {
    await expect(
      withOrgScope(app, orgA, async (c) => {
        await c.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'Member')", [
          orgB,
          userA,
        ]);
      }),
    ).rejects.toThrow();
  });
});
