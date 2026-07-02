"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
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
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";
import type { MapNode } from "@/lib/map-types";

/** Kinds that have a real provider logo (else we fall back to the colored lucide glyph). */
const LOGO: Record<string, string> = {
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
  // Azure
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
  // GCP
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
  // Bitbucket
  "bitbucket.project": FolderGit2,
  "bitbucket.repository": GitBranch,
  "bitbucket.pipeline": Play,
  "bitbucket.pullrequest": GitPullRequest,
  "bitbucket.user": User,
};

/** Certainty accent (docs/09 §3.2) — solid = observed fact, ring = inferred, mono only. */
const CERTAINTY: Record<string, string> = {
  observed: "bg-foreground",
  "inferred-high": "bg-foreground/50",
  "inferred-low": "bg-transparent ring-1 ring-inset ring-muted-foreground/50",
};

/**
 * Icons are colored by *category* (the one place the map departs from mono) so an engineer
 * can read the estate at a glance: compute vs data vs network vs security vs code. Tinted
 * bg + colored glyph, tuned for both themes.
 */
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
  // Azure
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
  // GCP
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
  // Bitbucket
  "bitbucket.project": "container",
  "bitbucket.repository": "repo",
  "bitbucket.pipeline": "pipeline",
  "bitbucket.pullrequest": "change",
  "bitbucket.user": "people",
};

/** Icon-chip tint per category. Code kinds are split (container/repo/pipeline/change/people/
 *  package) so a project, a repo, a pipeline, a PR and a person read as different colours. */
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

/** Collapse state handed to a node that contains others (drill-down). */
export interface CollapseInfo {
  hasChildren: boolean;
  collapsed: boolean;
  hiddenCount: number;
  onToggle: () => void;
}

/** A resource in the infra map: kind icon + name + region, a certainty dot, a coloured
 *  left accent (type at a glance), and a collapse toggle when it contains other nodes. */
export function ResourceNode({ data, selected }: NodeProps) {
  const d = data as { node: MapNode; collapse?: CollapseInfo };
  const node = d.node;
  const collapse = d.collapse;
  const Icon = ICON[node.kind] ?? Box;
  const logo = LOGO[node.kind];
  const kindShort = node.kind.replace(/^aws\.|^github\.|^external\.|^atlas\.|^bitbucket\./, "");
  const stale = node.status === "stale";
  const category = CATEGORY[node.kind] ?? "";
  const iconStyle = CATEGORY_STYLE[category] ?? CATEGORY_FALLBACK;

  return (
    <div
      className={cn(
        "flex w-[190px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-sm",
        "duration-200 animate-in fade-in zoom-in-95",
        "transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-md",
        selected
          ? "border-foreground ring-1 ring-foreground"
          : "border-border hover:border-foreground/40",
        stale && "opacity-60",
      )}
      title={node.urn}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/40"
      />
      <div
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md",
          logo ? "bg-muted/60" : iconStyle,
        )}
      >
        {logo ? <CloudIcon name={logo} className="size-[18px]" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-tight">{node.name ?? kindShort}</div>
        <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {kindShort}
          {node.region ? ` · ${node.region}` : ""}
        </div>
      </div>

      {collapse?.hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            collapse.onToggle();
          }}
          className="nodrag flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          title={collapse.collapsed ? "Expand" : "Collapse"}
          aria-label={collapse.collapsed ? "Expand" : "Collapse"}
        >
          {collapse.collapsed ? (
            <>
              <ChevronRight className="size-3" />
              {collapse.hiddenCount}
            </>
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>
      ) : (
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            CERTAINTY[node.confidence] ?? CERTAINTY["inferred-low"],
          )}
          title={node.confidence}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/40"
      />
    </div>
  );
}

/** The labeled frame behind each environment's resources. Non-interactive. */
export function EnvLaneNode({ data }: NodeProps) {
  const d = data as { label: string; count: number };
  return (
    <div className="size-full rounded-xl border border-dashed border-border/80 bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {d.label}
        </span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {d.count}
        </span>
      </div>
    </div>
  );
}
