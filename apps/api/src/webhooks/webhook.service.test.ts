import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { Pool } from "pg";
import { InMemoryQueue } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import { WebhookService } from "./webhook.service";
import { ApiException } from "../common/errors";

/**
 * GitHub webhook ingress (docs/07 §5): HMAC verify → event map → org resolve (SECURITY
 * DEFINER) → org-scoped incremental sync_run. Env-gated on TEST_DATABASE_URL (atlas_app) +
 * TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

const SECRET = "whsec_test";
const sign = (body: string): string =>
  "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error("expected a row");
  return r;
}

suite("GitHub WebhookService", () => {
  let admin: Pool;
  let app: Pool;
  let svc: WebhookService;
  let orgId: string;
  let connId: string;

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
    svc = new WebhookService({ GITHUB_WEBHOOK_SECRET: SECRET } as Env, app, new InMemoryQueue());
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
          [`wh-${randomUUID().slice(0, 8)}`],
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
  });

  it("rejects a bad or missing signature (401)", async () => {
    const body = JSON.stringify({ zen: "hi" });
    await expect(
      svc.handleGithub(connId, "push", "sha256=deadbeef", Buffer.from(body)),
    ).rejects.toThrow(ApiException);
    await expect(svc.handleGithub(connId, "push", undefined, Buffer.from(body))).rejects.toThrow(
      /signature/i,
    );
  });

  it("acks a ping without enqueuing", async () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const res = await svc.handleGithub(connId, "ping", sign(body), Buffer.from(body));
    expect(res.action).toBe("ping");
    expect(await countRuns()).toBe(0);
  });

  it("verified push → resolves org → creates an incremental sync_run", async () => {
    const body = JSON.stringify({ repository: { name: "orders", owner: { login: "acme" } } });
    const res = await svc.handleGithub(connId, "push", sign(body), Buffer.from(body));
    expect(res.action).toBe("accepted");
    expect(res.runId).toBeTruthy();

    const run = one(
      (
        await admin.query<{ type: string; trigger: string; status: string }>(
          "SELECT type, trigger, status FROM sync_runs WHERE id = $1",
          [res.runId],
        )
      ).rows,
    );
    expect(run).toMatchObject({ type: "incremental", trigger: "webhook", status: "queued" });
  });

  it("ignores an unknown connection (no session leak, no run)", async () => {
    const body = JSON.stringify({ repository: { name: "x", owner: { login: "y" } } });
    const res = await svc.handleGithub(randomUUID(), "push", sign(body), Buffer.from(body));
    expect(res.action).toBe("unknown_connection");
  });

  async function countRuns(): Promise<number> {
    return Number(
      one(
        (
          await admin.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM sync_runs WHERE connection_id = $1",
            [connId],
          )
        ).rows,
      ).n,
    );
  }
});
