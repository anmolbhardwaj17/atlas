// Node-kind controlled vocabulary seed (docs/05 §3). `node_kinds` is global reference
// data (BR-NODE-2 / docs/04 §5.3); every `nodes.kind` FKs to it, so the catalog must
// exist before any connector can persist a node. Adding a kind is purely additive
// (a data insert, docs/04 DD-1 / docs/06 §9) — no schema change.
//
// Seeds the full MVP catalog: AWS (docs/05 §3.1 / docs/06 §4), GitHub (§3.2 / docs/07),
// and the Atlas-derived logical service (§3.3, materialized by inference G1). Idempotent
// (ON CONFLICT DO NOTHING) so re-running is a no-op.

interface KindSeed {
  kind: string;
  provider: "aws" | "github" | "atlas";
  category: string;
  description: string;
}

// docs/05 §3.1 — AWS MVP node kinds.
const AWS_KINDS: KindSeed[] = [
  {
    kind: "aws.ec2.instance",
    provider: "aws",
    category: "compute",
    description: "EC2 virtual machine instance",
  },
  {
    kind: "aws.lambda.function",
    provider: "aws",
    category: "compute",
    description: "Lambda serverless function",
  },
  { kind: "aws.ecs.cluster", provider: "aws", category: "compute", description: "ECS cluster" },
  {
    kind: "aws.ecs.service",
    provider: "aws",
    category: "compute",
    description: "ECS service (long-running task set)",
  },
  {
    kind: "aws.ecs.taskdef",
    provider: "aws",
    category: "compute",
    description: "ECS task definition (container spec)",
  },
  {
    kind: "aws.ecr.repository",
    provider: "aws",
    category: "compute",
    description: "ECR container image repository",
  },
  {
    kind: "aws.vpc",
    provider: "aws",
    category: "networking",
    description: "Virtual Private Cloud network",
  },
  { kind: "aws.subnet", provider: "aws", category: "networking", description: "VPC subnet" },
  {
    kind: "aws.securitygroup",
    provider: "aws",
    category: "networking",
    description: "Security group (stateful firewall)",
  },
  {
    kind: "aws.elb",
    provider: "aws",
    category: "networking",
    description: "Elastic Load Balancer (ALB/NLB)",
  },
  {
    kind: "aws.route53.record",
    provider: "aws",
    category: "networking",
    description: "Route53 DNS record set",
  },
  {
    kind: "aws.apigateway",
    provider: "aws",
    category: "networking",
    description: "API Gateway REST/HTTP API",
  },
  {
    kind: "aws.rds.instance",
    provider: "aws",
    category: "data",
    description: "RDS relational database instance",
  },
  { kind: "aws.dynamodb.table", provider: "aws", category: "data", description: "DynamoDB table" },
  { kind: "aws.s3.bucket", provider: "aws", category: "data", description: "S3 bucket" },
  {
    kind: "aws.elasticache.cluster",
    provider: "aws",
    category: "data",
    description: "ElastiCache cluster (Redis/Memcached)",
  },
  {
    kind: "aws.iam.role",
    provider: "aws",
    category: "identity",
    description: "IAM role (assumed by compute, edges only)",
  },
  {
    kind: "aws.iam.policy",
    provider: "aws",
    category: "identity",
    description: "IAM policy (statements, edges only)",
  },
];

// docs/05 §3.2 — GitHub MVP node kinds (seeded now; consumed by I2).
const GITHUB_KINDS: KindSeed[] = [
  {
    kind: "github.repository",
    provider: "github",
    category: "scm",
    description: "GitHub repository",
  },
  {
    kind: "github.pull_request",
    provider: "github",
    category: "scm",
    description: "GitHub pull request",
  },
  {
    kind: "github.workflow",
    provider: "github",
    category: "scm",
    description: "GitHub Actions workflow",
  },
  { kind: "github.team", provider: "github", category: "scm", description: "GitHub team" },
  {
    kind: "github.user",
    provider: "github",
    category: "scm",
    description: "GitHub user (author/owner ref)",
  },
];

// docs/05 §3.3 — Atlas-synthesized derived node (materialized by inference, G1).
const ATLAS_KINDS: KindSeed[] = [
  {
    kind: "atlas.service",
    provider: "atlas",
    category: "derived",
    description: "Derived logical service (repo + runtime unified)",
  },
];

const ALL_KINDS = [...AWS_KINDS, ...GITHUB_KINDS, ...ATLAS_KINDS];

// One multi-row INSERT … ON CONFLICT DO NOTHING (idempotent). Values are static,
// apostrophe-free literals so a plain string build is safe here.
const values = ALL_KINDS.map(
  (k) => `('${k.kind}', '${k.provider}', '${k.category}', '${k.description}')`,
).join(",\n     ");

export const up: string[] = [
  `INSERT INTO node_kinds (kind, provider, category, description)
   VALUES ${values}
   ON CONFLICT (kind) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM node_kinds WHERE kind IN (${ALL_KINDS.map((k) => `'${k.kind}'`).join(", ")})`,
];
