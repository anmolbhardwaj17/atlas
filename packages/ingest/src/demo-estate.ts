/**
 * Demo estate + reusable seeder (P1.2, docs/09 §8). Populates an org's graph with a
 * realistic "Shopyard" e-commerce estate by driving the ACTUAL pipeline
 * (MockConnector → runStagedSync → runInference), so everything is constraint-correct
 * and exercises the real code paths — no cloud credentials required. This is what backs
 * both the `seed:demo` CLI script and the gated `POST /demo/seed` API endpoint (the
 * onboarding "Load sample data" button → TTFI < 30 min without creds, NFR-22).
 *
 * Idempotent: re-running upserts by URN into a single "Demo data (seeded)" connection,
 * so no duplicates and no false deletes (all nodes are re-seen each run).
 */
import type { Connection, ConnectorLogger, Signal } from "@atlas/connector-sdk";
import { withOrgScope, type Db } from "@atlas/db";
import { runInference, ALL_RULES } from "@atlas/inference";
import { runStagedSync, type SyncResult } from "./sync-runner";
import { InMemorySnapshotStore } from "./snapshot-store";
import { nullSecretAccessor, silentLogger } from "./runtime";
import { MockConnector, type MockScope, type MockResource } from "./mock-connector";

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

// ── Multi-cloud: a 2nd AWS account (shared data), Azure, and GCP ─────────────
// The demo is a real multi-cloud, multi-account estate. Cross-boundary env references (a
// compute config value pointing at one of these hosts) let R9 stitch it into ONE graph —
// AWS→Azure, Azure→GCP, GCP→AWS(other account) — each flagged crossCloud/crossAccount.
const ACC_DATA = "999988887777";
const awsData = (short: string, name: string): string =>
  `aws:us-east-1:${ACC_DATA}:${short}/${name}`;
const RDS_ANALYTICS = awsData("rds", "analytics-db");
const ANALYTICS_HOST = "analytics-db.ro.us-east-1.rds.amazonaws.com";

const AZ_SUB = "sub-acme-prod";
const az = (short: string, name: string): string => `azure:eastus:${AZ_SUB}:${short}/${name}`;
const AZ_SQL = az("sql", "customer-db");
const AZ_SQL_HOST = "customer-db.database.windows.net";
const AZ_FN = az("function", "profile-sync");

const GCP_PROJ = "acme-ml";
const gcpUrn = (short: string, name: string): string =>
  `gcp:us-central1:${GCP_PROJ}:${short}/${name}`;
const GCP_SQL = gcpUrn("cloudsql", "ml-features");
const GCP_SQL_CONN = "acme-ml:us-central1:ml-features";
const GCP_RUN = gcpUrn("cloudrun", "recommender");

const envSignal = (
  subjectUrn: string,
  kind: string,
  variables: Record<string, string>,
): Signal[] => [{ kind, subjectUrn, data: { variables } }];

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
    {
      // orders (AWS prod) reads the Azure customer DB → R9 infers a cross-cloud link.
      ...svc("orders", SVC_ORDERS, [
        { type: "STORES_IN", toUrn: RDS_ORDERS },
        { type: "STORES_IN", toUrn: DDB_CARTS },
        { type: "CONNECTS_TO", toUrn: LAMBDA_RECEIPT },
        { type: "DEPENDS_ON", toUrn: ROLE_ORDERS },
      ]),
      signals: envSignal(SVC_ORDERS, "aws.ecs.env", {
        CUSTOMER_DB: `Server=${AZ_SQL_HOST};Database=customers`,
      }),
    },
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

