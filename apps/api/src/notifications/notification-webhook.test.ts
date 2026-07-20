import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemorySecretBroker } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import type { AiService } from "../ai/ai.service";
import { NotificationService } from "./notification.service";

/**
 * Webhook URL encryption at rest (compliance): a channel's webhook URL embeds a bearer token, so
 * it's stored via the Secrets Broker (only an opaque `secretRef` + masked hint land in the DB
 * `config`), never as plaintext. Env-gated (real Postgres): needs TEST_DATABASE_URL + admin.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

const SLACK_URL = "https://hooks.slack.com/services/T000/B000/verysecrettoken123";

suite("Notification webhook — encrypted at rest", () => {
  let admin: Pool;
  let app: Pool;
  let broker: InMemorySecretBroker;
  let svc: NotificationService;
  let orgId: string;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    broker = new InMemorySecretBroker();
    svc = new NotificationService(app, {} as Env, broker, {} as AiService);
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
      [`nw-${randomUUID().slice(0, 8)}`],
    );
    orgId = rows[0]?.id as string;
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("setChannel stores a secretRef + hint, NOT the plaintext URL", async () => {
    const channels = await svc.setChannel(orgId, "slack", SLACK_URL);
    expect(channels.find((c) => c.kind === "slack")?.enabled).toBe(true);
    expect(channels.find((c) => c.kind === "slack")?.hint).toBeTruthy();

    const { rows } = await admin.query<{ config: { webhookUrl?: string; secretRef?: string } }>(
      "SELECT config FROM notification_channels WHERE org_id = $1 AND kind = 'slack'",
      [orgId],
    );
    const config = rows[0]?.config;
    expect(config?.secretRef).toBeTruthy(); // encrypted pointer stored
    expect(config?.webhookUrl).toBeUndefined(); // plaintext URL is NOT in the DB
    // The real URL lives only in the broker, retrievable via the ref.
    expect((await broker.get(config?.secretRef as string)).url).toBe(SLACK_URL);
  });

  it("replacing a channel deletes the previous secret", async () => {
    await svc.setChannel(orgId, "slack", SLACK_URL);
    const firstRef = (
      await admin.query<{ config: { secretRef?: string } }>(
        "SELECT config FROM notification_channels WHERE org_id = $1 AND kind = 'slack'",
        [orgId],
      )
    ).rows[0]?.config.secretRef as string;

    await svc.setChannel(orgId, "slack", "https://hooks.slack.com/services/T111/B111/newtoken456");
    expect(await broker.get(firstRef)).toEqual({}); // old secret gone from the broker
  });
});
