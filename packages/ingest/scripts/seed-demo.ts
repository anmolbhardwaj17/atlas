/**
 * Demo seed CLI — populates a real org's graph with the "Shopyard" e-commerce estate
 * by driving the ACTUAL pipeline (MockConnector → runStagedSync → runInference). No
 * cloud credentials required. Idempotent: re-running upserts by URN.
 *
 * The estate + seeding logic live in `@atlas/ingest`'s `seedDemoData` (shared with the
 * gated `POST /demo/seed` API endpoint). This script only resolves the target org (which
 * needs a cross-org read → the owner role) and then calls the shared seeder as atlas_app.
 *
 * Run:  corepack pnpm --filter @atlas/ingest run seed:demo
 * Env:  DATABASE_URL (atlas_app role) + DATABASE_URL_MIGRATE (owner). Optional SEED_EMAIL
 *       / SEED_ORG_ID to target a specific org (defaults to the newest org).
 */
import { Pool } from "pg";
import { seedDemoData, consoleLogger } from "@atlas/ingest";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
if (!appUrl || !adminUrl) {
  throw new Error("Set DATABASE_URL (atlas_app) and DATABASE_URL_MIGRATE (owner).");
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: appUrl });
  try {
    const orgId = await resolveOrg(admin);
    const { rows } = await admin.query<{ name: string }>(
      "SELECT name FROM organizations WHERE id = $1",
      [orgId],
    );
    console.log(`▸ Seeding org ${rows[0]?.name ?? "?"} (${orgId})`);

    const result = await seedDemoData({ db: app, logger: consoleLogger }, orgId);
    console.log(
      `✓ Done — ${result.nodeCount} nodes, ${result.observedEdges} observed + ${result.inferredEdges} inferred edges, ${result.signals} signals (sync ${result.status}).`,
    );
  } finally {
    await admin.end();
    await app.end();
  }
}

async function resolveOrg(admin: Pool): Promise<string> {
  if (process.env.SEED_ORG_ID) return process.env.SEED_ORG_ID;
  const email = process.env.SEED_EMAIL;
  if (email) {
    const { rows } = await admin.query<{ id: string }>(
      `SELECT o.id FROM organizations o
         JOIN memberships m ON m.org_id = o.id
         JOIN users u ON u.id = m.user_id
        WHERE lower(u.email) = lower($1)
        ORDER BY m.created_at LIMIT 1`,
      [email],
    );
    if (rows[0]) return rows[0].id;
  }
  const { rows } = await admin.query<{ id: string }>(
    "SELECT id FROM organizations ORDER BY created_at DESC LIMIT 1",
  );
  if (!rows[0]) throw new Error("No organizations found — create an org in the app first.");
  return rows[0].id;
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
