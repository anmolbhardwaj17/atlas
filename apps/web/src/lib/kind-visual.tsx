import {
  Boxes,
  Box,
  Database,
  Server,
  Shield,
  Network,
  Zap,
  Package,
  Globe,
  Key,
  HardDrive,
  Split,
  GitBranch,
  GitPullRequest,
  Play,
  User,
  Users,
  Sparkles,
  Webhook,
  FolderGit2,
  type LucideIcon,
} from "lucide-react";

/**
 * Shared node-kind visuals — the icon + category colour for a kind, used by both the infra
 * map (ResourceNode) and the Explore list so a repo/project/pipeline/PR/person read the same
 * everywhere. Category colour encodes *type* (docs/09 §3.2); code kinds are split so they're
 * distinguishable (container / repo / pipeline / change / people / package).
 */
const ICON: Record<string, LucideIcon> = {
  "aws.vpc": Network,
  "aws.subnet": Network,
  "aws.securitygroup": Shield,
  "aws.ec2.instance": Server,
  "aws.lambda.function": Zap,
  "aws.ecs.cluster": Boxes,
  "aws.ecs.service": Box,
  "aws.ecs.taskdef": Box,
  "aws.ecr.repository": Package,
  "aws.elb": Split,
  "aws.route53.record": Globe,
  "aws.apigateway": Webhook,
  "aws.rds.instance": Database,
  "aws.dynamodb.table": Database,
  "aws.elasticache.cluster": Database,
  "aws.s3.bucket": HardDrive,
  "aws.iam.role": Key,
  "github.repository": GitBranch,
  "github.workflow": Play,
  "github.pull_request": GitPullRequest,
  "github.user": User,
  "github.team": Users,
  "external.package": Package,
  "atlas.service": Sparkles,
  "azure.vm": Server,
  "azure.function": Zap,
  "azure.appservice": Globe,
  "azure.aks.cluster": Boxes,
  "azure.sql.database": Database,
  "azure.postgres": Database,
  "azure.cosmosdb": Database,
  "azure.storage.account": HardDrive,
  "azure.vnet": Network,
  "azure.subnet": Network,
  "azure.loadbalancer": Split,
  "azure.keyvault": Key,
  "gcp.gce.instance": Server,
  "gcp.cloudrun": Boxes,
  "gcp.cloudfunction": Zap,
  "gcp.gke.cluster": Boxes,
  "gcp.cloudsql.instance": Database,
  "gcp.spanner": Database,
  "gcp.firestore": Database,
  "gcp.gcs.bucket": HardDrive,
  "gcp.vpc": Network,
  "gcp.subnet": Network,
  "gcp.pubsub.topic": Webhook,
  "bitbucket.project": FolderGit2,
  "bitbucket.repository": GitBranch,
  "bitbucket.pipeline": Play,
  "bitbucket.pullrequest": GitPullRequest,
  "bitbucket.user": User,
};

const CATEGORY: Record<string, string> = {
  "aws.ec2.instance": "compute",
  "aws.lambda.function": "compute",
  "aws.ecs.cluster": "compute",
  "aws.ecs.service": "compute",
  "aws.ecs.taskdef": "compute",
  "aws.rds.instance": "data",
  "aws.dynamodb.table": "data",
  "aws.elasticache.cluster": "data",
  "aws.s3.bucket": "storage",
  "aws.ecr.repository": "storage",
  "aws.vpc": "network",
  "aws.subnet": "network",
  "aws.elb": "network",
  "aws.route53.record": "network",
  "aws.apigateway": "network",
  "aws.securitygroup": "security",
  "aws.iam.role": "security",
  "github.repository": "repo",
  "github.workflow": "pipeline",
  "github.pull_request": "change",
  "github.team": "people",
  "github.user": "people",
  "external.package": "package",
  "atlas.service": "service",
  "azure.vm": "compute",
  "azure.function": "compute",
  "azure.appservice": "compute",
  "azure.aks.cluster": "compute",
  "azure.sql.database": "data",
  "azure.postgres": "data",
  "azure.cosmosdb": "data",
  "azure.storage.account": "storage",
  "azure.vnet": "network",
  "azure.subnet": "network",
  "azure.loadbalancer": "network",
  "azure.keyvault": "security",
  "gcp.gce.instance": "compute",
  "gcp.cloudrun": "compute",
  "gcp.cloudfunction": "compute",
  "gcp.gke.cluster": "compute",
  "gcp.cloudsql.instance": "data",
  "gcp.spanner": "data",
  "gcp.firestore": "data",
  "gcp.gcs.bucket": "storage",
  "gcp.vpc": "network",
  "gcp.subnet": "network",
  "gcp.pubsub.topic": "compute",
  "bitbucket.project": "container",
  "bitbucket.repository": "repo",
  "bitbucket.pipeline": "pipeline",
  "bitbucket.pullrequest": "change",
  "bitbucket.user": "people",
};

const CATEGORY_STYLE: Record<string, string> = {
  compute: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  data: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  storage: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  network: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  security: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  service: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  container: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  repo: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pipeline: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  change: "bg-green-500/15 text-green-600 dark:text-green-400",
  people: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  package: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const CATEGORY_FALLBACK = "bg-muted text-muted-foreground";

/** Kinds with a real provider service/brand logo (aws services, github mark) — the map uses
 *  these; bitbucket is intentionally NOT here so map nodes keep their per-type colours. */
export const KIND_LOGO: Record<string, string> = {
  "aws.ec2.instance": "aws-ec2",
  "aws.lambda.function": "aws-lambda",
  "aws.ecs.cluster": "aws-ecs",
  "aws.ecs.service": "aws-ecs",
  "aws.ecs.taskdef": "aws-ecs",
  "aws.rds.instance": "aws-rds",
  "aws.dynamodb.table": "aws-dynamodb",
  "aws.elasticache.cluster": "aws-elasticache",
  "aws.s3.bucket": "aws-s3",
  "aws.vpc": "aws-vpc",
  "aws.elb": "aws-elb",
  "aws.route53.record": "aws-route53",
  "aws.apigateway": "aws-api-gateway",
  "aws.iam.role": "aws-iam",
  "github.repository": "github-icon",
};

export function kindCategory(kind: string): string {
  return CATEGORY[kind] ?? "";
}

export function kindIcon(kind: string): LucideIcon {
  return ICON[kind] ?? Box;
}

/** Icon-chip tint classes for a kind's category (from-far type colour). */
export function kindStyle(kind: string): string {
  return CATEGORY_STYLE[CATEGORY[kind] ?? ""] ?? CATEGORY_FALLBACK;
}

/** Short, human kind label — strips the provider prefix (aws./bitbucket./…). */
export function kindShort(kind: string): string {
  return kind.replace(/^aws\.|^github\.|^external\.|^atlas\.|^azure\.|^gcp\.|^bitbucket\./, "");
}
