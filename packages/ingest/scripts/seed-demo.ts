/**
 * Demo seed — populates a real org's graph with a realistic "Shopyard" e-commerce
 * estate by driving the ACTUAL pipeline (MockConnector → runStagedSync → runInference),
 * so everything is constraint-correct and exercises the real code paths. No cloud
 * credentials required. Idempotent: re-running upserts by URN.
 *
 * Run:  corepack pnpm --filter @atlas/ingest run seed:demo
 * Env:  DATABASE_URL (atlas_app role) + DATABASE_URL_MIGRATE (owner). Optional SEED_EMAIL
 *       / SEED_ORG_ID to target a specific org (defaults to the newest org).
 */
import { Pool } from "pg";
import type { Connection } from "@atlas/connector-sdk";
import {
  runStagedSync,
  InMemorySnapshotStore,
  nullSecretAccessor,
  silentLogger,
  MockConnector,
  type MockScope,
  type MockResource,
  type SyncRunRecord,
} from "@atlas/ingest";
import { runInference, ALL_RULES } from "@atlas/inference";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
if (!appUrl || !adminUrl) {
  throw new Error("Set DATABASE_URL (atlas_app) and DATABASE_URL_MIGRATE (owner).");
}

const ACC = "123456789012";
const RG = "us-east-1";
const aws = (short: string, name: string): string => `aws:${RG}:${ACC}:${short}/${name}`;
const gh = (kind: string, name: string): string => `github:shopyard:${kind}/${name}`;

// ── AWS estate ────────────────────────────────────────────────────────────────
const VPC = aws("vpc", "prod-vpc");
const SUBNET_A = aws("subnet", "prod-1a");
const SUBNET_B = aws("subnet", "prod-1b");
const SG_WEB = aws("sg", "sg-web");
const SG_APP = aws("sg", "sg-app");
const SG_DATA = aws("sg", "sg-data");
const CLUSTER = aws("ecs-cluster", "prod");
const SVC_GATEWAY = aws("ecs-service", "gateway");
const SVC_ORDERS = aws("ecs-service", "orders");
const SVC_CHECKOUT = aws("ecs-service", "checkout");
const SVC_PAYMENTS = aws("ecs-service", "payments");
const ALB = aws("elb", "public-alb");
const RDS_ORDERS = aws("rds", "orders-db");
const RDS_PAYMENTS = aws("rds", "payments-db");
const CACHE = aws("elasticache", "sessions-cache");
const DDB_CARTS = aws("dynamodb", "carts");
const LAMBDA_RECEIPT = aws("lambda", "receipt-generator");
const LAMBDA_FRAUD = aws("lambda", "fraud-check");
const ROLE_ORDERS = aws("iam-role", "orders-task-role");

// ── GitHub estate ───────────────────────────────────────────────────────────
const REPO_ORDERS = gh("repository", "orders-service");
const REPO_CHECKOUT = gh("repository", "checkout-service");
const REPO_PAYMENTS = gh("repository", "payments-service");
const REPO_INFRA = gh("repository", "platform-infra");
const WF_ORDERS = gh("workflow", "orders-deploy");
const WF_CHECKOUT = gh("workflow", "checkout-deploy");
const WF_PAYMENTS = gh("workflow", "payments-deploy");
const PR_ORDERS = gh("pull_request", "orders-142");
const PR_PAYMENTS = gh("pull_request", "payments-88");
const USER_ANMOL = gh("user", "anmol");
const USER_PRIYA = gh("user", "priya");
const TEAM_PLATFORM = gh("team", "platform");
const PKG_EXPRESS = "external:npm:package:express";
const PKG_STRIPE = "external:npm:package:stripe";

type E = { type: string; toUrn: string };
const svc = (
  name: string,
  urn: string,
  edges: E[],
  extraAttrs: Record<string, unknown> = {},
): MockResource => ({
  externalId: urn,
  urn,
  kind: "aws.ecs.service",
  name,
  attributes: { serviceName: name, cluster: "prod", region: RG, ...extraAttrs },
  edges,
});
const node = (
  urn: string,
  kind: string,
  name: string,
  edges: E[] = [],
  attributes: Record<string, unknown> = {},
): MockResource => ({ externalId: urn, urn, kind, name, edges, attributes });

