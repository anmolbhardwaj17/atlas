import { Pool, type PoolClient } from "pg";

/**
 * Postgres access for Atlas — plain `pg`, no ORM/query-builder. Queries are raw
 * parameterized SQL (docs/16 CS-6). Points at Supabase Postgres (session pooler)
 * or any Postgres via DATABASE_URL.
 */

export type Db = Pool;

/**
 * Build the app's Postgres pool. Crucially it attaches an `error` handler: pg emits an
 * `error` event on the Pool when an IDLE pooled client dies (a Supabase pooler dropping or
 * timing out an idle connection - common on the session pooler, especially under the
 * background pollers). With no listener, Node treats that as an unhandled `error` and
 * CRASHES the whole process - which is exactly what took the API down. Here we log it and
 * move on: pg discards the dead client and opens a fresh one on the next query, so a
 * transient DB blip degrades one in-flight request, never the whole server.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    keepAlive: true, // fewer idle drops by the pooler
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error(`[db] idle client error (recovered, not fatal): ${err.message}`);
  });
  return pool;
}

/**
 * Run `fn` inside a transaction scoped to one organization (docs/04 §10, docs/12 §4).
 * Sets the `atlas.current_org` GUC (transaction-local) so PostgreSQL RLS enforces
 * tenant isolation. The connection is rolled back on error and always returned.
 *
 * REQUIRES the pool to be connected as the non-bypass `atlas_app` role (see
 * migration 0002). Connecting as an owner/superuser/BYPASSRLS role would skip RLS.
 * This is our org-scoped isolation model — NOT Supabase's `auth.uid()` pattern.
 */
export async function withOrgScope<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('atlas.current_org', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
