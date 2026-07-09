"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, DollarSign, Sparkles, MessagesSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AtlasAiMark } from "@/components/brand";
import { cn } from "@/lib/cn";
import { KIND_LOGO, kindIcon } from "@/lib/kind-visual";
import { CloudIcon } from "@/components/cloud-icon";

/**
 * Advisor — Atlas proposes STRUCTURAL changes to the infra (EC2 → ECS + a load balancer, single-AZ
 * → Multi-AZ, …), shown on a map-style canvas: the current architecture vs a proposed one (before /
 * after), each debatable via Ask Atlas (docs/plans/optimization.md).
 *
 * Honesty (P3/P4): the "current" graph is observed truth; the "proposed" graph is a clearly-labelled
 * recommendation (green/dashed "proposed" nodes) — never asserted as reality. Cost numbers need Cost
 * Explorer (Tier 2) and are teased, never fabricated.
 */
type ArchState = "added" | "changed" | "removed";
interface ArchNode {
  id: string;
  label: string;
  kind: string;
  state?: ArchState;
  note?: string;
}
interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  state?: ArchState;
}
export interface Proposal {
  id: string;
  title: string;
  category: "reliability" | "scalability" | "security" | "cost";
  impact: number;
  rationale: string;
  tradeoff: string;
  current: { nodes: ArchNode[]; edges: ArchEdge[] };
  proposed: { nodes: ArchNode[]; edges: ArchEdge[] };
  evidence: string[];
}

const CATEGORY: Record<Proposal["category"], { label: string; badge: string }> = {
  reliability: {
    label: "Reliability",
    badge: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  },
  scalability: {
    label: "Scalability",
    badge: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  },
  security: {
    label: "Security",
    badge: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300",
  },
  cost: {
    label: "Cost",
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  },
};

/** The real resource icon for a kind — the same system the Map uses (AWS logos, else a glyph). */
function NodeLogo({ kind, className }: { kind: string; className: string }) {
  const logo = KIND_LOGO[kind];
  if (logo) return <CloudIcon name={logo} className={className} />;
  const Icon = kindIcon(kind);
  return <Icon className={className} />;
}

const NODE_W = 150;
const NODE_H = 58;
const GAP_X = 52; // room for the connecting arrow
const GAP_Y = 14;

