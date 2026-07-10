import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "@atlas/db";

/**
 * org_profile + analytics_events (migration 0040, docs/04 §5.7): the onboarding profile and the
 * product-analytics stream are org-scoped (R8) and analytics_events is append-only. Verifies the
 * RLS policy hides another tenant's rows and that UPDATE/DELETE on analytics_events is refused.
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

suite("org_profile + analytics_events (0040): RLS + append-only", () => {
  let admin: Pool;
  let app: Pool;
  let orgA: string;
  let orgB: string;

  const mkOrg = async (): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`prof-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    orgA = await mkOrg();
    orgB = await mkOrg();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
    await admin.end();
    await app.end();
  });

  it("org_profile: writes and reads back within the org scope", async () => {
    await withOrgScope(app, orgA, (c) =>
      c.query(
        `INSERT INTO org_profile (org_id, role, team_size, use_cases, stack)
         VALUES ($1,'on_call_sre','20-100',$2,$3)`,
        [orgA, ["blast_radius"], ["aws", "github"]],
      ),
    );
    const rows = await withOrgScope(
      app,
      orgA,
      async (c) =>
        (
          await c.query<{ role: string; team_size: string; use_cases: string[] }>(
            `SELECT role, team_size, use_cases FROM org_profile WHERE org_id = $1`,
            [orgA],
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
    expect(one(rows).role).toBe("on_call_sre");
    expect(one(rows).use_cases).toEqual(["blast_radius"]);
  });

  it("org_profile: RLS hides another org's profile (cross-tenant → 0 rows)", async () => {
    const rows = await withOrgScope(
      app,
      orgB,
      async (c) => (await c.query(`SELECT * FROM org_profile WHERE org_id = $1`, [orgA])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("analytics_events: org-scoped and append-only (UPDATE/DELETE refused)", async () => {
    await withOrgScope(app, orgA, (c) =>
      c.query(`INSERT INTO analytics_events (org_id, event) VALUES ($1,'org.created')`, [orgA]),
    );

    const inScope = await withOrgScope(
      app,
      orgA,
      async (c) =>
        (await c.query(`SELECT event FROM analytics_events WHERE org_id = $1`, [orgA])).rows,
    );
    expect(inScope).toHaveLength(1);

    const crossTenant = await withOrgScope(
      app,
      orgB,
      async (c) => (await c.query(`SELECT * FROM analytics_events WHERE org_id = $1`, [orgA])).rows,
    );
    expect(crossTenant).toHaveLength(0);

    // atlas_app has UPDATE/DELETE revoked on analytics_events — both must be refused.
    await expect(
      withOrgScope(app, orgA, (c) =>
        c.query(`UPDATE analytics_events SET event = 'x' WHERE org_id = $1`, [orgA]),
      ),
    ).rejects.toThrow();
    await expect(
      withOrgScope(app, orgA, (c) =>
        c.query(`DELETE FROM analytics_events WHERE org_id = $1`, [orgA]),
      ),
    ).rejects.toThrow();
  });
});
