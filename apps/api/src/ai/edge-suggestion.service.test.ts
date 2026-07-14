import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { EdgeSuggestionService, type GatheredContext } from "./edge-suggestion.service";
import type { EdgeSuggestion } from "@atlas/ai";

/**
 * DB behaviour of AI edge-suggestion writes (docs/05 §6, docs/10): create ai_suggested edges, skip
 * rejected pairs, dedupe against an existing active link, and — the regression guard for commit
 * 3e00426 — REVIVE a previously-retired suggestion instead of silently dropping it (the "purged
 * suggestion never came back on re-sync" reconnect bug). Env-gated on the same test DBs as the
 * GraphService suite.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

const REPO_URN = "bitbucket:acme:repository/checkout-svc";
const LAMBDA_URN = "aws:us-east-1:111122223333:lambda:checkout";

suite("EdgeSuggestionService.write", () => {
  let admin: Pool;
  let app: Pool;
  let svc: EdgeSuggestionService;
  let orgId: string;
  let repoId: string;
  let lambdaId: string;

  const insertNode = async (urn: string, kind: string, name: string): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, urn, kind, provider, name)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [orgId, urn, kind, kind.split(".")[0], name],
        )
      ).rows,
    ).id;

  /** The context write() needs: the two urn→id mappings and (optionally) a rejected pair. */
  const ctxWith = (rejected: string[] = []): GatheredContext => ({
    input: { runtimes: [], repos: [] },
    idByUrn: new Map([
      [REPO_URN, repoId],
      [LAMBDA_URN, lambdaId],
    ]),
    rejected: new Set(rejected),
    runtimesOverCap: 0,
  });

  const suggestion: EdgeSuggestion = {
    repoUrn: REPO_URN,
    runtimeUrn: LAMBDA_URN,
    confidence: "high",
    reasoning: "name match",
  };

  const edgeRow = () =>
    admin
      .query<{ origin: string; status: string; confidence: string }>(
        `SELECT origin, status, confidence FROM edges
          WHERE from_node_id = $1 AND to_node_id = $2 AND type = 'DEPLOYS_TO'`,
        [repoId, lambdaId],
      )
      .then((r) => r.rows);

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    svc = new EdgeSuggestionService(app);
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
          [`es-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    repoId = await insertNode(REPO_URN, "bitbucket.repository", "checkout-svc");
    lambdaId = await insertNode(LAMBDA_URN, "aws.lambda.function", "checkout");
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("writes a fresh ai_suggested/active DEPLOYS_TO edge", async () => {
    expect(await svc.write(orgId, [suggestion], ctxWith())).toBe(1);
    expect(await edgeRow()).toEqual([
      { origin: "ai_suggested", status: "active", confidence: "ai-suggested" },
    ]);
  });

  it("REVIVES a retired suggestion on re-run (reconnect bug — regression for 3e00426)", async () => {
    await svc.write(orgId, [suggestion], ctxWith());
    // Simulate the edge being retired (inference convergence / a soft purge left the row behind).
    await admin.query(
      `UPDATE edges SET status = 'retired', retired_at = now()
        WHERE from_node_id = $1 AND to_node_id = $2 AND type = 'DEPLOYS_TO'`,
      [repoId, lambdaId],
    );
    expect((await edgeRow())[0]?.status).toBe("retired");

    // Re-running suggestion writes must bring it back — not silently DO NOTHING on the stale row.
    expect(await svc.write(orgId, [suggestion], ctxWith())).toBe(1);
    const rows = await edgeRow();
    expect(rows).toHaveLength(1); // revived in place, not duplicated
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.origin).toBe("ai_suggested");
  });

  it("skips a pair the user rejected", async () => {
    const rejectedKey = `${repoId}→${lambdaId}→DEPLOYS_TO`;
    expect(await svc.write(orgId, [suggestion], ctxWith([rejectedKey]))).toBe(0);
    expect(await edgeRow()).toHaveLength(0);
  });

  it("skips a pair that already has an active DEPLOYS_TO edge (no duplicate)", async () => {
    const prov = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence) VALUES ($1,'edge','observed') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
       VALUES ($1,$2,$3,'DEPLOYS_TO','observed','observed',$4)`,
      [orgId, repoId, lambdaId, prov],
    );
    expect(await svc.write(orgId, [suggestion], ctxWith())).toBe(0);
    expect(await edgeRow()).toHaveLength(1); // only the pre-existing observed edge, no AI dup
  });
});
