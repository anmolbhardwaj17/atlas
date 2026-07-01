import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runInference } from "./engine";
import { ALL_RULES } from "./rules";

/**
 * G1 engine integration (docs/05 §6.5): R1 derives a DEPLOYS_TO edge from a
 * workflow-deploy signal, re-running converges (zero new writes), and removing the
 * signal retires the edge (not delete). Env-gated on TEST_DATABASE_URL (atlas_app) +
 * TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

const REPO = "github:acme/orders";
const ECS = "aws:us-east-1:123456789012:ecs-service:prod/orders";

suite("G1 inference engine (R1)", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const insertNode = async (
    urn: string,
    kind: string,
    provider: string,
    attributes: Record<string, unknown>,
  ): Promise<void> => {
    await admin.query(
      `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, attributes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, connId, urn, kind, provider, JSON.stringify(attributes)],
    );
  };
  const insertSignal = async (
    subjectUrn: string,
    kind: string,
    data: Record<string, unknown>,
  ): Promise<void> => {
    await admin.query(
      `INSERT INTO signals (org_id, connection_id, subject_urn, kind, data) VALUES ($1,$2,$3,$4,$5)`,
      [orgId, connId, subjectUrn, kind, JSON.stringify(data)],
    );
  };
  const inferredEdges = async (
    status = "active",
  ): Promise<Array<{ type: string; confidence: string; from_urn: string; to_urn: string }>> => {
    const { rows } = await admin.query<{
      type: string;
      confidence: string;
      from_urn: string;
      to_urn: string;
    }>(
      `SELECT e.type, e.confidence, nf.urn AS from_urn, nt.urn AS to_urn
         FROM edges e JOIN nodes nf ON nf.id=e.from_node_id JOIN nodes nt ON nt.id=e.to_node_id
        WHERE e.org_id=$1 AND e.origin='inferred' AND e.status=$2`,
      [orgId, status],
    );
    return rows;
  };

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    orgId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1, 'Org') RETURNING id",
          [`inf-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'github','gh') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    await insertNode(REPO, "github.repository", "github", { owner: "acme", repo: "orders" });
    await insertNode(ECS, "aws.ecs.service", "aws", { serviceName: "orders", cluster: "prod" });
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id=$1", [orgId]);
  });

  it("derives an inferred-high DEPLOYS_TO edge with provenance", async () => {
    await insertSignal(`${REPO}:workflow:.github/workflows/deploy.yml`, "github.workflow.deploy", {
      repo: REPO,
      targets: [{ kind: "ecs", cluster: "prod", service: "orders" }],
    });

    const stats = await runInference({ db: app }, orgId, ALL_RULES);
    expect(stats.upserted).toBe(1);

    const edges = await inferredEdges();
    expect(edges).toEqual([
      { type: "DEPLOYS_TO", confidence: "inferred-high", from_urn: REPO, to_urn: ECS },
    ]);
    // Provenance carries the rule + evidence (P4).
    const prov = await admin.query<{ source: string; inference_rule_id: string }>(
      "SELECT source, inference_rule_id FROM provenance WHERE org_id=$1 AND source LIKE 'rule:%'",
      [orgId],
    );
    expect(prov.rows[0]?.source).toBe("rule:repo_deploys_to_runtime");
    expect(prov.rows[0]?.inference_rule_id).toBeTruthy();
  });

  it("converges — a second run with unchanged inputs writes nothing (IE-4)", async () => {
    await insertSignal(`${REPO}:workflow:deploy.yml`, "github.workflow.deploy", {
      repo: REPO,
      targets: [{ kind: "ecs", cluster: "prod", service: "orders" }],
    });
    await runInference({ db: app }, orgId, ALL_RULES);
    const second = await runInference({ db: app }, orgId, ALL_RULES);
    expect(second.upserted).toBe(0);
    expect(second.retired).toBe(0);
    expect(await inferredEdges()).toHaveLength(1);
  });

  it("retires (not deletes) an edge whose evidence disappeared", async () => {
    await insertSignal(`${REPO}:workflow:deploy.yml`, "github.workflow.deploy", {
      repo: REPO,
      targets: [{ kind: "ecs", cluster: "prod", service: "orders" }],
    });
    await runInference({ db: app }, orgId, ALL_RULES);
    expect(await inferredEdges("active")).toHaveLength(1);

    await admin.query("DELETE FROM signals WHERE org_id=$1", [orgId]);
    const stats = await runInference({ db: app }, orgId, ALL_RULES);
    expect(stats.retired).toBe(1);
    expect(await inferredEdges("active")).toHaveLength(0);
    expect(await inferredEdges("retired")).toHaveLength(1); // history kept (P4)
  });
});
