import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope } from "@atlas/db";
import type { Connection } from "@atlas/connector-sdk";
import { InMemoryQueue } from "./queue";
import { registerSyncWorker, enqueueSync } from "./sync-worker";
import { MockConnector } from "./mock-connector";
import { InMemorySnapshotStore } from "./snapshot-store";
import { nullSecretAccessor, silentLogger } from "./runtime";

/**
 * F2.5 worker runtime: enqueue a sync job → the worker handler runs the staged sync →
 * nodes persisted. Proves the queue→worker→runner→persist chain (in-memory queue, no
 * Redis). Env-gated on a real Postgres.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

suite("F2.5 sync worker runtime", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const loadConnection = async (org: string, id: string): Promise<Connection | null> =>
    withOrgScope(app, org, async (c) => {
      const { rows } = await c.query<{
        id: string;
        org_id: string;
        provider: string;
        display_name: string;
        config: Record<string, unknown>;
        secret_ref: string | null;
      }>(
        "SELECT id, org_id, provider, display_name, config, secret_ref FROM connections WHERE id = $1",
        [id],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            orgId: r.org_id,
            provider: r.provider,
            displayName: r.display_name,
            config: r.config,
            secretRef: r.secret_ref,
          }
        : null;
    });

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
  });
  afterAll(async () => {
    await admin.query("DELETE FROM node_kinds WHERE kind LIKE 'mock.%'");
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    orgId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO organizations (slug, name) VALUES ($1, 'Org') RETURNING id",
          [`sw-${randomUUID().slice(0, 8)}`],
        )
      ).rows,
    ).id;
    connId = one(
      (
        await admin.query<{ id: string }>(
          "INSERT INTO connections (org_id, provider, display_name) VALUES ($1, 'aws', 'mock') RETURNING id",
          [orgId],
        )
      ).rows,
    ).id;
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("processes an enqueued sync job and persists nodes", async () => {
    const mock = new MockConnector([
      {
        key: "s1",
        resources: [
          { externalId: "r1", urn: "urn:mock:w1", kind: "mock.resource", name: "W1" },
          { externalId: "r2", urn: "urn:mock:w2", kind: "mock.resource", name: "W2" },
        ],
      },
    ]);

    const queue = new InMemoryQueue();
    registerSyncWorker(queue, {
      db: app,
      snapshots: new InMemorySnapshotStore(),
      secrets: nullSecretAccessor,
      logger: silentLogger,
      resolveConnector: (p) => (p === "aws" ? mock : undefined),
      loadConnection,
    });

    const runId = one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, 'full', 'manual', 'queued') RETURNING id`,
          [orgId, connId],
        )
      ).rows,
    ).id;

    await enqueueSync(queue, { orgId, connectionId: connId, runId });
    await queue.drain();

    const nodes = one(
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM nodes WHERE connection_id = $1 AND status = 'active'",
          [connId],
        )
      ).rows,
    ).n;
    expect(nodes).toBe(2);

    const run = one(
      (await admin.query<{ status: string }>("SELECT status FROM sync_runs WHERE id = $1", [runId]))
        .rows,
    ).status;
    expect(run).toBe("succeeded");
  });

  it("runs the infer stage after a sync (workflow deploy signal → DEPLOYS_TO)", async () => {
    const REPO = "github:acme/orders";
    const ECS = "aws:us-east-1:111122223333:ecs-service:prod/orders";
    const mock = new MockConnector([
      {
        key: "s1",
        resources: [
          {
            externalId: "repo",
            urn: REPO,
            kind: "github.repository",
            name: "orders",
            signals: [
              {
                kind: "github.workflow.deploy",
                subjectUrn: `${REPO}:workflow:.github/workflows/deploy.yml`,
                data: {
                  repo: REPO,
                  targets: [{ kind: "ecs", cluster: "prod", service: "orders" }],
                },
              },
            ],
          },
          {
            externalId: "ecs",
            urn: ECS,
            kind: "aws.ecs.service",
            name: "orders",
            attributes: { serviceName: "orders", cluster: "prod" },
          },
        ],
      },
    ]);

    const queue = new InMemoryQueue();
    registerSyncWorker(queue, {
      db: app,
      snapshots: new InMemorySnapshotStore(),
      secrets: nullSecretAccessor,
      logger: silentLogger,
      resolveConnector: () => mock,
      loadConnection,
    });

    const runId = one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, 'full', 'manual', 'queued') RETURNING id`,
          [orgId, connId],
        )
      ).rows,
    ).id;

    await enqueueSync(queue, { orgId, connectionId: connId, runId });
    await queue.drain();

    // The post-sync infer stage should have derived DEPLOYS_TO(repo→ecs) from the signal.
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM edges
        WHERE org_id=$1 AND origin='inferred' AND type='DEPLOYS_TO' AND status='active'`,
      [orgId],
    );
    expect(one(rows).n).toBe(1);
  });
});
