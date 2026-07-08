"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, GitPullRequest, Shield } from "lucide-react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";
import { kindIcon, kindStyle, kindShort, KIND_LOGO } from "@/lib/kind-visual";
import type { MapNode } from "@/lib/map-types";

/** Names truncate in the MIDDLE: the distinctive part of infra names is usually the
 *  suffix (calsaws-chat-production-OnConnectFunction vs ...-SendMessageFunction), and
 *  end-truncation made sibling resources visually identical. */
function middleTruncate(name: string, max = 26): string {
  if (name.length <= max) return name;
  const tail = Math.floor((max - 1) / 2);
  const head = max - 1 - tail;
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

/** Certainty accent (docs/09 §3.2) - solid = observed fact, ring = inferred, mono only. */
const CERTAINTY: Record<string, string> = {
  observed: "bg-foreground",
  "inferred-high": "bg-foreground/50",
  "inferred-low": "bg-transparent ring-1 ring-inset ring-muted-foreground/50",
};

/** Collapse state handed to a node that contains others (drill-down). */
export interface CollapseInfo {
  hasChildren: boolean;
  collapsed: boolean;
  hiddenCount: number;
  onToggle: () => void;
}

/** A resource in the infra map: kind icon (colored by type, from `kind-visual`) + name +
 *  region, a certainty dot, and a collapse toggle when it contains other nodes. */
export function ResourceNode({ data, selected }: NodeProps) {
  const d = data as {
    node: MapNode;
    collapse?: CollapseInfo;
    openPrCount?: number;
    /** Security groups protecting this node - protection reads as a chip, not canvas rails. */
    protectedBy?: string[];
    /** Recede this node (Health lens / blast-radius focus dims everything out of scope). */
    dim?: boolean;
  };
  const node = d.node;
  const collapse = d.collapse;
  const openPrs = d.openPrCount ?? 0;
  const protectors = d.protectedBy ?? [];
  const Icon = kindIcon(node.kind);
  const logo = KIND_LOGO[node.kind];
  const short = kindShort(node.kind);
  const stale = node.status === "stale";
  // Runtime health (Phase B): unhealthy → red ring, degraded → amber. Unknown = no ring,
  // never fake green (docs/09 §7).
  const health = node.health ?? null;
  const healthRing =
    health?.state === "unhealthy"
      ? "border-danger ring-1 ring-danger"
      : health?.state === "degraded"
        ? "border-warning ring-1 ring-warning"
        : null;

  return (
    <div
      className={cn(
        "relative flex w-[190px] items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-sm",
        "duration-200 animate-in fade-in zoom-in-95",
        "transition-[transform,box-shadow,border-color,opacity,filter] hover:-translate-y-0.5 hover:shadow-md",
        selected
          ? "border-foreground ring-1 ring-foreground"
          : (healthRing ?? "border-border hover:border-foreground/40"),
        stale && "opacity-60",
        d.dim && "opacity-30 grayscale",
      )}
      title={
        health && health.state !== "healthy"
          ? `${node.urn} - ${health.reason ?? health.state}`
          : node.urn
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/40"
      />
      <div
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md",
          logo ? "bg-muted/60" : kindStyle(node.kind),
        )}
      >
        {logo ? <CloudIcon name={logo} className="size-[18px]" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-tight" title={node.name ?? short}>
          {middleTruncate(node.name ?? short)}
        </div>
        <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {short}
          {node.region ? ` · ${node.region}` : ""}
        </div>
        {health && health.state !== "healthy" ? (
          <span
            className={cn(
              "mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-px text-[9px] font-medium",
              health.state === "unhealthy"
                ? "bg-danger/15 text-danger"
                : "bg-warning/15 text-warning",
            )}
            title={health.reason}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                health.state === "unhealthy" ? "bg-danger" : "bg-warning",
              )}
            />
            <span className="truncate">{health.reason ?? health.state}</span>
          </span>
        ) : null}
        {openPrs > 0 ? (
          <span className="mt-1 inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-px text-[9px] font-medium text-sky-600 dark:text-sky-400">
            <GitPullRequest className="size-2.5" />
            {openPrs} open PR{openPrs > 1 ? "s" : ""}
          </span>
        ) : null}
        {protectors.length > 0 ? (
          <span
            className="ml-1 mt-1 inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground"
            title={`Protected by ${protectors.join(", ")}`}
          >
            <Shield className="size-2.5" />
            {protectors.length}
          </span>
        ) : null}
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
