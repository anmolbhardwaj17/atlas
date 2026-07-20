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
export function createPool(connectionString: string, max = 16): Pool {
  const pool = new Pool({
    connectionString,
    keepAlive: true, // fewer idle drops by the pooler
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // Atlas deliberately fans a request's independent reads across several org-scoped
    // connections (separate scopes run in parallel; a single connection serialises queries).
    // A dashboard `summary()` opens ~4 at once and `findingDetail()` ~4 (its blast-radius fan-out is
    // concurrency-capped, H5) — before you count concurrent requests — so pg's default max of 10
    // would queue those and erase the parallelism. `max` is env-tunable (PG_POOL_MAX) so a deploy on
    // a bigger Postgres/pooler can raise it; the default sits under Supabase's session-pooler limit.
    max,
  });
  pool.on("error", (err) => {
    console.error(`[db] idle client error (recovered, not fatal): ${err.message}`);
  });
  return pool;
}

/**
 * Fail-closed boot assertion (security sweep — operational caveat): the ENTIRE tenant-isolation
 * model assumes the app connects as the restricted `atlas_app` role (NOBYPASSRLS, non-superuser),
 * because RLS is simply NOT ENFORCED for a superuser or a BYPASSRLS role. A single fat-fingered
 * `DATABASE_URL` pointing at Supabase's `postgres`/owner would silently disable every org-scope
 * policy at request time with no error — the worst possible failure (R8). So we verify the connected
 * role's attributes at startup and refuse to boot if it can bypass RLS. Migrations/setup scripts use
 * a separate owner URL and don't call this.
 */
export async function assertRestrictedRole(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  const r = rows[0];
  if (!r) {
    throw new Error(
      "DB role assertion failed: could not read the connected role's attributes from pg_roles.",
    );
  }
  if (r.rolsuper || r.rolbypassrls) {
    throw new Error(
      `Refusing to start: connected to Postgres as "${r.current_user}", which is ` +
        `${r.rolsuper ? "a SUPERUSER" : "BYPASSRLS"} — this DISABLES all tenant RLS (R8). ` +
        `Point DATABASE_URL at the restricted atlas_app role (see migration 0002 / setup:app-role).`,
    );
  }
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withOrgScope<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  // orgId always originates from validated auth context (a UUID). Enforce that here so it's safe to
  // inline below — it also catches any caller that would otherwise open an unscoped transaction.
  if (!UUID_RE.test(orgId)) {
    throw new Error(`withOrgScope: orgId must be a UUID (got "${orgId}")`);
  }
  const client = await pool.connect();
  try {
    // BEGIN + set the tenant GUC in a SINGLE round-trip (simple protocol, multi-statement). Each DB
    // round-trip is a full network hop to Postgres, so folding these two saves one hop per scoped
    // op — meaningful when the app and DB aren't co-located. set_config(..., true) keeps it
    // transaction-local (the RLS contract, docs/04 §10); orgId is a validated UUID, safe to inline.
    await client.query(`BEGIN; SELECT set_config('atlas.current_org', '${orgId}', true)`);
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
