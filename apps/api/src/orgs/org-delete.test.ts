import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "@atlas/db";

/**
 * Org hard-delete sweep (docs/12 §6.4): a single scoped `DELETE FROM organizations` cascades every
 * org-scoped table (all declare `org_id ... ON DELETE CASCADE`), including the append-only ones
 * (the FK cascade runs with owner rights, so atlas_app's revoked DELETE on audit/analytics doesn't
 * block it). Verifies the sweep is total for the deleted org and leaves another org untouched (R8).
 * Env-gated on TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("org hard-delete cascade sweep (docs/12 §6.4)", () => {
  let admin: Pool;
  let app: Pool;
  let orgA: string;
  let orgB: string;
  let userId: string;

  const CHILD_TABLES = [
    "memberships",
    "connections",
    "audit_events",
    "analytics_events",
    "org_profile",
  ];

  const countFor = async (table: string, org: string): Promise<number> =>
    Number(
      one(
        (
          await admin.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE org_id = $1`, [
            org,
          ])
        ).rows,
      ).n,
    );

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    const mkOrg = async (): Promise<string> =>
      one(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
            [`del-${randomUUID().slice(0, 8)}`],
          )
        ).rows,
      ).id;
    orgA = await mkOrg();
    orgB = await mkOrg();
    userId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO users (email, name) VALUES ($1,'U') RETURNING id",
          [`del-${randomUUID().slice(0, 8)}@example.com`],
        )
      ).rows,
    ).id;

    // Seed a child row in each table for BOTH orgs (so we can prove A is swept and B survives).
    for (const org of [orgA, orgB]) {
      await admin.query(
        "INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1,$2,'Owner','active')",
        [org, userId],
      );
      await admin.query(
        "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'aws','c')",
        [org],
      );
      await admin.query("INSERT INTO audit_events (org_id, action) VALUES ($1,'org.create')", [
        org,
      ]);
      await admin.query("INSERT INTO analytics_events (org_id, event) VALUES ($1,'org.created')", [
        org,
      ]);
      await admin.query("INSERT INTO org_profile (org_id, role) VALUES ($1,'on_call_sre')", [org]);
    }
  });

  afterAll(async () => {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
    await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    await admin.end();
    await app.end();
  });

  it("deleting an org (scoped, as the app role) cascades every org-scoped table", async () => {
    // Sanity: A is fully seeded before the delete.
    for (const t of CHILD_TABLES) expect(await countFor(t, orgA)).toBe(1);

    // Delete exactly as OrgService.deleteOrg does — scoped DELETE via the restricted app role.
    await withOrgScope(app, orgA, (c) =>
      c.query(`DELETE FROM organizations WHERE id = $1`, [orgA]),
    );

    // The org and every child row for A are gone…
    const orgGone = Number(
      one(
        (
          await admin.query<{ n: string }>("SELECT count(*) AS n FROM organizations WHERE id=$1", [
            orgA,
          ])
        ).rows,
      ).n,
    );
    expect(orgGone).toBe(0);
    for (const t of CHILD_TABLES) expect(await countFor(t, orgA)).toBe(0);

    // …while org B is completely untouched (R8).
    for (const t of CHILD_TABLES) expect(await countFor(t, orgB)).toBe(1);
  });
});