const awsScope: MockScope = {
  key: "aws:us-east-1",
  resources: [
    node(VPC, "aws.vpc", "prod-vpc", [
      { type: "CONTAINS", toUrn: SUBNET_A },
      { type: "CONTAINS", toUrn: SUBNET_B },
    ]),
    node(SUBNET_A, "aws.subnet", "prod-1a"),
    node(SUBNET_B, "aws.subnet", "prod-1b"),
    node(SG_WEB, "aws.securitygroup", "sg-web"),
    node(SG_APP, "aws.securitygroup", "sg-app"),
    node(SG_DATA, "aws.securitygroup", "sg-data"),
    node(CLUSTER, "aws.ecs.cluster", "prod", [
      { type: "CONTAINS", toUrn: SVC_GATEWAY },
      { type: "CONTAINS", toUrn: SVC_ORDERS },
      { type: "CONTAINS", toUrn: SVC_CHECKOUT },
      { type: "CONTAINS", toUrn: SVC_PAYMENTS },
    ]),
    svc("gateway", SVC_GATEWAY, [
      { type: "CONNECTS_TO", toUrn: SVC_ORDERS },
      { type: "CONNECTS_TO", toUrn: SVC_CHECKOUT },
      { type: "CONNECTS_TO", toUrn: SVC_PAYMENTS },
    ]),
    svc("orders", SVC_ORDERS, [
      { type: "STORES_IN", toUrn: RDS_ORDERS },
      { type: "STORES_IN", toUrn: DDB_CARTS },
      { type: "CONNECTS_TO", toUrn: LAMBDA_RECEIPT },
      { type: "DEPENDS_ON", toUrn: ROLE_ORDERS },
    ]),
    svc("checkout", SVC_CHECKOUT, [
      { type: "CONNECTS_TO", toUrn: SVC_PAYMENTS },
      { type: "STORES_IN", toUrn: CACHE },
    ]),
    svc("payments", SVC_PAYMENTS, [
      { type: "STORES_IN", toUrn: RDS_PAYMENTS },
      { type: "DEPENDS_ON", toUrn: LAMBDA_FRAUD },
    ]),
    node(ALB, "aws.elb", "public-alb", [{ type: "ROUTES_TO", toUrn: SVC_GATEWAY }]),
    node(RDS_ORDERS, "aws.rds.instance", "orders-db", [], { engine: "postgres", multiAz: true }),
    node(RDS_PAYMENTS, "aws.rds.instance", "payments-db", [], {
      engine: "postgres",
      multiAz: true,
    }),
    node(CACHE, "aws.elasticache.cluster", "sessions-cache", [], { engine: "redis" }),
    node(DDB_CARTS, "aws.dynamodb.table", "carts", [], { billingMode: "PAY_PER_REQUEST" }),
    node(LAMBDA_RECEIPT, "aws.lambda.function", "receipt-generator", [], {
      functionName: "receipt-generator",
      runtime: "nodejs20.x",
    }),
    node(LAMBDA_FRAUD, "aws.lambda.function", "fraud-check", [], {
      functionName: "fraud-check",
      runtime: "python3.12",
    }),
    node(ROLE_ORDERS, "aws.iam.role", "orders-task-role"),
  ],
};

const deploySignal = (wfUrn: string, repoUrn: string, service: string): MockResource["signals"] => [
  {
    kind: "github.workflow.deploy",
    subjectUrn: wfUrn,
    data: { repo: repoUrn, targets: [{ kind: "ecs", cluster: "prod", service }] },
  },
];