const deploySignal = (wfUrn: string, repoUrn: string, service: string): Signal[] => [
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

// ── Staging estate (a second environment, in a second region) ─────────────────
// A compact staging slice in us-west-2 so the map visibly separates environments
// (prod vs staging) AND regions (us-east-1 vs us-west-2). Its ECS cluster is named
// "staging" so the prod deploy signals (cluster "prod") never ambiguously match it.
const RG2 = "us-west-2";
const awsW = (short: string, name: string): string => `aws:${RG2}:${ACC}:${short}/${name}`;
const S_VPC = awsW("vpc", "staging-vpc");
const S_SG = awsW("sg", "staging-sg-data");
const S_CLUSTER = awsW("ecs-cluster", "staging");
const S_SVC_ORDERS = awsW("ecs-service", "staging-orders");
const S_RDS = awsW("rds", "staging-orders-db");

const stagingScope: MockScope = {
  key: "aws:us-west-2",
  resources: [
    node(S_VPC, "aws.vpc", "staging-vpc"),
    node(S_SG, "aws.securitygroup", "staging-sg-data"),
    node(S_CLUSTER, "aws.ecs.cluster", "staging", [{ type: "CONTAINS", toUrn: S_SVC_ORDERS }]),
    svc("staging-orders", S_SVC_ORDERS, [{ type: "STORES_IN", toUrn: S_RDS }], {
      cluster: "staging",
      region: RG2,
    }),
    node(S_RDS, "aws.rds.instance", "staging-orders-db", [], { engine: "postgres" }),
  ],
};

/**
 * Stamp an environment + account + region onto every resource in a scope (in `attributes`,
 * which the runner promotes to the `region`/`account_ref` columns and `inferEnvironment`
 * reads). Existing per-resource `region` (e.g. on services) is preserved.
 */
function stampEnv(
  scope: MockScope,
  environment: string,
  account: string,
  region: string,
): MockScope {
  return {
    ...scope,
    resources: scope.resources.map((r) => ({
      ...r,
      attributes: {
        ...r.attributes,
        environment,
        accountRef:
          typeof r.attributes?.accountRef === "string" ? r.attributes.accountRef : account,
        region: typeof r.attributes?.region === "string" ? r.attributes.region : region,
      },
    })),
  };
}

// ── 2nd AWS account (shared "data" account), Azure, GCP ─────────────────────
// Referenced cross-boundary by prod AWS / GCP / Azure compute above → R9 stitches them.
const dataAccountScope: MockScope = {
  key: "aws:data-account",
  resources: [
    node(RDS_ANALYTICS, "aws.rds.instance", "analytics-db", [], {
      engine: "postgres",
      endpointAddress: ANALYTICS_HOST,
      multiAz: true,
    }),
  ],
};

const azureScope: MockScope = {
  key: "azure:eastus",
  resources: [
    node(AZ_SQL, "azure.sql.database", "customer-db", [], {
      fullyQualifiedDomainName: AZ_SQL_HOST,
    }),
    {
      // profile-sync (Azure) reads GCP Cloud SQL → cross-cloud link (Azure → GCP).
      ...node(AZ_FN, "azure.function", "profile-sync"),
      signals: envSignal(AZ_FN, "azure.function.env", { FEATURES_DB: GCP_SQL_CONN }),
    },
  ],
};

const gcpScope: MockScope = {
  key: "gcp:us-central1",
  resources: [
    node(GCP_SQL, "gcp.cloudsql.instance", "ml-features", [], { connectionName: GCP_SQL_CONN }),
    {
      // recommender (GCP) reads the AWS data-account analytics DB → cross-cloud + cross-account.
      ...node(GCP_RUN, "gcp.cloudrun", "recommender"),
      signals: envSignal(GCP_RUN, "gcp.cloudrun.env", { ANALYTICS_DB: ANALYTICS_HOST }),
    },
  ],
};

// ── Bitbucket estate (a second code host) ────────────────────────────────────
const bb = (kind: string, name: string): string => `bitbucket:acme:${kind}/${name}`;
const BB_PROJECT = bb("project", "platform");
const BB_REPO_MOBILE = bb("repository", "mobile-app");
const BB_REPO_DATA = bb("repository", "data-pipeline");
const BB_PIPE_MOBILE = bb("pipeline", "mobile-deploy");
const BB_PR = bb("pullrequest", "mobile-231");
const BB_USER = bb("user", "diego");

const bitbucketScope: MockScope = {
  key: "bitbucket:acme",
  resources: [
    node(BB_PROJECT, "bitbucket.project", "platform", [
      { type: "CONTAINS", toUrn: BB_REPO_MOBILE },
      { type: "CONTAINS", toUrn: BB_REPO_DATA },
    ]),
    node(BB_REPO_MOBILE, "bitbucket.repository", "mobile-app", [
      { type: "CONTAINS", toUrn: BB_PIPE_MOBILE },
      { type: "OWNED_BY", toUrn: BB_USER },
    ]),
    node(BB_REPO_DATA, "bitbucket.repository", "data-pipeline", [
      { type: "OWNED_BY", toUrn: BB_USER },
    ]),
    node(BB_PIPE_MOBILE, "bitbucket.pipeline", "mobile-deploy"),
    node(BB_PR, "bitbucket.pullrequest", "mobile#231 — offline mode", [
      { type: "OWNED_BY", toUrn: BB_USER },
    ]),
    node(BB_USER, "bitbucket.user", "diego"),
  ],
};

/**
 * The full estate: AWS prod (us-east-1) + staging (us-west-2) + a shared data account,
 * plus Azure, GCP, GitHub, and Bitbucket — one multi-cloud, multi-account, multi-source graph.
 */
export const DEMO_SCOPES: readonly MockScope[] = [
  stampEnv(awsScope, "prod", ACC, RG),
  stampEnv(stagingScope, "staging", ACC, RG2),
  stampEnv(dataAccountScope, "prod", ACC_DATA, "us-east-1"),
  stampEnv(azureScope, "prod", AZ_SUB, "eastus"),
  stampEnv(gcpScope, "prod", GCP_PROJ, "us-central1"),
  githubScope,
  bitbucketScope,
];

/** Legacy single-connection name (kept for cleanup on re-seed). Demo connections now end "(demo)". */
export const DEMO_CONNECTION_NAME = "Demo data (seeded)";

/** One demo connection per provider, so the Integrations hub shows each source connected. */
const PROVIDER_CONNECTIONS: { provider: string; name: string }[] = [
  { provider: "aws", name: "Amazon Web Services (demo)" },
  { provider: "azure", name: "Microsoft Azure (demo)" },
  { provider: "gcp", name: "Google Cloud (demo)" },
  { provider: "github", name: "GitHub (demo)" },
  { provider: "bitbucket", name: "Bitbucket (demo)" },
];

/** Demo teammates seeded so the Settings members panel + activity log look real. */
const DEMO_MEMBERS: { email: string; name: string; role: "Owner" | "Admin" | "Member" }[] = [
  { email: "priya@acme.test", name: "Priya Sharma", role: "Admin" },
  { email: "diego@acme.test", name: "Diego Alvarez", role: "Member" },
  { email: "mei@acme.test", name: "Mei Chen", role: "Member" },
  { email: "sam@acme.test", name: "Sam Okafor", role: "Owner" },
  { email: "lena@acme.test", name: "Lena Fischer", role: "Member" },
];

export interface DemoSeedDeps {
  db: Db;
  logger?: ConnectorLogger;
}

export interface DemoSeedResult {
  status: SyncResult["status"];
  nodeCount: number;
  observedEdges: number;
  inferredEdges: number;
  signals: number;
}

/**
 * Seed (or re-seed) the Shopyard demo estate into `orgId`. All DB work is org-scoped
 * via `withOrgScope` (RLS-enforced, atlas_app role) — no admin/superuser needed, so the
 * API can call this directly for the authenticated org. Idempotent by URN.
 */
export async function seedDemoData(deps: DemoSeedDeps, orgId: string): Promise<DemoSeedResult> {
  const { db } = deps;
  const logger = deps.logger ?? silentLogger;

  // Retire the legacy single "Demo data (seeded)" connection (its nodes re-attribute below).
  await withOrgScope(db, orgId, (c) =>
    c.query(
      "UPDATE connections SET deleted_at = now(), status = 'disconnected' WHERE display_name = $1 AND deleted_at IS NULL",
      [DEMO_CONNECTION_NAME],
    ),
  );

  // 1. Seed each provider's scopes under its OWN demo connection, so the Integrations hub
  //    shows AWS / Azure / GCP / GitHub / Bitbucket each connected with its own data.
  let status: SyncResult["status"] = "succeeded";
  let signals = 0;
  for (const pc of PROVIDER_CONNECTIONS) {
    const scopes = DEMO_SCOPES.filter((s) => (s.key.split(":")[0] ?? "") === pc.provider);
    if (scopes.length === 0) continue;
    const connectionId = await ensureConnection(db, orgId, pc.provider, pc.name);
    const runId = await createRun(db, orgId, connectionId);
    const connection: Connection = {
      id: connectionId,
      orgId,
      provider: pc.provider,
      displayName: pc.name,
      config: {},
      secretRef: null,
    };
    const result = await runStagedSync(
      { db, snapshots: new InMemorySnapshotStore(), secrets: nullSecretAccessor, logger },
      new MockConnector(scopes.map((s) => ({ ...s }))),
      connection,
      { id: runId, orgId, connectionId, type: "full" },
    );
    if (result.status !== "succeeded") status = result.status;
    signals += result.stats.signals;
  }

  // 2. Inference across ALL providers → cross-cloud/service edges (one graph).
  await runInference({ db, logger }, orgId, ALL_RULES);

  // 3. Seed teammates + an activity log so those UIs look real.
  await seedMembers(db, orgId);
  await seedActivity(db, orgId);

  // 4. Report the resulting graph size (org-scoped counts).
  return withOrgScope(db, orgId, async (c) => {
    const nodes = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM nodes WHERE status <> 'deleted'",
    );
    const edges = await c.query<{ origin: string; n: number }>(
      "SELECT origin, count(*)::int AS n FROM edges WHERE status = 'active' GROUP BY origin",
    );
    const observedEdges = edges.rows.find((r) => r.origin === "observed")?.n ?? 0;
    const inferredEdges = edges.rows
      .filter((r) => r.origin !== "observed")
      .reduce((sum, r) => sum + r.n, 0);
    return {
      status,
      nodeCount: nodes.rows[0]?.n ?? 0,
      observedEdges,
      inferredEdges,
      signals,
    };
  });
}

