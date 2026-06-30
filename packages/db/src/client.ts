import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema";

export type Db = Kysely<Database>;

/** Create a Kysely client for the given Postgres connection string. */
export function createDb(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
}

/**
 * Run `fn` inside a transaction scoped to a single organization (docs/04 §10,
 * docs/12 §4). Drops to the restricted `atlas_app` role and sets the
 * `atlas.current_org` GUC so PostgreSQL RLS enforces tenant isolation — the
 * backstop beneath app-layer org scoping. Both settings are transaction-local.
 *
 * This is our isolation model (org-scoped, system-written), NOT Supabase's
 * `auth.uid()` pattern.
 */
export async function withOrgScope<T>(
  db: Db,
  orgId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE atlas_app`.execute(trx);
    await sql`SELECT set_config('atlas.current_org', ${orgId}, true)`.execute(trx);
    return fn(trx);
  });
}
