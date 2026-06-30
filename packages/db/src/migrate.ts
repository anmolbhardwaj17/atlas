import { Client } from "pg";
import { up as up0001 } from "./migrations/0001_init";
import { up as up0002 } from "./migrations/0002_rls";
import { up as up0003 } from "./migrations/0003_auth_resolve";
import { up as up0004 } from "./migrations/0004_identity_rls";
import { up as up0005 } from "./migrations/0005_org_scope";
import { up as up0006 } from "./migrations/0006_connections";

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
