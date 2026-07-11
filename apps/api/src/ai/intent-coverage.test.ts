import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MockLLMProvider } from "@atlas/ai";
import { InMemorySecretBroker } from "@atlas/ingest";
import { loadEnv } from "@atlas/config";
import { GraphService } from "../graph/graph.service";
import { PostgresSearchProvider } from "../search/postgres-search.provider";
import { GraphRetrievalPort } from "./graph-retrieval.port";
import { AiService } from "./ai.service";
import { EdgeSuggestionService } from "./edge-suggestion.service";
import { RateLimitService } from "../core/rate-limit.service";
import { ApiException } from "../common/errors";

/**
 * IV-3b intent-coverage wiring, over the real read layer (env-gated on TEST_DATABASE_URL + admin).
 * Verifies the API ASSEMBLY (PR node -> R18 IMPLEMENTS edge -> the linked jira.issue's captured
 * attributes -> the judge's IntentIssue) and the honest short-circuits (`no-intent` / `no-diff` /
 * non-PR). The full "assessed" judgment is proven in the engine eval (coverage.test.ts) with a real
 * diff; here there is no live Bitbucket, so the diff resolves to null (-> `no-diff`), which itself
 * confirms the link + attribute mapping ran. All org-scoped (GraphService RLS, R8).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("IV-3b intent-coverage assembly", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const makeAi = (): AiService => {
    const port = new GraphRetrievalPort(
      new GraphService(app),
      new PostgresSearchProvider(app),
      app,
      new InMemorySecretBroker(),
    );
    return new AiService(
      app,
      port,
      new MockLLMProvider(""),
      new InMemorySecretBroker(),
      loadEnv({}),
      new RateLimitService(app),
      new EdgeSuggestionService(app),
      new GraphService(app),
    );
  };

  const insertNode = async (
    urn: string,
    kind: string,
    name: string,
    attributes: Record<string, unknown> = {},
  ): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, name, attributes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [orgId, connId, urn, kind, kind.split(".")[0], name, attributes],
        )
      ).rows,
    ).id;

  /** Seed an active IMPLEMENTS(pr -> issue) edge exactly as R18 would (inferred, rule-backed). */
  const linkImplements = async (prId: string, issueId: string): Promise<void> => {
    const ruleId = one(
      (
        await admin.query<{ id: string }>(
          "SELECT id FROM inference_rules WHERE key='pr_implements_issue' AND version=1",
        )
      ).rows,
    ).id;
    const provId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO provenance (org_id, source, confidence, inference_rule_id) VALUES ($1,'rule:pr_implements_issue','inferred-high',$2) RETURNING id",
          [orgId, ruleId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO edges (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, inference_rule_id)
       VALUES ($1,$2,$3,'IMPLEMENTS','inferred','inferred-high',$4,$5)`,
      [orgId, prId, issueId, provId, ruleId],
    );
  };

  const ISSUE_ATTRS = {
    key: "ENG-142",
    summary: "Harden the login flow",
    description:
      "Acceptance Criteria:\n- Email must be verified before a session is created\n- The session is cleared on logout",
    subtasks: [{ key: "ENG-143", summary: "Add rate limiting", status: "To Do" }],
    comments: [
      { author: "PM", text: "Rate limiting is the important one.", createdAt: "2026-07-01" },
    ],
    url: "https://acme.atlassian.net/browse/ENG-142",
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
          "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
          [`iv-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'bitbucket','c') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("assembles the linked intent and reports no-diff when the diff is unavailable", async () => {
    const prId = await insertNode(
      "bitbucket:acme:pullrequest/web/42",
      "bitbucket.pullrequest",
      "ENG-142: secure login",
    );
    const issueId = await insertNode(
      "jira:acme:issue/ENG-142",
      "jira.issue",
      "ENG-142 — Harden the login flow",
      ISSUE_ATTRS,
    );
    await linkImplements(prId, issueId);

    const a = await makeAi().coverageForPr(orgId, prId);
    // No live Bitbucket -> diff is null -> honest no-diff, but the link + attribute mapping ran:
    expect(a.status).toBe("no-diff");
    expect(a.issue).toMatchObject({
      key: "ENG-142",
      summary: "Harden the login flow",
      url: "https://acme.atlassian.net/browse/ENG-142",
    });
    expect(a.pr.id).toBe(prId);
  });

  it("returns no-intent for a PR with no linked issue", async () => {
    const prId = await insertNode(
      "bitbucket:acme:pullrequest/web/43",
      "bitbucket.pullrequest",
      "#43 chore: bump deps",
    );
    const a = await makeAi().coverageForPr(orgId, prId);
    expect(a.status).toBe("no-intent");
    expect(a.issue).toBeNull();
    expect(a.criteria).toHaveLength(0);
  });

  it("rejects a non-PR node", async () => {
    const rdsId = await insertNode(
      "aws:us-east-1:1:rds:prod-orders",
      "aws.rds.instance",
      "prod-orders",
    );
    await expect(makeAi().coverageForPr(orgId, rdsId)).rejects.toBeInstanceOf(ApiException);
  });

  it("404s on an absent / cross-tenant PR id (R8)", async () => {
    await expect(makeAi().coverageForPr(orgId, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
