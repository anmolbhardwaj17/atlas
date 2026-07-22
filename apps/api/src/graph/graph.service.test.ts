import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GraphService } from "./graph.service";
import { ApiException } from "../common/errors";

/**
 * G2.1 read API (docs/08 §9): node list/detail/edges/neighbors over a real Postgres,
 * org-scoped (RLS). Env-gated on TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

const LAMBDA = "aws:us-east-1:111122223333:lambda:checkout";
const RDS = "aws:us-east-1:111122223333:rds:prod-orders";

suite("G2.1 GraphService", () => {
  let admin: Pool;
  let app: Pool;
  let graph: GraphService;
  let orgId: string;
  let otherOrgId: string;
  let connId: string;
  let lambdaId: string;
  let rdsId: string;

  const insertNode = async (
    org: string,
    conn: string | null,
    urn: string,
    kind: string,
    region: string | null,
    name: string,
  ): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, region, name)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [org, conn, urn, kind, kind.split(".")[0], region, name],
        )
      ).rows,
    ).id;

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
    const mkOrg = async (): Promise<string> =>
      one(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
            [`g2-${randomUUID().slice(0, 8)}`],
          )
        ).rows,
      ).id;
    orgId = await mkOrg();
    otherOrgId = await mkOrg();
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'aws','c') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    lambdaId = await insertNode(
      orgId,
      connId,
      LAMBDA,
      "aws.lambda.function",
      "us-east-1",
      "checkout",
    );
    rdsId = await insertNode(orgId, connId, RDS, "aws.rds.instance", "us-east-1", "prod-orders");
    // CONNECTS_TO(lambda→rds) with provenance; + a raw snapshot/provenance for the lambda.
    const provEdge = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence) VALUES ($1,'edge','observed') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
       VALUES ($1,$2,$3,'CONNECTS_TO','observed','observed',$4)`,
      [orgId, lambdaId, rdsId, provEdge],
    );
    const snap = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO raw_snapshots (org_id, node_id, storage_ref, content_hash) VALUES ($1,$2,'bucket/x.json','h') RETURNING id",
          [orgId, lambdaId],
        )
      ).rows,
    ).id;
    await admin.query(
      "INSERT INTO provenance (org_id, source, confidence, raw_snapshot_id) VALUES ($1,'lambda:GetFunctionConfiguration','observed',$2)",
      [orgId, snap],
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgId, otherOrgId],
    ]);
  });

  it("lists nodes, filters by kind, and paginates by keyset cursor", async () => {
    const all = await graph.listNodes(orgId, { limit: 50 });
    expect(all.data.map((n) => n.urn).sort()).toEqual([LAMBDA, RDS].sort());

    const lambdas = await graph.listNodes(orgId, { limit: 50, kind: "aws.lambda.function" });
    expect(lambdas.data.map((n) => n.urn)).toEqual([LAMBDA]);

    const page1 = await graph.listNodes(orgId, { limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.page.hasMore).toBe(true);
    expect(page1.page.nextCursor).toBeTruthy();
    const page2 = await graph.listNodes(orgId, {
      limit: 1,
      cursor: page1.page.nextCursor as string,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
    expect(page2.page.hasMore).toBe(false);
  });

  it("returns node detail with provenance (raw-snapshot click-through, P4)", async () => {
    const node = await graph.getNode(orgId, lambdaId);
    expect(node.urn).toBe(LAMBDA);
    expect(node.provenance).toMatchObject({
      source: "lambda:GetFunctionConfiguration",
      rawSnapshotRef: "bucket/x.json",
    });
  });

  it("404s on missing or malformed ids", async () => {
    await expect(graph.getNode(orgId, randomUUID())).rejects.toBeInstanceOf(ApiException);
    await expect(graph.getNode(orgId, "not-a-uuid")).rejects.toBeInstanceOf(ApiException);
  });

  it("returns direction-filtered edges", async () => {
    const out = await graph.nodeEdges(orgId, lambdaId, { direction: "out", limit: 100 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "CONNECTS_TO", to: { urn: RDS } });
    expect(await graph.nodeEdges(orgId, lambdaId, { direction: "in", limit: 100 })).toHaveLength(0);
    const rdsIn = await graph.nodeEdges(orgId, rdsId, { direction: "in", limit: 100 });
    expect(rdsIn[0]).toMatchObject({ from: { urn: LAMBDA } });
  });

  it("returns a depth-1 neighbor subgraph", async () => {
    const sub = await graph.nodeNeighbors(orgId, lambdaId, { nodeBudget: 100 });
    expect(sub.nodes.map((n) => n.urn).sort()).toEqual([LAMBDA, RDS].sort());
    expect(sub.edges).toHaveLength(1);
  });

  it("is tenant-isolated - another org sees nothing (R8)", async () => {
    expect((await graph.listNodes(otherOrgId, { limit: 50 })).data).toHaveLength(0);
    await expect(graph.getNode(otherOrgId, lambdaId)).rejects.toBeInstanceOf(ApiException);
  });

  it("blast-radius + dependencies with why-chains, pathConfidence, minConfidence", async () => {
    // Add repo -DEPLOYS_TO(inferred-high)-> lambda, forming repo → lambda → rds.
    const REPO = "github:acme/orders-svc";
    const repoId = await insertNode(orgId, connId, REPO, "github.repository", null, "orders-svc");
    const ruleId = one(
      (
        await admin.query<{ id: string }>(
          "SELECT id FROM inference_rules WHERE key='repo_deploys_to_runtime' AND version=1",
        )
      ).rows,
    ).id;
    const prov = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence, inference_rule_id) VALUES ($1,'rule:repo_deploys_to_runtime','inferred-high',$2) RETURNING id",
          [orgId, ruleId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id)
       VALUES ($1,$2,$3,'DEPLOYS_TO','inferred','inferred-high',$4,$5)`,
      [orgId, repoId, lambdaId, prov, ruleId],
    );

    // Blast-radius on rds (inbound): lambda@1 (observed edge), repo@2 (weakest = high).
    const blast = await graph.blastRadius(orgId, rdsId, { depth: 5, nodeBudget: 500 });
    const byUrn = new Map(blast.impacted.map((i) => [i.node.urn, i]));
    expect(byUrn.get(LAMBDA)?.distance).toBe(1);
    expect(byUrn.get(LAMBDA)?.pathConfidence).toBe("observed");
    expect(byUrn.get(LAMBDA)?.via[0]).toMatchObject({ type: "CONNECTS_TO" });
    expect(byUrn.get(REPO)?.distance).toBe(2);
    expect(byUrn.get(REPO)?.pathConfidence).toBe("inferred-high"); // weakest edge on the path

    // minConfidence=observed excludes the inferred DEPLOYS_TO → repo unreachable (P3 view).
    const highOnly = await graph.blastRadius(orgId, rdsId, {
      depth: 5,
      nodeBudget: 500,
      minConfidence: "observed",
    });
    expect(highOnly.impacted.map((i) => i.node.urn)).toEqual([LAMBDA]);

    // Dependencies on repo (outbound): lambda@1, rds@2.
    const deps = await graph.dependencies(orgId, repoId, { depth: 5, nodeBudget: 500 });
    expect(deps.impacted.map((i) => i.node.urn).sort()).toEqual([LAMBDA, RDS].sort());

    // Over-limit depth is clamped with a warning (A21).
    const clamped = await graph.blastRadius(orgId, rdsId, { depth: 50, nodeBudget: 500 });
    expect(clamped.depthUsed).toBe(6);
    expect(clamped.warnings.some((w) => /depth clamped/.test(w))).toBe(true);
  });

  it("nodeEvents unifies a service's own events with the deploying repo's PR merges (cited), and filters by kind", async () => {
    // repo --DEPLOYS_TO--> lambda, and the repo CONTAINS a merged PR.
    const REPO = "github:acme/checkout-svc";
    const repoId = await insertNode(orgId, connId, REPO, "github.repository", null, "checkout-svc");
    const ruleId = one(
      (
        await admin.query<{ id: string }>(
          "SELECT id FROM inference_rules WHERE key='repo_deploys_to_runtime' AND version=1",
        )
      ).rows,
    ).id;
    const prov = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence, inference_rule_id) VALUES ($1,'rule:repo_deploys_to_runtime','inferred-high',$2) RETURNING id",
          [orgId, ruleId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id)
       VALUES ($1,$2,$3,'DEPLOYS_TO','inferred','inferred-high',$4,$5)`,
      [orgId, repoId, lambdaId, prov, ruleId],
    );
    const prId = await insertNode(
      orgId,
      connId,
      "github:acme/checkout-svc/pr/42",
      "github.pull_request",
      null,
      "Fix connection pool leak",
    );
    await admin.query(
      "UPDATE nodes SET attributes = jsonb_build_object('state','MERGED','updatedOn','2026-07-19T13:50:00Z') WHERE id=$1",
      [prId],
    );
    const containsProv = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence) VALUES ($1,'edge','observed') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id)
       VALUES ($1,$2,$3,'CONTAINS','observed','observed',$4)`,
      [orgId, repoId, prId, containsProv],
    );
    // A persisted deploy + health transition on the lambda itself.
    await admin.query(
      `INSERT INTO node_events (org_id, node_id, kind, occurred_at, actor, title, source, dedupe_key)
       VALUES ($1,$2,'deploy','2026-07-19T13:58:00Z',null,'Deployed checkout','aws-lambda',$3),
              ($1,$2,'health_transition','2026-07-19T14:05:00Z',null,'checkout → unhealthy','health-poll',$4)`,
      [orgId, lambdaId, `deploy:${LAMBDA}:1`, `health:${LAMBDA}:1`],
    );

    // The lambda's timeline now tells the whole story: PR merged (via the deploying repo) →
    // deployed → alarm — even though the PR lives on the repo node.
    const events = await graph.nodeEvents(orgId, lambdaId);
    const byKind = new Map(events.map((e) => [e.kind, e]));
    expect(events.map((e) => e.kind)).toEqual(["health_transition", "deploy", "pr_merged"]); // newest-first
    const pr = byKind.get("pr_merged");
    expect(pr?.title).toContain("in checkout-svc");
    expect(pr?.evidence).toMatchObject({ prNodeId: prId, viaRepoId: repoId, via: "DEPLOYS_TO" });

    // On the repo node itself the same PR shows without the cross-node "via" citation.
    const repoEvents = await graph.nodeEvents(orgId, repoId);
    const repoPr = repoEvents.find((e) => e.kind === "pr_merged");
    expect(repoPr?.evidence).toEqual({ prNodeId: prId });
    expect(repoPr?.title).not.toContain(" in ");

    // kind filter drops the persisted kinds and keeps only the derived PR merges.
    const onlyPrs = await graph.nodeEvents(orgId, lambdaId, { kinds: ["pr_merged"] });
    expect(onlyPrs.map((e) => e.kind)).toEqual(["pr_merged"]);

    // R8: another org sees nothing (and 404s on the node).
    await expect(graph.nodeEvents(otherOrgId, lambdaId)).rejects.toBeInstanceOf(ApiException);
  });

  it("summary() flags a publicly-accessible RDS (Phase E rds-public posture finding)", async () => {
    const dbId = await insertNode(
      orgId,
      connId,
      "aws:us-east-1:1:rds:orders-prod",
      "aws.rds.instance",
      "us-east-1",
      "orders-prod",
    );
    await admin.query(
      "UPDATE nodes SET attributes = jsonb_build_object('publiclyAccessible', true) WHERE id=$1",
      [dbId],
    );
    // Fresh instances so the per-instance summary cache never returns a stale read across the flip.
    const finding = (await new GraphService(app).summary(orgId)).findings.find(
      (f) => f.id === "rds-public",
    );
    expect(finding?.severity).toBe("high");
    expect(finding?.evidence?.some((e) => e.id === dbId)).toBe(true);

    // Not fired when the DB isn't public (and never on 'unknown' — attribute absent pre-resync).
    await admin.query(
      "UPDATE nodes SET attributes = jsonb_build_object('publiclyAccessible', false) WHERE id=$1",
      [dbId],
    );
    expect(
      (await new GraphService(app).summary(orgId)).findings.find((f) => f.id === "rds-public"),
    ).toBeUndefined();
  });

  it("getEdge returns endpoints + evidence/provenance; 404 on missing", async () => {
    const eid = one(
      (await admin.query<{ id: string }>("SELECT id FROM edges WHERE org_id=$1", [orgId])).rows,
    ).id;
    const edge = await graph.getEdge(orgId, eid);
    expect(edge).toMatchObject({
      type: "CONNECTS_TO",
      from: { urn: LAMBDA },
      to: { urn: RDS },
      provenance: { source: "edge" },
    });
    await expect(graph.getEdge(orgId, randomUUID())).rejects.toBeInstanceOf(ApiException);
    await expect(graph.getEdge(otherOrgId, eid)).rejects.toBeInstanceOf(ApiException); // R8
  });

  it("timeline returns node + edge changes since a timestamp, kind-filterable", async () => {
    const since = new Date(Date.now() - 3600_000);
    const tl = await graph.timeline(orgId, { since, limit: 50 });
    const kinds = tl.data.map((i) => i.changeKind);
    expect(kinds).toContain("node");
    expect(kinds).toContain("edge");

    const filtered = await graph.timeline(orgId, {
      since,
      kinds: "aws.lambda.function",
      limit: 50,
    });
    const nodeItems = filtered.data.filter((i) => i.changeKind === "node");
    expect(nodeItems.length).toBeGreaterThan(0);
    expect(
      nodeItems.every((i) => (i.entity as { kind?: string }).kind === "aws.lambda.function"),
    ).toBe(true);

    // A future `since` yields nothing.
    const none = await graph.timeline(orgId, { since: new Date(Date.now() + 3600_000), limit: 50 });
    expect(none.data).toHaveLength(0);
  });

  it("graph() returns the node set + interior edges, each node with an environment", async () => {
    const g = await graph.graph(orgId, { limit: 400 });
    expect(g.nodes.length).toBe(2); // checkout lambda + prod-orders rds
    expect(g.edges.length).toBe(1); // CONNECTS_TO(lambda→rds)
    expect(g.edges[0]).toMatchObject({ type: "CONNECTS_TO", from: lambdaId, to: rdsId });
    // prod-orders → env "prod" by naming; every node carries an environment + accountRef key.
    const rds = g.nodes.find((n) => n.id === rdsId);
    expect(rds?.environment).toBe("prod");
    expect(g.nodes.every((n) => "environment" in n && "accountRef" in n)).toBe(true);
    // Cross-tenant: the other org sees an empty graph.
    expect((await graph.graph(otherOrgId, { limit: 400 })).nodes).toHaveLength(0);
  });

  it("graph() filters by environment (derived, applied in-process)", async () => {
    expect((await graph.graph(orgId, { limit: 400, environment: "prod" })).nodes.length).toBe(1);
    expect((await graph.graph(orgId, { limit: 400, environment: "dev" })).nodes.length).toBe(0);
  });

  it("graph() ships only scalar attributes — nested objects/arrays are stripped from the payload", async () => {
    // A node whose attributes mix scalars (the map renders these) with heavy nested JSONB (it never does).
    await admin.query(`UPDATE nodes SET attributes = $2 WHERE id = $1`, [
      lambdaId,
      JSON.stringify({
        runtime: "nodejs20.x", // scalar — kept
        timeout: 30, // scalar — kept
        tracingEnabled: true, // scalar — kept
        policy: { Version: "2012-10-17", Statement: [{ Effect: "Allow" }] }, // object — dropped
        layers: ["arn:a", "arn:b"], // array — dropped
        env: { GIT_SHA: "abc123" }, // object — dropped
      }),
    ]);
    const g = await graph.graph(orgId, { limit: 400 });
    const lambda = g.nodes.find((n) => n.id === lambdaId);
    expect(lambda?.attributes).toEqual({
      runtime: "nodejs20.x",
      timeout: 30,
      tracingEnabled: true,
    });
    expect(lambda?.attributes).not.toHaveProperty("policy");
    expect(lambda?.attributes).not.toHaveProperty("layers");
  });

  it("graph() keeps a repo linked to its runtime when the budget truncates between them", async () => {
    // A repo that deploys to the lambda, but is older (last_seen) than the freshly-synced runtimes,
    // so a small last_seen-ordered budget would cut it. The edge-aware frontier must pull it back in
    // rather than strand it in the "no infra link" shelf (a false unlinked).
    const repoId = await insertNode(
      orgId,
      connId,
      "bitbucket:org:repository/api-svc",
      "bitbucket.repository",
      null,
      "api-svc",
    );
    // An inferred edge REQUIRES a rule (inferred_needs_rule) and provenance.confidence must be one of
    // observed/inferred-*; seed a real rule id and an inferred-high provenance row accordingly.
    const ruleId = one(
      (await admin.query<{ id: string }>("SELECT id FROM inference_rules LIMIT 1")).rows,
    ).id;
    const prov = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence, inference_rule_id) VALUES ($1,'rule:test','inferred-high',$2) RETURNING id",
          [orgId, ruleId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id)
       VALUES ($1,$2,$3,'DEPLOYS_TO','inferred','inferred-high',$4,$5)`,
      [orgId, repoId, lambdaId, prov, ruleId],
    );
    // Make the lambda the single newest node; repo + rds older so a budget of 1 excludes them.
    await admin.query("UPDATE nodes SET last_seen = now() WHERE id = $1", [lambdaId]);
    await admin.query("UPDATE nodes SET last_seen = now() - interval '1 hour' WHERE id = $1", [
      rdsId,
    ]);
    await admin.query("UPDATE nodes SET last_seen = now() - interval '2 hours' WHERE id = $1", [
      repoId,
    ]);

    const g = await graph.graph(orgId, { limit: 1 });
    expect(g.truncated).toBe(true); // more nodes exist than the budget
    // Budget = {lambda}; the frontier pulls in BOTH neighbours (rds via CONNECTS_TO, repo via
    // DEPLOYS_TO) so neither edge is dropped and the repo is never falsely unlinked.
    expect(new Set(g.nodes.map((n) => n.id))).toEqual(new Set([lambdaId, rdsId, repoId]));
    expect(g.edges.map((e) => e.type).sort()).toEqual(["CONNECTS_TO", "DEPLOYS_TO"]);
  });

  // ── Manual graph editing (add/remove links to "fix the flow") ───────────────
  const edgeRow = (id: string) =>
    admin
      .query<{ origin: string; confidence: string; status: string; source: string | null }>(
        `SELECT e.origin, e.confidence, e.status, p.source
           FROM edges e LEFT JOIN provenance p ON p.id = e.provenance_id WHERE e.id = $1`,
        [id],
      )
      .then((r) => r.rows[0]);

  it("createManualEdge writes a manual/observed, provenance-backed edge; idempotent", async () => {
    const { id } = await graph.createManualEdge(
      orgId,
      { fromId: lambdaId, toId: rdsId, type: "DEPENDS_ON" },
      null,
    );
    expect(await edgeRow(id)).toMatchObject({
      origin: "manual",
      confidence: "observed",
      status: "active",
      source: "manual",
    });
    // Re-adding the same link is a no-op that returns the same edge (convergent, no duplicate row).
    const again = await graph.createManualEdge(
      orgId,
      { fromId: lambdaId, toId: rdsId, type: "DEPENDS_ON" },
      null,
    );
    expect(again.id).toBe(id);
  });

  it("createManualEdge respects an existing observed edge (no origin downgrade)", async () => {
    // CONNECTS_TO(lambda→rds) is already observed+active; asking to add it returns that edge as-is.
    const observedId = one(
      (
        await admin.query<{ id: string }>(
          "SELECT id FROM edges WHERE org_id=$1 AND type='CONNECTS_TO'",
          [orgId],
        )
      ).rows,
    ).id;
    const { id } = await graph.createManualEdge(
      orgId,
      { fromId: lambdaId, toId: rdsId, type: "CONNECTS_TO" },
      null,
    );
    expect(id).toBe(observedId);
    expect((await edgeRow(id))?.origin).toBe("observed"); // untouched
  });

  it("createManualEdge rejects self-links and 404s on cross-tenant / missing nodes (R8)", async () => {
    await expect(
      graph.createManualEdge(orgId, { fromId: lambdaId, toId: lambdaId, type: "USES" }, null),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      graph.createManualEdge(orgId, { fromId: lambdaId, toId: randomUUID(), type: "USES" }, null),
    ).rejects.toBeInstanceOf(ApiException);
    // Another org can't link this org's nodes — they're invisible under RLS (→ 404, never 403).
    await expect(
      graph.createManualEdge(otherOrgId, { fromId: lambdaId, toId: rdsId, type: "USES" }, null),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it("removeEdge retires a manual edge and remembers the rejection (never re-inferred)", async () => {
    const { id } = await graph.createManualEdge(
      orgId,
      { fromId: lambdaId, toId: rdsId, type: "DEPENDS_ON" },
      null,
    );
    await graph.removeEdge(orgId, id, null);
    expect((await edgeRow(id))?.status).toBe("retired");
    const rej = await admin.query(
      "SELECT 1 FROM edge_suggestion_rejections WHERE org_id=$1 AND from_node_id=$2 AND to_node_id=$3 AND type='DEPENDS_ON'",
      [orgId, lambdaId, rdsId],
    );
    expect(rej.rowCount).toBe(1);
    // Adding it back clears the "no".
    await graph.createManualEdge(
      orgId,
      { fromId: lambdaId, toId: rdsId, type: "DEPENDS_ON" },
      null,
    );
    const cleared = await admin.query(
      "SELECT 1 FROM edge_suggestion_rejections WHERE org_id=$1 AND from_node_id=$2 AND to_node_id=$3 AND type='DEPENDS_ON'",
      [orgId, lambdaId, rdsId],
    );
    expect(cleared.rowCount).toBe(0);
  });

  it("removeEdge refuses observed edges and 404s on unknown / cross-tenant (R8)", async () => {
    const observedId = one(
      (
        await admin.query<{ id: string }>(
          "SELECT id FROM edges WHERE org_id=$1 AND type='CONNECTS_TO'",
          [orgId],
        )
      ).rows,
    ).id;
    await expect(graph.removeEdge(orgId, observedId, null)).rejects.toBeInstanceOf(ApiException);
    expect((await edgeRow(observedId))?.status).toBe("active"); // untouched
    await expect(graph.removeEdge(orgId, randomUUID(), null)).rejects.toBeInstanceOf(ApiException);
    await expect(graph.removeEdge(orgId, "not-a-uuid", null)).rejects.toBeInstanceOf(ApiException);
    // A manual edge in this org is invisible to another org → 404 on remove (R8).
    const { id: manualId } = await graph.createManualEdge(
      orgId,
      { fromId: lambdaId, toId: rdsId, type: "USES" },
      null,
    );
    await expect(graph.removeEdge(otherOrgId, manualId, null)).rejects.toBeInstanceOf(ApiException);
  });
});
