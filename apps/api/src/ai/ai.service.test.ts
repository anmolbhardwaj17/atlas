import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MockLLMProvider } from "@atlas/ai";
import type { AnswerEvent } from "@atlas/ai";
import { InMemorySecretBroker } from "@atlas/ingest";
import { loadEnv } from "@atlas/config";
import { GraphService } from "../graph/graph.service";
import { PostgresSearchProvider } from "../search/postgres-search.provider";
import { GraphRetrievalPort } from "./graph-retrieval.port";
import { AiService } from "./ai.service";
import { EdgeSuggestionService } from "./edge-suggestion.service";
import { AiUsageService } from "./ai-usage.service";
import { RateLimitService } from "../core/rate-limit.service";

/**
 * G3.5 AI service: create conversation → ask → SSE-shaped stream + persisted transcript,
 * over the real read layer + a mock LLM. Env-gated on TEST_DATABASE_URL + admin.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}
async function collect(it: AsyncIterable<AnswerEvent>): Promise<AnswerEvent[]> {
  const out: AnswerEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const RDS = "aws:us-east-1:1:rds:prod-orders";

suite("G3.5 AiService", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const makeAi = (narration: string): AiService => {
    const port = new GraphRetrievalPort(
      new GraphService(app),
      new PostgresSearchProvider(app),
      app,
      new InMemorySecretBroker(),
    );
    return new AiService(
      app,
      port,
      new MockLLMProvider(narration),
      new InMemorySecretBroker(),
      loadEnv({}),
      new RateLimitService(app),
      new EdgeSuggestionService(app),
      new GraphService(app),
      new AiUsageService(app, loadEnv({})),
    );
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
          [`ai-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1,'aws','c') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
    await admin.query(
      `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, region, name)
       VALUES ($1,$2,$3,'aws.rds.instance','aws','us-east-1','prod-orders')`,
      [orgId, connId, RDS],
    );
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("streams a grounded, cited answer and persists the transcript", async () => {
    const ai = makeAi("The **prod-orders** [N1] database is an active RDS instance.");
    const { id: convId } = await ai.createConversation(orgId, null, "chat");

    const events = await collect(ai.askStream(orgId, convId, "tell me about prod-orders"));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("retrieval");
    expect(types).toContain("token");
    expect(types).toContain("citation");
    expect(types.at(-1)).toBe("done");
    const done = events.at(-1) as { grounded: boolean };
    expect(done.grounded).toBe(true);
    const citation = events.find((e) => e.type === "citation") as { citation: { id: string } };
    expect(citation.citation.id).toBeTruthy();

    // Transcript persisted: user + assistant, assistant carries citations.
    const conv = await ai.getConversation(orgId, convId);
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conv.messages[1]?.confidence).toBeTruthy();
    expect((conv.messages[1]?.citations as unknown[]).length).toBeGreaterThan(0);
  });

  it("streams honest-absence for an unknown entity (US-11), never fabricating", async () => {
    const ai = makeAi("prod-orders connects to a made-up cluster [N1].");
    const { id: convId } = await ai.createConversation(orgId, null);
    const events = await collect(
      ai.askStream(orgId, convId, "what breaks if ghost-service is deleted"),
    );
    const done = events.at(-1) as { type: string; grounded: boolean };
    expect(done.grounded).toBe(false);
    const conf = events.find((e) => e.type === "confidence") as { overall: string };
    expect(conf.overall).toBe("insufficient");
    expect(events.some((e) => e.type === "citation")).toBe(false);
  });

  it("suggestIntentLinks retrieves candidates via the FTS index and links the right ticket", async () => {
    // A jira.issue helper: name = "KEY — summary", searchable text in attributes.
    const issue = async (
      key: string,
      summary: string,
      description: string,
      createdAt: string,
    ): Promise<string> =>
      one(
        (
          await admin.query<{ id: string }>(
            `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, region, name, attributes, last_seen)
             VALUES ($1,$2,$3,'jira.issue','jira',null,$4,$5,$6) RETURNING id`,
            [
              orgId,
              connId,
              `jira:${key}`,
              `${key} — ${summary}`,
              JSON.stringify({ key, summary, description, createdAt }),
              createdAt, // deliberately "old" last_seen — FTS ranks by relevance, not recency, so an
              // older ticket is still a candidate (the recall win over the old ORDER BY last_seen cap).
            ],
          )
        ).rows,
      ).id;

    const target = await issue(
      "PROJ-100",
      "Checkout latency spike under peak traffic",
      "Investigate the p99 on the checkout path during peak load.",
      "2026-06-01T00:00:00Z",
    );
    await issue("PROJ-101", "Update onboarding email templates", "", "2026-06-01T00:00:00Z");
    // Shares only ONE meaningful word (checkout) — retrieved as a candidate, but must fail the
    // ≥2-shared-words precision bar and NOT be linked.
    await issue("PROJ-102", "Checkout button color change", "", "2026-06-01T00:00:00Z");

    // An unlinked PR whose title clearly matches PROJ-100 (checkout, latency, spike, peak).
    const prId = one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, region, name, attributes)
           VALUES ($1,$2,$3,'bitbucket.pullrequest','bitbucket',null,$4,$5) RETURNING id`,
          [
            orgId,
            connId,
            "bitbucket:acme/svc/pr/7",
            "Fix checkout latency spike on peak",
            JSON.stringify({
              sourceBranch: "bugfix/checkout-latency",
              createdOn: "2026-06-10T00:00:00Z",
            }),
          ],
        )
      ).rows,
    ).id;

    const ai = makeAi("x");
    const res = await ai.suggestIntentLinks(orgId);
    expect(res.scannedIssues).toBe(3);
    expect(res.suggested).toBe(1);

    // Exactly one ai_suggested IMPLEMENTS edge, PR → PROJ-100 (the clear winner, not PROJ-102).
    const { rows: edges } = await admin.query<{ from_node_id: string; to_node_id: string }>(
      `SELECT from_node_id, to_node_id FROM edges
        WHERE org_id=$1 AND type='IMPLEMENTS' AND origin='ai_suggested' AND status='active'`,
      [orgId],
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from_node_id: prId, to_node_id: target });
  });

  it("404s asking into a conversation from another org (R8)", async () => {
    const ai = makeAi("x");
    const otherOrg = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1,'Other') RETURNING id",
          [`ai2-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    const { id: convId } = await ai.createConversation(orgId, null);
    await expect(collect(ai.askStream(otherOrg, convId, "hi"))).rejects.toBeTruthy();
    await admin.query("DELETE FROM organizations WHERE id = $1", [otherOrg]);
  });
});
