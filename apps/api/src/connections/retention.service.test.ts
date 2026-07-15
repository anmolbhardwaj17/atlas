import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * Retention sweep (compliance scan S2). `app_purge_expired` deletes rows past each table's window
 * across ALL orgs, so its LOGIC is proven inside a single BEGIN…ROLLBACK (nothing is committed — safe
 * against a shared DB). A second test proves the atlas_app GRANT with windows so wide nothing matches.
 * Env-gated on TEST_ADMIN_DATABASE_URL (owner) + TEST_DATABASE_URL (atlas_app).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("app_purge_expired retention sweep", () => {
  let admin: Pool;
  let app: Pool;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it("deletes rows past each window and returns the aged snapshot refs (rolled back)", async () => {
    const c = await admin.connect();
    try {
      await c.query("BEGIN");
      const orgId = one(
        (
          await c.query<{ id: string }>(
            "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
            [`ret-${randomUUID().slice(0, 8)}`],
          )
        ).rows,
      ).id;
      const connId = one(
        (
          await c.query<{ id: string }>(
            "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'aws','c') RETURNING id",
            [orgId],
          )
        ).rows,
      ).id;
      const nodeId = one(
        (
          await c.query<{ id: string }>(
            "INSERT INTO nodes (org_id, connection_id, urn, kind, provider) VALUES ($1,$2,$3,'aws.lambda.function','aws') RETURNING id",
            [orgId, connId, `aws:x:${randomUUID()}`],
          )
        ).rows,
      ).id;

      // One aged row + one recent row per table.
      await c.query(
        `INSERT INTO raw_snapshots (org_id, node_id, storage_ref, content_hash, captured_at) VALUES
           ($1,$2,'test/old','h1', now() - interval '400 days'),
           ($1,$2,'test/recent','h2', now() - interval '1 day')`,
        [orgId, nodeId],
      );
      await c.query(
        `INSERT INTO node_events (org_id, node_id, kind, occurred_at, title, source, dedupe_key) VALUES
           ($1,$2,'deploy', now() - interval '400 days','t','s','k-old'),
           ($1,$2,'deploy', now() - interval '1 day','t','s','k-new')`,
        [orgId, nodeId],
      );
      await c.query(
        `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status, finished_at) VALUES
           ($1,$2,'full','manual','succeeded', now() - interval '200 days'),
           ($1,$2,'full','manual','succeeded', now() - interval '1 day')`,
        [orgId, connId],
      );
      await c.query(
        `INSERT INTO analytics_events (org_id, event, created_at) VALUES
           ($1,'e', now() - interval '400 days'),
           ($1,'e', now() - interval '1 day')`,
        [orgId],
      );

      // Run the sweep (default windows: 30/365/90/365).
      const refs = one(
        (
          await c.query<{ snapshot_refs: string[] }>(
            "SELECT snapshot_refs FROM app_purge_expired(30,365,90,365)",
          )
        ).rows,
      ).snapshot_refs;
      expect(refs).toContain("test/old");
      expect(refs).not.toContain("test/recent");

      // Within this org, only the recent row of each table survives.
      const cnt = async (table: string, col = "org_id"): Promise<number> =>
        Number(
          one(
            (
              await c.query<{ n: string }>(
                `SELECT count(*)::text AS n FROM ${table} WHERE ${col}=$1`,
                [orgId],
              )
            ).rows,
          ).n,
        );
      expect(await cnt("raw_snapshots")).toBe(1);
      expect(await cnt("node_events")).toBe(1);
      expect(await cnt("sync_runs")).toBe(1);
      expect(await cnt("analytics_events")).toBe(1);
      const survivingSnap = one(
        (
          await c.query<{ storage_ref: string }>(
            "SELECT storage_ref FROM raw_snapshots WHERE org_id=$1",
            [orgId],
          )
        ).rows,
      ).storage_ref;
      expect(survivingSnap).toBe("test/recent");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("atlas_app may EXECUTE the sweep (no-op with impossibly wide windows)", async () => {
    // Windows this wide match nothing, so this proves the GRANT without deleting real data.
    const row = one(
      (
        await app.query<{ snapshot_refs: string[]; node_events: number }>(
          "SELECT snapshot_refs, node_events FROM app_purge_expired(36500,36500,36500,36500)",
        )
      ).rows,
    );
    expect(Array.isArray(row.snapshot_refs)).toBe(true);
    expect(Number(row.node_events)).toBe(0);
  });
});