/** Lay the tiny subgraph out left→right by longest-path rank, and place each node at an (x,y). */
function layout(nodes: ArchNode[], edges: ArchEdge[]) {
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges)
      rank.set(e.to, Math.max(rank.get(e.to) ?? 0, (rank.get(e.from) ?? 0) + 1));
  }
  const cols = new Map<number, ArchNode[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    const arr = cols.get(r);
    if (arr) arr.push(n);
    else cols.set(r, [n]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  let maxCol = 0;
  let maxRows = 1;
  for (const [c, list] of cols) {
    maxCol = Math.max(maxCol, c);
    maxRows = Math.max(maxRows, list.length);
    list.forEach((n, r) => pos.set(n.id, { x: c * (NODE_W + GAP_X), y: r * (NODE_H + GAP_Y) }));
  }
  const width = (maxCol + 1) * NODE_W + maxCol * GAP_X;
  const height = maxRows * (NODE_H + GAP_Y) - GAP_Y;
  return { pos, width, height };
}

function ArchMap({
  title,
  nodes,
  edges,
  proposed,
}: {
  title: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  proposed?: boolean;
}) {
  const uid = React.useId().replace(/:/g, "");
  const { pos, width, height } = layout(nodes, edges);
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        proposed ? "border-emerald-500/25 bg-emerald-500/[0.03]" : "border-border bg-muted/20",
      )}
    >
      <div
        className={cn(
          "mb-3 text-[11px] font-semibold uppercase tracking-wide",
          proposed ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div className="overflow-x-auto">
        <div className="relative mx-auto" style={{ width, height, minWidth: width }}>
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={width}
            height={height}
          >
            <defs>
              <marker
                id={`ah-${uid}`}
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto"
              >
                <path d="M0,0 L7,3.5 L0,7 Z" className="fill-muted-foreground/70" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const s = pos.get(e.from);
              const t = pos.get(e.to);
              if (!s || !t) return null;
              const x1 = s.x + NODE_W;
              const y1 = s.y + NODE_H / 2;
              const x2 = t.x - 2;
              const y2 = t.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                  fill="none"
                  className={cn(
                    "stroke-[1.5]",
                    e.state === "added" ? "stroke-emerald-500/60" : "stroke-muted-foreground/40",
                  )}
                  strokeDasharray={e.state === "added" ? "4 3" : undefined}
                  markerEnd={`url(#ah-${uid})`}
                />
              );
            })}
          </svg>
          {nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const added = n.state === "added";
            return (
              <div
                key={n.id}
                className={cn(
                  "absolute flex items-center gap-2 rounded-lg border bg-background px-2.5 shadow-sm",
                  added
                    ? "border-dashed border-emerald-500/50 bg-emerald-500/[0.06]"
                    : "border-border",
                )}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-md border",
                    added ? "border-emerald-500/30 bg-background" : "border-border bg-muted/40",
                  )}
                >
                  <NodeLogo kind={n.kind} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium leading-tight">
                    {n.label}
                  </span>
                  {n.note ? (
                    <span
                      className={cn(
                        "block truncate text-[10px] leading-tight",
                        added ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                    >
                      {n.note}
                    </span>
                  ) : (
                    <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                      {added ? "proposed" : n.kind.split(".").slice(1).join(" ")}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function discussHref(p: Proposal): string {
  const q = `Walk me through this recommendation: "${p.title}". Why do you suggest it, what's the trade-off vs my current setup, and is it worth it for my estate?`;
  return `/ask?q=${encodeURIComponent(q)}`;
}

export function AdvisorView({ proposals }: { proposals: Proposal[] }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Advisor</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Atlas&apos;s proposals to restructure your infrastructure for reliability, scale, and
          efficiency — your current architecture vs a recommended one, side by side. Argue any of
          them with Atlas.
        </p>
      </div>

      {/* Tier-2 honesty: cost/right-sizing $ numbers need data we don't ingest yet — never guessed. */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
        <DollarSign className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            Cost numbers coming with Cost Explorer.
          </span>{" "}
          Connect AWS Cost Explorer + CloudWatch and each proposal will carry a real $ / month and
          CPU / memory delta. For now, proposals are grounded in your graph with honest, directional
          trade-offs — <span className="font-medium text-foreground">never fabricated figures</span>
          .
        </p>
      </div>

      {proposals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Sparkles className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No architecture proposals right now</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing high-impact to restructure on what Atlas can see. As your estate grows — or
              once you connect Cost Explorer — new proposals will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {proposals.map((p) => {
            const cat = CATEGORY[p.category];
            return (
              <Card key={p.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="space-y-1.5">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                        cat.badge,
                      )}
                    >
                      {cat.label}
                    </span>
                    <h2 className="text-lg font-semibold tracking-tight">{p.title}</h2>
                    <p className="text-sm text-muted-foreground">{p.rationale}</p>
                  </div>

                  {/* Before / after — the current shape vs the recommended one, map-style. */}
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <ArchMap title="Current" nodes={p.current.nodes} edges={p.current.edges} />
                    <ArrowRight className="mx-auto hidden size-5 text-muted-foreground md:block" />
                    <ArchMap
                      title="Proposed"
                      nodes={p.proposed.nodes}
                      edges={p.proposed.edges}
                      proposed
                    />
                  </div>

                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    <span className="font-medium">Trade-off:</span>{" "}
                    <span className="text-muted-foreground">{p.tradeoff}</span>
                  </div>

                  <Link
                    href={discussHref(p)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                  >
                    <AtlasAiMark size={15} className="size-4" />
                    Discuss with Atlas
                    <MessagesSquare className="size-4" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
