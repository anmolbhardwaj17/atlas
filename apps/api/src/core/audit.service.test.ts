import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "@atlas/db";
import { AuditService } from "./audit.service";

/**
 * P2 audit log (docs/13 §8): append-only + org-scoped over a real Postgres.
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

suite("P2 AuditService", () => {
  let admin: Pool;
  let app: Pool;
  let audit: AuditService;
  let orgId: string;
  let otherOrgId: string;

  const mkOrg = async (): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`audit-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    audit = new AuditService(app);
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    orgId = await mkOrg();
    otherOrgId = await mkOrg();
  });

  it("records an event, org-scoped and readable back", async () => {
    await audit.record(orgId, {
      action: "demo.seed",
      targetType: "org",
      targetId: orgId,
      metadata: { nodeCount: 36 },
      requestId: "req-123",
    });

    const rows = await withOrgScope(
      app,
      orgId,
      async (c) =>
        (
          await c.query<{ action: string; request_id: string; metadata: { nodeCount: number } }>(
            "SELECT action, request_id, metadata FROM audit_events WHERE org_id = $1",
            [orgId],
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("demo.seed");
    expect(rows[0]?.request_id).toBe("req-123");
    expect(rows[0]?.metadata.nodeCount).toBe(36);
  });

  it("is tenant-isolated (another org can't see it)", async () => {
    await audit.record(orgId, { action: "connection.verify", targetId: "c1" });

    const visibleToOther = await withOrgScope(
      app,
      otherOrgId,
      async (c) => (await c.query("SELECT id FROM audit_events WHERE org_id = $1", [orgId])).rows,
    );
    expect(visibleToOther).toHaveLength(0);
  });

  it("is append-only: atlas_app cannot UPDATE or DELETE", async () => {
    await audit.record(orgId, { action: "member.role_change", targetId: "u1" });

    await expect(
      withOrgScope(app, orgId, (c) =>
        c.query("UPDATE audit_events SET action = 'tampered' WHERE org_id = $1", [orgId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withOrgScope(app, orgId, (c) =>
        c.query("DELETE FROM audit_events WHERE org_id = $1", [orgId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("best-effort: a bad-org write is swallowed (never throws to the caller)", async () => {
    // A non-existent org violates the FK; record() must not throw (auditing can't break ops).
    await expect(audit.record(randomUUID(), { action: "org.create" })).resolves.toBeUndefined();
  });
});
