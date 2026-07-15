import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemorySnapshotStore } from "@atlas/ingest";
import { OrgService } from "./org.service";
import type { UserMirrorService } from "../auth/user-mirror.service";
import type { OrgLogoService } from "./org-logo.service";

/**
 * Personal-data export (GDPR right of access). personalDataExport only reads the DB, so the user /
 * logo deps are stubbed. Env-gated on TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("OrgService.personalDataExport (DSAR)", () => {
  let admin: Pool;
  let app: Pool;
  let svc: OrgService;
  let orgId: string;
  let otherOrgId: string;
  let userId: string;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    svc = new OrgService(
      app,
      new InMemorySnapshotStore(),
      {} as UserMirrorService,
      {} as OrgLogoService,
    );
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
            "INSERT INTO organizations (slug, name) VALUES ($1,'Acme') RETURNING id",
            [`dsar-${randomUUID().slice(0, 8)}`],
          )
        ).rows,
      ).id;
    orgId = await mkOrg();
    otherOrgId = await mkOrg();
    userId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO users (email, name) VALUES ($1,'Ada Lovelace') RETURNING id",
          [`dsar-${randomUUID().slice(0, 8)}@example.com`],
        )
      ).rows,
    ).id;
    await admin.query(
      "INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1,$2,'Admin','active')",
      [orgId, userId],
    );
    // A person identity node (as a connector would ingest it) + a non-person node (must be excluded).
    await admin.query(
      `INSERT INTO nodes (org_id, urn, kind, provider, name, attributes) VALUES
         ($1,$2,'github.user','github','grace', $3),
         ($1,$4,'aws.lambda.function','aws','checkout','{}'::jsonb)`,
      [
        orgId,
        `github:user:grace-${randomUUID().slice(0, 6)}`,
        JSON.stringify({ login: "ghopper", displayName: "Grace Hopper", email: "grace@navy.mil" }),
        `aws:x:${randomUUID()}`,
      ],
    );
    // Another org's person node — must NOT appear in this org's export (R8).
    await admin.query(
      `INSERT INTO nodes (org_id, urn, kind, provider, name, attributes) VALUES ($1,$2,'github.user','github','other','{}'::jsonb)`,
      [otherOrgId, `github:user:other-${randomUUID().slice(0, 6)}`],
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgId, otherOrgId],
    ]);
    await admin.query("DELETE FROM users WHERE id = $1", [userId]);
  });

  it("exports members + person/identity nodes, excluding non-people and other orgs", async () => {
    const out = await svc.personalDataExport(orgId);
    expect(out.org.name).toBe("Acme");

    // Member identity we store directly.
    expect(out.members).toHaveLength(1);
    expect(out.members[0]).toMatchObject({ name: "Ada Lovelace", role: "Admin", status: "active" });
    expect(out.members[0]?.email).toContain("@example.com");

    // The ingested person node, with its identity attributes surfaced.
    expect(out.identities).toHaveLength(1); // the lambda (non-person) is excluded
    expect(out.identities[0]).toMatchObject({
      kind: "github.user",
      login: "ghopper",
      displayName: "Grace Hopper",
      email: "grace@navy.mil",
    });
    expect(out.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is org-scoped — another org's people are never included (R8)", async () => {
    const out = await svc.personalDataExport(otherOrgId);
    // otherOrg has the identity node but no members seeded.
    expect(out.members).toHaveLength(0);
    expect(out.identities.every((i) => i.kind === "github.user")).toBe(true);
  });
});
