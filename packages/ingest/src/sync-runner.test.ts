import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Connection } from "@atlas/connector-sdk";
import { runStagedSync, reconcileStaleNodes, type SyncRunRecord } from "./sync-runner";
import { MockConnector, type MockControl } from "./mock-connector";
import { InMemorySnapshotStore } from "./snapshot-store";
import { nullSecretAccessor, silentLogger } from "./runtime";

/**
 * F2 EXIT PROOF (docs/15 F2 exit): a mock connector runs a staged sync end-to-end
 * (plan→discover→fetch→persist) idempotently & resumably; partial failure leaves no
 * false deletes (BR-SYNC-2). Env-gated (real Postgres): skipped without both
 * TEST_DATABASE_URL (atlas_app) and TEST_ADMIN_DATABASE_URL (owner).
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

suite("F2 staged sync runner", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  let connId: string;

  const snapshots = new InMemorySnapshotStore();
  const deps = () => ({ db: app, snapshots, secrets: nullSecretAccessor, logger: silentLogger });
  const conn = (): Connection => ({
    id: connId,
    orgId,
    provider: "aws",
    displayName: "mock",
    config: {},
    secretRef: null,
  });

  const newRun = async (): Promise<SyncRunRecord> => {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
       VALUES ($1, $2, 'full', 'manual', 'queued') RETURNING id`,
      [orgId, connId],
    );
    return { id: one(rows).id, orgId, connectionId: connId, type: "full" };
  };

  const count = async (status?: string): Promise<number> => {
    const sql = status
      ? "SELECT count(*)::int AS n FROM nodes WHERE connection_id = $1 AND status = $2"
      : "SELECT count(*)::int AS n FROM nodes WHERE connection_id = $1";
    const { rows } = await admin.query<{ n: number }>(sql, status ? [connId, status] : [connId]);
    return one(rows).n;
  };
  const edgeCount = async (): Promise<number> => {
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM edges WHERE org_id = $1",
      [orgId],
    );
    return one(rows).n;
  };
  const snapshotCount = async (): Promise<number> => {
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM raw_snapshots WHERE org_id = $1",
      [orgId],
    );
    return one(rows).n;
  };

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
          [`sr-${randomUUID().slice(0, 8)}`],
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

  const r1 = { externalId: "r1", urn: "urn:mock:r1", kind: "mock.resource", name: "R1" };
  const r2 = {
    externalId: "r2",
    urn: "urn:mock:r2",
    kind: "mock.resource",
    name: "R2",
    edges: [{ type: "CONNECTS_TO", toUrn: "urn:mock:r1" }],
  };

  it("persists nodes + observed edges, idempotently", async () => {
    const mock = new MockConnector([{ key: "s1", resources: [r1, r2] }]);
    const res1 = await runStagedSync(deps(), mock, conn(), await newRun());
    expect(res1.status).toBe("succeeded");
    expect(res1.stats.persisted).toBe(2);
    expect(res1.stats.edges).toBe(1);
    expect(await count("active")).toBe(2);
    expect(await edgeCount()).toBe(1);

    // Re-run: upsert by URN / uq_edge → no duplicates.
    const res2 = await runStagedSync(deps(), mock, conn(), await newRun());
    expect(res2.status).toBe("succeeded");
    expect(await count()).toBe(2);
    expect(await edgeCount()).toBe(1);
  });

  it("incremental: unchanged content hash skips re-snapshot (docs/06 §6)", async () => {
    const mock = new MockConnector([{ key: "s1", resources: [r1, r2] }]);
    const res1 = await runStagedSync(deps(), mock, conn(), await newRun());
    expect(res1.stats.unchanged).toBe(0);
    expect(await snapshotCount()).toBe(2);

    // Re-run with identical payloads → both unchanged → no new snapshots written.
    const res2 = await runStagedSync(deps(), mock, conn(), await newRun());
    expect(res2.stats.persisted).toBe(2);
    expect(res2.stats.unchanged).toBe(2);
    expect(await snapshotCount()).toBe(2);
  });

  it("reaps resources that disappeared (marks stale on a clean sync)", async () => {
    const mock = new MockConnector([{ key: "s1", resources: [r1, r2] }]);
    await runStagedSync(deps(), mock, conn(), await newRun());
    expect(await count("active")).toBe(2);

    one(mock.scopes).resources = [r1]; // r2 removed at the source
    const res = await runStagedSync(deps(), mock, conn(), await newRun());
    expect(res.status).toBe("succeeded");
    expect(res.stats.staled).toBe(1);
    expect(await count("active")).toBe(1);
    expect(await count("stale")).toBe(1);
  });

  it("BR-SYNC-2: a failed scope never false-deletes (no reconcile on partial)", async () => {
    const control: MockControl = { failingScopes: new Set() };
    const mock = new MockConnector(
      [
        { key: "s1", resources: [r1] },
        { key: "s2", resources: [r2] },
      ],
      control,
    );
    await runStagedSync(deps(), mock, conn(), await newRun());
    expect(await count("active")).toBe(2);

    control.failingScopes.add("s2"); // s2 now errors → r2 not seen this run
    const res = await runStagedSync(deps(), mock, conn(), await newRun());
    expect(res.status).toBe("partial");
    expect(res.failedScopes).toEqual(["s2"]);
    // r2 was NOT seen, but its scope failed → it must NOT be reaped.
    expect(await count("active")).toBe(2);
    expect(await count("stale")).toBe(0);
  });

  it("resumes a partial run, skipping already-completed scopes", async () => {
    const control: MockControl = { failingScopes: new Set(["s2"]) };
    const mock = new MockConnector(
      [
        { key: "s1", resources: [r1] },
        { key: "s2", resources: [r2] },
      ],
      control,
    );
    const run = await newRun();
    const first = await runStagedSync(deps(), mock, conn(), run);
    expect(first.status).toBe("partial");
    expect(first.completedScopes).toEqual(["s1"]);
    expect(mock.discoverCalls.s1).toBe(1);

    control.failingScopes.delete("s2"); // s2 healthy now
    const resumed = await runStagedSync(deps(), mock, conn(), run); // SAME run id
    expect(resumed.status).toBe("succeeded");
    expect(mock.discoverCalls.s1).toBe(1); // s1 skipped on resume (not re-discovered)
    expect(mock.discoverCalls.s2).toBe(2);
    expect(await count("active")).toBe(2);
  });

  // Reaper-race guard (BR-SYNC-2): a stalled-then-reaped run that only NOW finishes must not
  // stale the fresh nodes written by its replacement run.
  const mkRun = async (status: string): Promise<string> =>
    one(
      (
        await admin.query<{ id: string }>(
          `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, 'full', 'manual', $3) RETURNING id`,
          [orgId, connId, status],
        )
      ).rows,
    ).id;
  const seedNode = async (lastRun: string): Promise<void> => {
    await admin.query(
      `INSERT INTO nodes (org_id, connection_id, urn, kind, provider, confidence, status, last_sync_run_id)
       VALUES ($1, $2, 'aws:x:1:lambda/n', 'aws.lambda.function', 'aws', 'observed', 'active', $3)`,
      [orgId, connId, lastRun],
    );
  };

  it("reconcile does NOT stale a replacement run's fresh nodes when this run was reaped", async () => {
    const reaped = await mkRun("failed"); // this run: stalled >15min → reaped to failed
    const replacement = await mkRun("running"); // run B: authoritative, writing fresh nodes
    await seedNode(replacement); // a fresh node stamped by B

    const staled = await reconcileStaleNodes(app, {
      id: reaped,
      orgId,
      connectionId: connId,
      type: "full",
    });

    expect(staled).toBe(0); // guard: reaped run isn't 'running' → EXISTS fails → no-op
    expect(await count("active")).toBe(1); // B's node survives
    expect(await count("stale")).toBe(0);
  });

  it("reconcile stales unobserved nodes when this run is genuinely running", async () => {
    const older = await mkRun("succeeded");
    const current = await mkRun("running"); // this run, authoritative
    await seedNode(older); // node last touched by an older run, not re-observed now

    const staled = await reconcileStaleNodes(app, {
      id: current,
      orgId,
      connectionId: connId,
      type: "full",
    });

    expect(staled).toBe(1);
    expect(await count("stale")).toBe(1);
  });
});
