import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GraphService } from "./graph.service";
import { ApiException } from "../common/errors";

/**
 * Per-person erasure (GDPR Art. 17): redact the identity node + scrub the person's name from
 * author/assignee/reporter attributes, durably (re-applied after each sync). Env-gated on
 * TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("GraphService person erasure", () => {
  let admin: Pool;
  let app: Pool;
  let graph: GraphService;
  let orgId: string;
  let personId: string;
  let prId: string;

  const insertNode = async (
    urn: string,
    kind: string,
    name: string,
    attributes: Record<string, unknown>,
  ): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, urn, kind, provider, name, attributes)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [orgId, urn, kind, kind.split(".")[0], name, JSON.stringify(attributes)],
        )
      ).rows,
    ).id;

  const nodeById = async (id: string) =>
    one(
      (
        await admin.query<{ name: string | null; attributes: Record<string, unknown> }>(
          "SELECT name, attributes FROM nodes WHERE id = $1",
          [id],
        )
      ).rows,
    );

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    graph = new GraphService(app);
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    orgId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`erase-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    personId = await insertNode(
      `github:user:grace-${randomUUID().slice(0, 6)}`,
      "github.user",
      "Grace Hopper",
      {
        login: "ghopper",
        email: "grace@navy.mil",
      },
    );
    prId = await insertNode(
      `github:acme/x:pr:1-${randomUUID().slice(0, 6)}`,
      "github.pull_request",
      "#1 — fix",
      {
        author: "Grace Hopper",
        state: "OPEN",
      },
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("redacts the identity node + scrubs the author name, and records the erasure", async () => {
    const res = await graph.erasePerson(orgId, personId, null);
    expect(res.redactedNodes).toBe(1);

    const person = await nodeById(personId);
    expect(person.name).toBe("[erased]");
    expect(person.attributes).not.toHaveProperty("login");
    expect(person.attributes).not.toHaveProperty("email");

    const pr = await nodeById(prId);
    expect(pr.attributes.author).toBe("[erased]"); // author name scrubbed
    expect(pr.attributes.state).toBe("OPEN"); // non-identity attrs untouched

    const rec = await admin.query("SELECT display_names FROM erased_identities WHERE org_id=$1", [
      orgId,
    ]);
    expect(rec.rowCount).toBe(1);
  });

  it("re-applies the erasure after a re-sync re-ingests the name (durable)", async () => {
    await graph.erasePerson(orgId, personId, null);
    // Simulate a re-crawl overwriting the redaction with the real name again.
    await admin.query("UPDATE nodes SET name='Grace Hopper', attributes=$2 WHERE id=$1", [
      personId,
      JSON.stringify({ login: "ghopper", email: "grace@navy.mil" }),
    ]);
    await admin.query(
      `UPDATE nodes SET attributes = jsonb_set(attributes,'{author}','"Grace Hopper"') WHERE id=$1`,
      [prId],
    );

    const n = await graph.reapplyErasures(orgId);
    expect(n).toBe(1);
    expect((await nodeById(personId)).name).toBe("[erased]");
    expect((await nodeById(prId)).attributes.author).toBe("[erased]");
  });

  it("refuses to erase a non-person node", async () => {
    const lambdaId = await insertNode(
      `aws:x:${randomUUID()}`,
      "aws.lambda.function",
      "checkout",
      {},
    );
    await expect(graph.erasePerson(orgId, lambdaId, null)).rejects.toBeInstanceOf(ApiException);
  });

  it("404s on an unknown node", async () => {
    await expect(graph.erasePerson(orgId, randomUUID(), null)).rejects.toBeInstanceOf(ApiException);
  });
});