const githubScope: MockScope = {
  key: "github:shopyard",
  resources: [
    node(REPO_ORDERS, "github.repository", "orders-service", [
      { type: "CONTAINS", toUrn: WF_ORDERS },
      { type: "OWNED_BY", toUrn: TEAM_PLATFORM },
      { type: "DEPENDS_ON_PKG", toUrn: PKG_EXPRESS },
    ]),
    node(REPO_CHECKOUT, "github.repository", "checkout-service", [
      { type: "CONTAINS", toUrn: WF_CHECKOUT },
      { type: "OWNED_BY", toUrn: USER_ANMOL },
    ]),
    node(REPO_PAYMENTS, "github.repository", "payments-service", [
      { type: "CONTAINS", toUrn: WF_PAYMENTS },
      { type: "OWNED_BY", toUrn: USER_PRIYA },
      { type: "DEPENDS_ON_PKG", toUrn: PKG_STRIPE },
    ]),
    node(REPO_INFRA, "github.repository", "platform-infra", [
      { type: "OWNED_BY", toUrn: TEAM_PLATFORM },
    ]),
    {
      ...node(WF_ORDERS, "github.workflow", "orders-deploy"),
      signals: deploySignal(WF_ORDERS, REPO_ORDERS, "orders"),
    },
    {
      ...node(WF_CHECKOUT, "github.workflow", "checkout-deploy"),
      signals: deploySignal(WF_CHECKOUT, REPO_CHECKOUT, "checkout"),
    },
    {
      ...node(WF_PAYMENTS, "github.workflow", "payments-deploy"),
      signals: deploySignal(WF_PAYMENTS, REPO_PAYMENTS, "payments"),
    },
    node(PR_ORDERS, "github.pull_request", "orders#142 — add idempotency keys", [
      { type: "OWNED_BY", toUrn: USER_ANMOL },
    ]),
    node(PR_PAYMENTS, "github.pull_request", "payments#88 — retry Stripe webhooks", [
      { type: "OWNED_BY", toUrn: USER_PRIYA },
    ]),
    node(USER_ANMOL, "github.user", "anmol"),
    node(USER_PRIYA, "github.user", "priya"),
    node(TEAM_PLATFORM, "github.team", "platform"),
    node(PKG_EXPRESS, "external.package", "express"),
    node(PKG_STRIPE, "external.package", "stripe"),
  ],
};

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: appUrl });
  try {
    // 1. Resolve the target org.
    const orgId = await resolveOrg(admin);
    const org = await admin.query<{ name: string }>(
      "SELECT name FROM organizations WHERE id = $1",
      [orgId],
    );
    console.log(`▸ Seeding org ${org.rows[0]?.name ?? "?"} (${orgId})`);

    // 2. Ensure a demo connection (idempotent by display_name).
    const displayName = "Demo data (seeded)";
    const existing = await admin.query<{ id: string }>(
      "SELECT id FROM connections WHERE org_id = $1 AND display_name = $2 LIMIT 1",
      [orgId, displayName],
    );
    const connId =
      existing.rows[0]?.id ??
      firstId(
        await admin.query<{ id: string }>(
          `INSERT INTO connections (org_id, provider, display_name, status)
           VALUES ($1, 'aws', $2, 'connected') RETURNING id`,
          [orgId, displayName],
        ),
      );

    // 3. New sync run.
    const runId = firstId(
      await admin.query<{ id: string }>(
        `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
         VALUES ($1, $2, 'full', 'manual', 'queued') RETURNING id`,
        [orgId, connId],
      ),
    );
    const run: SyncRunRecord = { id: runId, orgId, connectionId: connId, type: "full" };

    // 4. Drive the real staged-sync pipeline with the mock connector.
    const connection: Connection = {
      id: connId,
      orgId,
      provider: "aws",
      displayName,
      config: {},
      secretRef: null,
    };
    const connector = new MockConnector([awsScope, githubScope]);
    const result = await runStagedSync(
      {
        db: app,
        snapshots: new InMemorySnapshotStore(),
        secrets: nullSecretAccessor,
        logger: silentLogger,
      },
      connector,
      connection,
      run,
    );
    console.log(
      `▸ Sync ${result.status}: ${result.stats.persisted} nodes, ${result.stats.edges} observed edges, ${result.stats.signals} signals`,
    );

    // 5. Derive inferred edges (DEPLOYS_TO etc.).
    const inf = await runInference({ db: app, logger: silentLogger }, orgId, ALL_RULES);
    console.log(`▸ Inference: ${JSON.stringify(inf)}`);

    // 6. Report.
    const counts = await admin.query<{ origin: string; n: number }>(
      "SELECT origin, count(*)::int AS n FROM edges WHERE org_id = $1 GROUP BY origin ORDER BY origin",
      [orgId],
    );
    const nodeN = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM nodes WHERE org_id = $1 AND status <> 'deleted'",
      [orgId],
    );
    console.log(`✓ Done — ${nodeN.rows[0]?.n} nodes; edges by origin:`, counts.rows);
  } finally {
    await admin.end();
    await app.end();
  }
}

function firstId(res: { rows: Array<{ id: string }> }): string {
  const row = res.rows[0];
  if (!row) throw new Error("expected an inserted row with id");
  return row.id;
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
