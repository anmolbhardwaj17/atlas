import { Client } from "pg";
import { up as up0001 } from "./migrations/0001_init";
import { up as up0002 } from "./migrations/0002_rls";
import { up as up0003 } from "./migrations/0003_auth_resolve";
import { up as up0004 } from "./migrations/0004_identity_rls";
import { up as up0005 } from "./migrations/0005_org_scope";
import { up as up0006 } from "./migrations/0006_connections";
import { up as up0007 } from "./migrations/0007_graph";
import { up as up0008 } from "./migrations/0008_node_kinds_seed";
import { up as up0009 } from "./migrations/0009_external_package";
import { up as up0010 } from "./migrations/0010_signals";
import { up as up0011 } from "./migrations/0011_inference_rules_seed";
import { up as up0012 } from "./migrations/0012_nodes_connection_nullable";
import { up as up0013 } from "./migrations/0013_ai_conversations";
import { up as up0014 } from "./migrations/0014_audit_events";
import { up as up0015 } from "./migrations/0015_connection_org_resolver";
import { up as up0016 } from "./migrations/0016_multicloud";
import { up as up0017 } from "./migrations/0017_more_providers";
import { up as up0018 } from "./migrations/0018_connection_secrets";
import { up as up0019 } from "./migrations/0019_org_llm_config";
import { up as up0020 } from "./migrations/0020_llm_provider_openai";
import { up as up0021 } from "./migrations/0021_due_syncs";
import { up as up0022 } from "./migrations/0022_vulnerability";
import { up as up0023 } from "./migrations/0023_health_targets";
import { up as up0024 } from "./migrations/0024_node_events";
import { up as up0025 } from "./migrations/0025_log_intelligence";
import { up as up0026 } from "./migrations/0026_notifications";
import { up as up0027 } from "./migrations/0027_notification_feed";
import { up as up0028 } from "./migrations/0028_alert_channels";
import { up as up0029 } from "./migrations/0029_notification_node_kind";
import { up as up0030 } from "./migrations/0030_muted_findings";
import { up as up0031 } from "./migrations/0031_finding_state";
import { up as up0032 } from "./migrations/0032_jenkins";
import { up as up0033 } from "./migrations/0033_ai_conversation_origin";
import { up as up0034 } from "./migrations/0034_tag_correlation_seed";
import { up as up0035 } from "./migrations/0035_image_provenance_seed";
import { up as up0036 } from "./migrations/0036_service_env_seed";

/**
 * Forward-only SQL migration runner (docs/04 §9). Plain `pg`, no ORM. Each
 * migration's statements run via the simple query protocol inside one transaction
 * and are recorded in `schema_migrations`. Re-running is a no-op for applied
 * migrations (idempotent).
 *
 * Run with: DATABASE_URL=... pnpm --filter @atlas/db run migrate
 */
const MIGRATIONS: ReadonlyArray<{ version: string; statements: string[] }> = [
  { version: "0001_init", statements: up0001 },
  { version: "0002_rls", statements: up0002 },
  { version: "0003_auth_resolve", statements: up0003 },
  { version: "0004_identity_rls", statements: up0004 },
  { version: "0005_org_scope", statements: up0005 },
  { version: "0006_connections", statements: up0006 },
  { version: "0007_graph", statements: up0007 },
  { version: "0008_node_kinds_seed", statements: up0008 },
  { version: "0009_external_package", statements: up0009 },
  { version: "0010_signals", statements: up0010 },
  { version: "0011_inference_rules_seed", statements: up0011 },
  { version: "0012_nodes_connection_nullable", statements: up0012 },
  { version: "0013_ai_conversations", statements: up0013 },
  { version: "0014_audit_events", statements: up0014 },
  { version: "0015_connection_org_resolver", statements: up0015 },
  { version: "0016_multicloud", statements: up0016 },
  { version: "0017_more_providers", statements: up0017 },
  { version: "0018_connection_secrets", statements: up0018 },
  { version: "0019_org_llm_config", statements: up0019 },
  { version: "0020_llm_provider_openai", statements: up0020 },
  { version: "0021_due_syncs", statements: up0021 },
  { version: "0022_vulnerability", statements: up0022 },
  { version: "0023_health_targets", statements: up0023 },
  { version: "0024_node_events", statements: up0024 },
  { version: "0025_log_intelligence", statements: up0025 },
  { version: "0026_notifications", statements: up0026 },
  { version: "0027_notification_feed", statements: up0027 },
  { version: "0028_alert_channels", statements: up0028 },
  { version: "0029_notification_node_kind", statements: up0029 },
  { version: "0030_muted_findings", statements: up0030 },
  { version: "0031_finding_state", statements: up0031 },
  { version: "0032_jenkins", statements: up0032 },
  { version: "0033_ai_conversation_origin", statements: up0033 },
  { version: "0034_tag_correlation_seed", statements: up0034 },
  { version: "0035_image_provenance_seed", statements: up0035 },
  { version: "0036_service_env_seed", statements: up0036 },
];

async function main(): Promise<void> {
  // Migrations run as the OWNER role (e.g. Supabase `postgres`), which can do DDL.
  // The app uses DATABASE_URL (the restricted atlas_app role); prefer the dedicated
  // migration URL when present.
  const connectionString = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL_MIGRATE (or DATABASE_URL) is required to run migrations");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        console.log(`= ${migration.version} (already applied)`);
        continue;
      }
      await client.query("BEGIN");
      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
          migration.version,
        ]);
        await client.query("COMMIT");
        console.log(`✓ ${migration.version}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error(`✗ ${migration.version}:`, (error as Error).message);
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", (error as Error).message);
  process.exitCode = 1;
});
