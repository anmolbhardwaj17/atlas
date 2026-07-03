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
    const port = new GraphRetrievalPort(new GraphService(app), new PostgresSearchProvider(app));
    return new AiService(
      app,
      port,
      new MockLLMProvider(narration),
      new InMemorySecretBroker(),
      loadEnv({}),
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
