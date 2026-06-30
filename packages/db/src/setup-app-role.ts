import { Client } from "pg";

/**
 * CI/test helper: grant the `atlas_app` role LOGIN + a password so integration
 * tests can connect as the non-bypass app role. Migrations deliberately create
 * `atlas_app` NOLOGIN (its password is provisioned out of band, never in code);
 * this script supplies a throwaway password in ephemeral CI. Run as the owner.
 *
 * Run with: DATABASE_URL_MIGRATE=... ATLAS_APP_PASSWORD=... tsx src/setup-app-role.ts
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
  const password = process.env.ATLAS_APP_PASSWORD;
  if (!connectionString) throw new Error("DATABASE_URL_MIGRATE (or DATABASE_URL) is required");
  if (!password) throw new Error("ATLAS_APP_PASSWORD is required");
  // Password is interpolated into DDL (ALTER ROLE has no bind params), so restrict
  // to a safe charset — this is a CI throwaway, not a real secret.
  if (!/^[A-Za-z0-9_]+$/.test(password)) {
    throw new Error("ATLAS_APP_PASSWORD must match [A-Za-z0-9_]+ (CI helper)");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`ALTER ROLE atlas_app LOGIN PASSWORD '${password}'`);
    console.log("✓ atlas_app: LOGIN granted");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("setup-app-role failed:", (error as Error).message);
  process.exitCode = 1;
});
