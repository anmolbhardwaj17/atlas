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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { MapNode } from "@/lib/map-types";

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
};

/** Certainty accent (docs/09 §3.2) — solid = observed fact, ring = inferred, mono only. */
const CERTAINTY: Record<string, string> = {
  observed: "bg-foreground",
  "inferred-high": "bg-foreground/50",
  "inferred-low": "bg-transparent ring-1 ring-inset ring-muted-foreground/50",
};

/** A resource in the infra map: kind icon + name + region, with a certainty dot. */
export function ResourceNode({ data, selected }: NodeProps) {
  const node = (data as { node: MapNode }).node;
  const Icon = ICON[node.kind] ?? Box;
  const kindShort = node.kind.replace(/^aws\.|^github\.|^external\.|^atlas\./, "");
  const stale = node.status === "stale";

  return (
    <div
      className={cn(
        "flex w-[190px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
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
      <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-tight">{node.name ?? kindShort}</div>
        <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {kindShort}
          {node.region ? ` · ${node.region}` : ""}
        </div>
      </div>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          CERTAINTY[node.confidence] ?? CERTAINTY["inferred-low"],
        )}
        title={node.confidence}
      />
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