/** Idempotent connection by display_name (per provider). */
async function ensureConnection(
  db: Db,
  orgId: string,
  provider: string,
  name: string,
): Promise<string> {
  return withOrgScope(db, orgId, async (c) => {
    const existing = await c.query<{ id: string }>(
      "SELECT id FROM connections WHERE display_name = $1 AND deleted_at IS NULL LIMIT 1",
      [name],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const { rows } = await c.query<{ id: string }>(
      // `config.demo` marks these as sample connections so the UI can skip them in the
      // Fetch-latest flow (no real credentials → they'd only ever say "reconnect").
      `INSERT INTO connections (org_id, provider, display_name, status, config)
       VALUES ($1, $2, $3, 'connected', '{"demo":true}'::jsonb) RETURNING id`,
      [orgId, provider, name],
    );
    return firstId(rows);
  });
}

async function createRun(db: Db, orgId: string, connectionId: string): Promise<string> {
  return withOrgScope(db, orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
       VALUES ($1, $2, 'full', 'manual', 'queued') RETURNING id`,
      [orgId, connectionId],
    );
    return firstId(rows);
  });
}

/** Seed demo teammates (users + memberships). Idempotent by email / (org,user). */
async function seedMembers(db: Db, orgId: string): Promise<void> {
  await withOrgScope(db, orgId, async (c) => {
    for (const m of DEMO_MEMBERS) {
      const u = await c.query<{ id: string }>(
        `INSERT INTO users (email, name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [m.email, m.name],
      );
      const userId = u.rows[0]?.id;
      if (!userId) continue;
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1, $2, $3, 'active')
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [orgId, userId, m.role],
      );
    }
  });
}

