import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

/**
 * Systematic RLS-coverage backstop (R8 — tenant isolation is existential). The behavioural test in
 * `tenant-isolation.test.ts` proves the RLS *pattern* on one table; this proves it holds on EVERY
 * org-scoped table, so a new table shipped without `ENABLE ROW LEVEL SECURITY` + a policy — the exact
 * "cross-tenant leak by omission" failure mode — fails CI instead of silently leaking.
 *
 * An org-scoped table is any public table with an `org_id` column. Each must have RLS enabled AND at
 * least one policy (RLS enabled with no policy denies all — a different bug, also caught here as
 * "0 policies"). Reads the catalog with the admin connection; env-gated like the sibling suite.
 */
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = adminUrl ? describe : describe.skip;

suite("RLS coverage — every org-scoped table is protected (R8)", () => {
  let admin: Pool;
  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
  });
  afterAll(async () => {
    await admin.end();
  });

  it("every table with an org_id column has RLS enabled + at least one policy", async () => {
    // One catalog query (a loop of per-table round-trips to a remote DB would time out): every
    // org-scoped base table with its RLS flag + policy count.
    const rows = (
      await admin.query<{ table_name: string; rls: boolean; policies: string }>(
        `SELECT c.table_name,
                cl.relrowsecurity AS rls,
                (SELECT count(*) FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = c.table_name)::text AS policies
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           JOIN pg_class cl
             ON cl.relname = c.table_name AND cl.relnamespace = 'public'::regnamespace
          WHERE c.table_schema = 'public'
            AND c.column_name = 'org_id'
            AND t.table_type = 'BASE TABLE'
          ORDER BY c.table_name`,
      )
    ).rows;

    // Sanity: we genuinely have many org-scoped tables (guards against the query silently returning [].)
    expect(rows.length).toBeGreaterThan(20);

    const offenders = rows
      .filter((r) => !r.rls || Number(r.policies) === 0)
      .map((r) => `${r.table_name} (rls=${r.rls}, policies=${r.policies})`);

    expect(
      offenders,
      `org-scoped tables missing RLS or a policy (cross-tenant leak risk): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the restricted app role is NOLOGIN-safe: not SUPERUSER and not BYPASSRLS", async () => {
    // A superuser / bypassrls app role would silently disable every RLS policy above.
    const role = (
      await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'atlas_app'`,
      )
    ).rows[0];
    if (role) {
      // atlas_app exists in this DB — it must be neither.
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
    }
  });
});
