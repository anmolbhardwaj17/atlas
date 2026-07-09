"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, DollarSign, Sparkles, MessagesSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AtlasAiMark } from "@/components/brand";
import { cn } from "@/lib/cn";

/**
 * Advisor — Atlas proposes STRUCTURAL changes to the infra (EC2 → ECS + a load balancer, single-AZ
 * → Multi-AZ, …), shown as the current architecture vs a proposed one (before / after), each
 * debatable via Ask Atlas (docs/plans/optimization.md).
 *
 * Honesty (P3/P4): the "current" graph is observed truth; the "proposed" graph is a clearly-labelled
 * recommendation (ghosted/green "proposed" nodes) — never asserted as reality. Cost numbers need
 * Cost Explorer (Tier 2) and are teased, never fabricated.
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

/** Layer the tiny subgraph into columns by longest-path rank (roots → leaves). */
function columns(nodes: ArchNode[], edges: ArchEdge[]): ArchNode[][] {
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) {
      rank.set(e.to, Math.max(rank.get(e.to) ?? 0, (rank.get(e.from) ?? 0) + 1));
    }
  }
  const max = Math.max(0, ...Array.from(rank.values()));
  const cols: ArchNode[][] = Array.from({ length: max + 1 }, () => []);
  for (const n of nodes) (cols[rank.get(n.id) ?? 0] as ArchNode[]).push(n);
  return cols;
}

function Chip({ node }: { node: ArchNode }) {
  const s = node.state;
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-center",
        !s && "border-border bg-background",
        s === "added" &&
          "border-dashed border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
        s === "changed" && "border-amber-500/50 bg-amber-500/5 text-amber-700 dark:text-amber-400",
        s === "removed" && "border-red-500/40 bg-red-500/5 text-red-600 line-through",
      )}
    >
      <div className="text-xs font-medium leading-tight">{node.label}</div>
      {node.note ? <div className="text-[10px] leading-tight opacity-70">{node.note}</div> : null}
    </div>
  );
}

function MiniGraph({
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
  const cols = columns(nodes, edges);
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        proposed ? "border-emerald-500/25 bg-emerald-500/[0.03]" : "border-border bg-muted/20",
      )}
    >
      <div
        className={cn(
          "mb-2.5 text-[11px] font-semibold uppercase tracking-wide",
          proposed ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {cols.map((col, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <ArrowRight className="size-4 shrink-0 text-muted-foreground" /> : null}
            <div className="flex flex-col gap-2">
              {col.map((n) => (
                <Chip key={n.id} node={n} />
              ))}
            </div>
          </React.Fragment>
        ))}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          cat.badge,
                        )}
                      >
                        {cat.label}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold tracking-tight">{p.title}</h2>
                    <p className="text-sm text-muted-foreground">{p.rationale}</p>
                  </div>

                  {/* Before / after — the current shape vs the recommended one. */}
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <MiniGraph title="Current" nodes={p.current.nodes} edges={p.current.edges} />
                    <ArrowRight className="mx-auto hidden size-5 text-muted-foreground md:block" />
                    <MiniGraph
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

                  <div>
                    <Link
                      href={discussHref(p)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                    >
                      <AtlasAiMark size={15} className="size-4" />
                      Discuss with Atlas
                      <MessagesSquare className="size-4" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