/** Seed a realistic activity log (append-only). Guarded so re-seeding doesn't duplicate. */
async function seedActivity(db: Db, orgId: string): Promise<void> {
  await withOrgScope(db, orgId, async (c) => {
    const seeded = await c.query(
      "SELECT 1 FROM audit_events WHERE org_id = $1 AND request_id = 'demo' LIMIT 1",
      [orgId],
    );
    if (seeded.rows[0]) return;

    const members = (
      await c.query<{ id: string; email: string }>(
        "SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1",
        [orgId],
      )
    ).rows;
    const idOf = (email: string): string | null =>
      members.find((m) => m.email === email)?.id ?? null;

    const events: {
      actor: string | null;
      action: string;
      targetType: string;
      targetId: string;
      hours: number;
      metadata?: Record<string, unknown>;
    }[] = [
      {
        actor: idOf("sam@acme.test"),
        action: "org.create",
        targetType: "org",
        targetId: orgId,
        hours: 132,
      },
      {
        actor: idOf("priya@acme.test"),
        action: "invitation.create",
        targetType: "invitation",
        targetId: "inv-diego",
        hours: 108,
        metadata: { email: "diego@acme.test", role: "Member" },
      },
      {
        actor: idOf("diego@acme.test"),
        action: "demo.seed",
        targetType: "org",
        targetId: orgId,
        hours: 96,
        metadata: { nodeCount: 52 },
      },
      {
        actor: idOf("mei@acme.test"),
        action: "connection.verify",
        targetType: "connection",
        targetId: "conn-aws",
        hours: 72,
        metadata: { provider: "aws", status: "connected" },
      },
      {
        actor: idOf("sam@acme.test"),
        action: "connection.verify",
        targetType: "connection",
        targetId: "conn-azure",
        hours: 50,
        metadata: { provider: "azure", status: "connected" },
      },
      {
        actor: idOf("priya@acme.test"),
        action: "member.role_change",
        targetType: "user",
        targetId: idOf("mei@acme.test") ?? "u",
        hours: 28,
        metadata: { newRole: "Member" },
      },
      {
        actor: idOf("lena@acme.test"),
        action: "invitation.create",
        targetType: "invitation",
        targetId: "inv-new",
        hours: 5,
        metadata: { email: "newhire@acme.test", role: "Member" },
      },
      {
        actor: idOf("mei@acme.test"),
        action: "connection.disconnect",
        targetType: "connection",
        targetId: "conn-old",
        hours: 1,
        metadata: { provider: "github" },
      },
    ];

    for (const e of events) {
      await c.query(
        `INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, metadata, request_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'demo', now() - ($7 || ' hours')::interval)`,
        [
          orgId,
          e.actor,
          e.action,
          e.targetType,
          e.targetId,
          JSON.stringify(e.metadata ?? {}),
          e.hours,
        ],
      );
    }
  });
}

function firstId(rows: Array<{ id: string }>): string {
  const row = rows[0];
  if (!row) throw new Error("expected an inserted row with id");
  return row.id;
}
