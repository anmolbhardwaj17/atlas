import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runInference } from "./engine";
import { tagCodeCorrelationRule } from "./rules/r11-tags";
import { imageCommitProvenanceRule } from "./rules/r12-images";
import { serviceNameEnvRule } from "./rules/r13-service-env";

/**
 * Integration proof for the signal-enrichment matchers (docs/plans/signal-enrichment.md).
 * Unit tests cover the pure rules; this drives them through the REAL engine against Postgres —
 * URN→id resolution, provenance rows, the inference_rule_id FK (seeded by migrations 0034-0036),
 * and convergence. Each matcher links a repo→runtime by a different signal and cites its rule.
 * Env-gated on TEST_DATABASE_URL (atlas_app) + TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

const ACCT = "123456789012";
const FULL_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("signal-enrichment matchers (R11/R12/R13) end-to-end", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const insertNode = (
    urn: string,
    kind: string,
    provider: string,
    attributes: Record<string, unknown>,
  ): Promise<unknown> =>
    admin.query(
      `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, attributes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, connId, urn, kind, provider, JSON.stringify(attributes)],
    );
  const insertSignal = (
    subjectUrn: string,
    kind: string,
    data: Record<string, unknown>,
  ): Promise<unknown> =>
    admin.query(
      `INSERT INTO signals (org_id, connection_id, subject_urn, kind, data) VALUES ($1,$2,$3,$4,$5)`,
      [orgId, connId, subjectUrn, kind, JSON.stringify(data)],
    );

  /** The inferred DEPLOYS_TO edges + the rule each was cited to (via its provenance source). */
  const deploysEdges = async (): Promise<
    Array<{ from_urn: string; to_urn: string; confidence: string; rule: string }>
  > => {
    const { rows } = await admin.query<{
      from_urn: string;
      to_urn: string;
      confidence: string;
      rule: string;
    }>(
      `SELECT nf.urn AS from_urn, nt.urn AS to_urn, e.confidence, p.source AS rule
         FROM edges e
         JOIN nodes nf ON nf.id = e.from_node_id
         JOIN nodes nt ON nt.id = e.to_node_id
         JOIN provenance p ON p.id = e.provenance_id
        WHERE e.org_id = $1 AND e.origin = 'inferred' AND e.type = 'DEPLOYS_TO' AND e.status = 'active'
        ORDER BY nt.urn`,
      [orgId],
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
    const slug = `enr-${randomUUID().slice(0, 8)}`;
    orgId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1, 'Enrich') RETURNING id",
          [slug],
        )
      ).rows,
    ).id;
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'bitbucket','bb') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id=$1", [orgId]);
  });

  it("R11: a `repository` tag on a Lambda → repo DEPLOYS_TO it (inferred-high, cited)", async () => {
    const repo = "bitbucket:acme:repository/payments";
    const fn = `aws:us-east-1:${ACCT}:lambda:pay-fn`;
    await insertNode(repo, "bitbucket.repository", "bitbucket", { slug: "payments" });
    await insertNode(fn, "aws.lambda.function", "aws", {
      functionName: "pay-fn",
      tags: { repository: "payments" },
    });

    await runInference({ db: app }, orgId, [tagCodeCorrelationRule]);

    expect(await deploysEdges()).toEqual([
      {
        from_urn: repo,
        to_urn: fn,
        confidence: "inferred-high",
        rule: "rule:tag_code_correlation",
      },
    ]);
  });

  it("R12: an image-tag SHA matching a PR commit → repo DEPLOYS_TO the ECS service", async () => {
    const repo = "bitbucket:acme:repository/orders";
    const svc = `aws:us-east-1:${ACCT}:ecs-service:prod/orders-svc`;
    await insertNode(repo, "bitbucket.repository", "bitbucket", { slug: "orders" });
    await insertNode("bitbucket:acme:pullrequest/orders/5", "bitbucket.pullrequest", "bitbucket", {
      repoSlug: "orders",
      commitShas: [FULL_SHA],
    });
    await insertNode(`aws:us-east-1:${ACCT}:ecs-taskdef:orders-td`, "aws.ecs.taskdef", "aws", {
      family: "orders-td",
      images: [`${ACCT}.dkr.ecr.us-east-1.amazonaws.com/orders:main-${FULL_SHA.slice(0, 7)}`],
    });
    await insertNode(svc, "aws.ecs.service", "aws", {
      serviceName: "orders-svc",
      cluster: "prod",
      taskDefinition: `arn:aws:ecs:us-east-1:${ACCT}:task-definition/orders-td:1`,
    });

    await runInference({ db: app }, orgId, [imageCommitProvenanceRule]);

    expect(await deploysEdges()).toEqual([
      {
        from_urn: repo,
        to_urn: svc,
        confidence: "inferred-high",
        rule: "rule:image_commit_provenance",
      },
    ]);
  });

  it("R13: a DD_SERVICE env var → repo DEPLOYS_TO the Lambda", async () => {
    const repo = "bitbucket:acme:repository/billing";
    const fn = `aws:us-east-1:${ACCT}:lambda:bill-fn`;
    await insertNode(repo, "bitbucket.repository", "bitbucket", { slug: "billing" });
    await insertNode(fn, "aws.lambda.function", "aws", { functionName: "bill-fn" });
    await insertSignal(fn, "aws.lambda.env", { variables: { DD_SERVICE: "billing" } });

    await runInference({ db: app }, orgId, [serviceNameEnvRule]);

    expect(await deploysEdges()).toEqual([
      {
        from_urn: repo,
        to_urn: fn,
        confidence: "inferred-high",
        rule: "rule:service_name_env_correlation",
      },
    ]);
  });

  it("converges — a second run with the same inputs writes nothing (IE-4)", async () => {
    const repo = "bitbucket:acme:repository/payments";
    await insertNode(repo, "bitbucket.repository", "bitbucket", { slug: "payments" });
    await insertNode(`aws:us-east-1:${ACCT}:lambda:pay-fn`, "aws.lambda.function", "aws", {
      functionName: "pay-fn",
      tags: { repository: "payments" },
    });
    await runInference({ db: app }, orgId, [tagCodeCorrelationRule]);
    const second = await runInference({ db: app }, orgId, [tagCodeCorrelationRule]);
    expect(second.upserted).toBe(0);
    expect(second.retired).toBe(0);
    expect(await deploysEdges()).toHaveLength(1);
  });
});
