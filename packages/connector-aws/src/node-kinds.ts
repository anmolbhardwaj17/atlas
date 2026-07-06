/**
 * AWS node-kind catalog (docs/05 §3.1, docs/06 §4) and the per-kind URN scheme
 * (docs/05 §2.2). Each kind carries the data the URN builder needs: its `type`
 * discriminator and whether it is region- or globally-scoped. This is the single
 * source of truth the connector uses; the matching `node_kinds` rows are seeded in
 * db migration 0008.
 */

/** AWS resources are either region-scoped or globally-scoped (S3/Route53/IAM). */
export type AwsScopeKind = "region" | "global";

export interface AwsKindDescriptor {
  /** Graph node kind (FK to `node_kinds.kind`), e.g. "aws.lambda.function". */
  readonly kind: string;
  /** URN `type` discriminator (docs/05 §2.2), e.g. "lambda". */
  readonly type: string;
  /** Region- vs globally-scoped → drives the URN scope segment. */
  readonly scope: AwsScopeKind;
}

/**
 * The MVP catalog. Keyed by node kind. URN type discriminators follow the documented
 * patterns (docs/05 §2.2): `lambda`, `rds`, `ecs-service`, `sg`, `s3`; the rest are
 * consistent short discriminators introduced for the remaining MVP kinds (§9 additive).
 */
export const AWS_NODE_KINDS = {
  "aws.ec2.instance": { kind: "aws.ec2.instance", type: "ec2", scope: "region" },
  "aws.lambda.function": { kind: "aws.lambda.function", type: "lambda", scope: "region" },
  "aws.ecs.cluster": { kind: "aws.ecs.cluster", type: "ecs-cluster", scope: "region" },
  "aws.ecs.service": { kind: "aws.ecs.service", type: "ecs-service", scope: "region" },
  "aws.ecs.taskdef": { kind: "aws.ecs.taskdef", type: "ecs-taskdef", scope: "region" },
  "aws.ecr.repository": { kind: "aws.ecr.repository", type: "ecr", scope: "region" },
  "aws.logs.group": { kind: "aws.logs.group", type: "logs", scope: "region" },
  "aws.vpc": { kind: "aws.vpc", type: "vpc", scope: "region" },
  "aws.subnet": { kind: "aws.subnet", type: "subnet", scope: "region" },
  "aws.securitygroup": { kind: "aws.securitygroup", type: "sg", scope: "region" },
  "aws.elb": { kind: "aws.elb", type: "elb", scope: "region" },
  "aws.route53.record": { kind: "aws.route53.record", type: "route53", scope: "global" },
  "aws.apigateway": { kind: "aws.apigateway", type: "apigateway", scope: "region" },
  "aws.rds.instance": { kind: "aws.rds.instance", type: "rds", scope: "region" },
  "aws.dynamodb.table": { kind: "aws.dynamodb.table", type: "dynamodb", scope: "region" },
  "aws.s3.bucket": { kind: "aws.s3.bucket", type: "s3", scope: "global" },
  "aws.elasticache.cluster": {
    kind: "aws.elasticache.cluster",
    type: "elasticache",
    scope: "region",
  },
  "aws.iam.role": { kind: "aws.iam.role", type: "iam-role", scope: "global" },
  "aws.iam.policy": { kind: "aws.iam.policy", type: "iam-policy", scope: "global" },
} as const satisfies Record<string, AwsKindDescriptor>;

/** Union of all AWS node kinds the connector can emit. */
export type AwsNodeKind = keyof typeof AWS_NODE_KINDS;

export const AWS_NODE_KIND_LIST: readonly AwsKindDescriptor[] = Object.values(AWS_NODE_KINDS);

export function describeKind(kind: AwsNodeKind): AwsKindDescriptor {
  return AWS_NODE_KINDS[kind];
}
