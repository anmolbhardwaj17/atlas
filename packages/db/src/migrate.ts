import { Kysely, Migrator, PostgresDialect, type Migration, type MigrationProvider } from "kysely";
import { Pool } from "pg";
import * as m0001 from "./migrations/0001_init";
import * as m0002 from "./migrations/0002_rls";

/**
 * Forward-only migration runner (docs/04 §9). Migrations are registered
 * explicitly (no filesystem scanning) so the build is deterministic.
 * Run with: DATABASE_URL=... pnpm --filter @atlas/db run migrate
 */
class StaticMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({
      "0001_init": { up: m0001.up, down: m0001.down },
      "0002_rls": { up: m0002.up, down: m0002.down },
    });
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });

  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`${r.status === "Success" ? "✓" : "✗"} ${r.migrationName} (${r.status})`);
  }

  await db.destroy();
  if (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  }
}

void main();
