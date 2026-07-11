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

  it("judges against the title-named ticket when a PR links several (not an arbitrary first)", async () => {
    const prId = await insertNode(
      "bitbucket:acme:pullrequest/web/70",
      "bitbucket.pullrequest",
      "[ENG-200] add the widget", // author named ENG-200 in the title
    );
    const foundation = await insertNode("jira:acme:issue/ENG-199", "jira.issue", "ENG-199 — base", {
      key: "ENG-199",
      summary: "Foundation work",
      description: "AC:\n- lay the foundation",
    });
    const target = await insertNode("jira:acme:issue/ENG-200", "jira.issue", "ENG-200 — widget", {
      key: "ENG-200",
      summary: "Add the widget",
      description: "AC:\n- add the widget",
    });
    await linkImplements(prId, foundation); // linked first…
    await linkImplements(prId, target); // …but the title names this one

    const a = await makeAi().coverageForPr(orgId, prId);
    expect(a.issue?.key).toBe("ENG-200"); // title-key wins over an arbitrary first link
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

  // ── IV-4 fuzzy (no-key) PR↔issue linking ──────────────────────────────────
  const countImplements = async (from: string, to: string): Promise<number> =>
    Number(
      (
        await admin.query<{ n: string }>(
          `SELECT count(*) n FROM edges WHERE from_node_id=$1 AND to_node_id=$2
             AND type='IMPLEMENTS' AND origin='ai_suggested' AND status='active'`,
          [from, to],
        )
      ).rows[0]?.n ?? "0",
    );

  it("writes an ai_suggested IMPLEMENTS edge for a fuzzy-matched unlinked PR", async () => {
    const prId = await insertNode(
      "bitbucket:acme:pullrequest/web/50",
      "bitbucket.pullrequest",
      "Handle checkout refund timeout",
      { sourceBranch: "feature/checkout-refund-timeout", createdOn: "2026-06-03T00:00:00Z" },
    );
    const issueId = await insertNode(
      "jira:acme:issue/ENG-9",
      "jira.issue",
      "ENG-9 — checkout refund",
      {
        key: "ENG-9",
        summary: "Add checkout refund timeout handling",
        createdAt: "2026-06-01T00:00:00Z",
      },
    );

    const res = await makeAi().suggestIntentLinks(orgId);
    expect(res.suggested).toBe(1);
    expect(await countImplements(prId, issueId)).toBe(1);
  });

  it("does not fuzzily link a PR that already has an explicit IMPLEMENTS edge", async () => {
    const prId = await insertNode(
      "bitbucket:acme:pullrequest/web/51",
      "bitbucket.pullrequest",
      "Add checkout refund timeout handling",
      { sourceBranch: "feature/checkout-refund", createdOn: "2026-06-03T00:00:00Z" },
    );
    const issueId = await insertNode("jira:acme:issue/ENG-10", "jira.issue", "ENG-10", {
      key: "ENG-10",
      summary: "Add checkout refund timeout handling",
      createdAt: "2026-06-01T00:00:00Z",
    });
    await linkImplements(prId, issueId); // explicit (R18) link already present

    const res = await makeAi().suggestIntentLinks(orgId);
    expect(res.suggested).toBe(0);
    expect(await countImplements(prId, issueId)).toBe(0); // no ai_suggested duplicate
  });

  it("suggests nothing when there are no Jira issues (the live estate today)", async () => {
    await insertNode(
      "bitbucket:acme:pullrequest/web/52",
      "bitbucket.pullrequest",
      "#52 bump deps",
      {
        sourceBranch: "chore/deps",
      },
    );
    const res = await makeAi().suggestIntentLinks(orgId);
    expect(res).toMatchObject({ suggested: 0, scannedIssues: 0 });
    expect(res.scannedPrs).toBeGreaterThanOrEqual(1);
  });
});
