/**
 * On-demand sync CLI — run a full connector sync (crawl → OSV vulnerability enrichment →
 * inference) for any company/connection, from the terminal, without the web UI. This is the
 * SAME code path production runs: it builds the real connector registry + encrypted secret
 * broker and invokes `createSyncHandler` (the exact staged-sync → OSV → infer orchestration the
 * in-process/BullMQ worker uses). So "does it work for another company" == "connect them + run this".
 *
 * Usage (from repo root, env from ./.env):
 *   pnpm --filter @atlas/api run sync -- --connection <connectionId>
 *   pnpm --filter @atlas/api run sync -- --org <orgId>            # every connection in the org
 *   pnpm --filter @atlas/api run sync -- --all                    # every connected connection
 *   pnpm --filter @atlas/api run sync -- --all --provider bitbucket
 *
 * Requires SECRET_ENCRYPTION_KEY + DATABASE_URL (the restricted app role, used for the actual
 * org-scoped sync) and DATABASE_URL_MIGRATE (the privileged role, used only to *discover* which
 * connections to sync — `connections` is RLS-protected, so cross-org listing needs the admin role).
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import {
  createSyncHandler,
  DbSecretBroker,
  InMemorySnapshotStore,
  consoleLogger,
  type SecretBroker,
} from "@atlas/ingest";
import { createAwsConnector } from "@atlas/connector-aws";
import { createGithubConnector } from "@atlas/connector-github";
import { createBitbucketConnector } from "@atlas/connector-bitbucket";
import type { Connection, Connector } from "@atlas/connector-sdk";

interface Args {
  connection?: string;
  org?: string;
  all: boolean;
  provider?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { all: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--connection" || v === "-c") a.connection = argv[++i];
    else if (v === "--org" || v === "-o") a.org = argv[++i];
    else if (v === "--provider" || v === "-p") a.provider = argv[++i];
    else if (v === "--all") a.all = true;
  }
  return a;
}

interface Target {
  id: string;
  orgId: string;
  provider: string;
  displayName: string;
}

/** Resolve which connections to sync from the CLI flags. Uses the privileged pool because
 *  `connections` is RLS-protected and this is a cross-org ops read (no single org context). */
async function resolveTargets(db: Pool, a: Args): Promise<Target[]> {
  const where: string[] = ["deleted_at IS NULL"];
  const params: unknown[] = [];
  if (a.connection) {
    params.push(a.connection);
    where.push(`id = $${params.length}`);
  } else if (a.org) {
    params.push(a.org);
    where.push(`org_id = $${params.length}`);
  } else {
    // --all (default): only connections that verified successfully have usable credentials.
    where.push(`status = 'connected'`);
  }
  if (a.provider) {
    params.push(a.provider);
    where.push(`provider = $${params.length}`);
  }
  const { rows } = await db.query<{
    id: string;
    org_id: string;
    provider: string;
    display_name: string;
  }>(
    `SELECT id, org_id, provider, display_name FROM connections
      WHERE ${where.join(" AND ")} ORDER BY created_at`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    provider: r.provider,
    displayName: r.display_name,
  }));
}

async function loadConnection(
  db: Db,
  orgId: string,
  connectionId: string,
): Promise<Connection | null> {
  return withOrgScope(db, orgId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      org_id: string;
      provider: string;
      display_name: string;
      config: Record<string, unknown>;
      secret_ref: string | null;
    }>(
      `SELECT id, org_id, provider, display_name, config, secret_ref
         FROM connections WHERE id = $1 AND deleted_at IS NULL`,
      [connectionId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      orgId: r.org_id,
      provider: r.provider as Connection["provider"],
      displayName: r.display_name,
      config: r.config,
      secretRef: r.secret_ref,
    };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  const key = process.env.SECRET_ENCRYPTION_KEY;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!key) throw new Error("SECRET_ENCRYPTION_KEY is required (durable secret store)");

  const db = new Pool({ connectionString }) as unknown as Db;
  const secrets: SecretBroker = new DbSecretBroker(db, key);

  // Privileged pool for cross-org connection discovery only (RLS bypass). Falls back to the app
  // pool for a single --connection/--org run, but --all needs the admin role to see every tenant.
  const adminUrl = process.env.DATABASE_URL_MIGRATE ?? connectionString;
  const adminDb = new Pool({ connectionString: adminUrl });

  // The real registry — exactly what the API wires (connections.module).
  const registry = new Map<string, Connector>([
    ["aws", createAwsConnector({ secrets })],
    ["github", createGithubConnector({ secrets })],
    ["bitbucket", createBitbucketConnector({ secrets })],
  ]);

  const handler = createSyncHandler({
    db,
    snapshots: new InMemorySnapshotStore(),
    secrets,
    logger: consoleLogger,
    resolveConnector: (provider) => registry.get(provider),
    loadConnection: (orgId, connectionId) => loadConnection(db, orgId, connectionId),
  });

  const targets = await resolveTargets(adminDb, args);
  if (targets.length === 0) {
    console.log("No matching connections. Use --connection <id>, --org <id>, or --all.");
    await adminDb.end();
    await (db as unknown as Pool).end();
    return;
  }

  console.log(`Syncing ${targets.length} connection(s):`);
  for (const t of targets) console.log(`  · ${t.provider}  ${t.displayName}  (${t.id})`);

  for (const t of targets) {
    console.log(`\n=== ${t.provider} / ${t.displayName} ===`);
    // Create the sync_runs row the handler expects (nodes.last_sync_run_id FKs to it). BR-SYNC-1:
    // a unique in-flight index means only one run per connection — skip if one is already running.
    let runId: string;
    try {
      runId = await withOrgScope(db, t.orgId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO sync_runs (id, org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, $3, 'full', 'manual', 'queued') RETURNING id`,
          [randomUUID(), t.orgId, t.id],
        );
        const id = rows[0]?.id;
        if (!id) throw new Error("sync_runs insert returned no id");
        return id;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        console.log("  ⏭  a sync is already in flight for this connection — skipping.");
        continue;
      }
      throw err;
    }

    try {
      await handler({
        id: `sync:${t.orgId}:${t.id}:${runId}`,
        name: "sync",
        data: { orgId: t.orgId, connectionId: t.id, runId, type: "full" },
      });
      console.log(`  ✓ done (run ${runId})`);
    } catch (err) {
      console.error(`  ✗ sync failed: ${(err as Error).message}`);
    }
  }

  await adminDb.end();
  await (db as unknown as Pool).end();
  console.log("\nAll done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
