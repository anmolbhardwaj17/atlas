import { Pool } from "pg";
import { DbSecretBroker } from "../src/secret-broker";

/**
 * Secret key-rotation re-wrap (compliance close-out). After deploying a new SECRET_ENCRYPTION_KEY
 * (with the previous key moved into SECRET_ENCRYPTION_KEYS_RETIRED so existing secrets still decrypt),
 * run this to re-encrypt every credential onto the new primary key. Once it reports 0 remaining, the
 * retired key can be dropped from the env.
 *
 * Connects as the app role (DATABASE_URL) for the RLS-scoped re-wrap, and as the owner
 * (DATABASE_URL_MIGRATE) only to enumerate which orgs have secrets. Idempotent — safe to re-run.
 *
 *   DATABASE_URL=… DATABASE_URL_MIGRATE=… \
 *   SECRET_ENCRYPTION_KEY=<new> SECRET_ENCRYPTION_KEYS_RETIRED=<old> \
 *   pnpm --filter @atlas/ingest run rotate:secrets
 */
async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL;
  const ownerUrl = process.env.DATABASE_URL_MIGRATE ?? appUrl;
  const primary = process.env.SECRET_ENCRYPTION_KEY;
  const retired = (process.env.SECRET_ENCRYPTION_KEYS_RETIRED ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (!appUrl) throw new Error("DATABASE_URL (atlas_app role) is required.");
  if (!primary) throw new Error("SECRET_ENCRYPTION_KEY (the new primary key) is required.");

  const owner = new Pool({ connectionString: ownerUrl });
  const app = new Pool({ connectionString: appUrl });
  const broker = new DbSecretBroker(app, primary, retired);
  try {
    // Owner read (bypasses RLS) just to list the tenants that hold secrets.
    const { rows } = await owner.query<{ org_id: string }>(
      "SELECT DISTINCT org_id FROM connection_secrets",
    );
    let total = 0;
    for (const { org_id } of rows) {
      const n = await broker.rewrap(org_id); // RLS-scoped, re-keys only non-primary rows
      if (n > 0) console.log(`  ${org_id}: rewrapped ${n}`);
      total += n;
    }
    console.log(`✓ rewrapped ${total} secret(s) across ${rows.length} org(s) onto the primary key.`);
    if (total === 0) console.log("  Nothing left on a retired key — safe to drop it from the env.");
  } finally {
    await app.end();
    await owner.end();
  }
}

main().catch((error: unknown) => {
  console.error("Secret rotation failed:", (error as Error).message);
  process.exitCode = 1;
});
