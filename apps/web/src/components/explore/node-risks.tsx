"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getNodeFindings, type NodeFinding } from "@/lib/browser-api";
import { cn } from "@/lib/cn";

const SEV_LOW = { dot: "bg-muted-foreground/50", text: "text-muted-foreground", label: "Low" };
const SEV: Record<string, { dot: string; text: string; label: string }> = {
  high: { dot: "bg-danger", text: "text-danger", label: "High" },
  medium: { dot: "bg-warning", text: "text-warning", label: "Medium" },
  low: SEV_LOW,
};

/**
 * Risks section on the node detail — the findings that name THIS resource (exposed, single point
 * of failure, vulnerable dependency, …), pulled from the same authoritative rules as Insights so
 * there's no drift. Fetched client-side after paint so it never blocks the page; renders nothing
 * when the resource has no open findings (absence is quiet, not a fake "all clear").
 */
export function NodeRisks({ orgId, nodeId }: { orgId: string; nodeId: string }) {
  const [findings, setFindings] = useState<NodeFinding[] | null>(null);
  useEffect(() => {
    let live = true;
    void getNodeFindings(orgId, nodeId).then((f) => {
      if (live) setFindings(f);
    });
    return () => {
      live = false;
    };
  }, [orgId, nodeId]);

  if (!findings || findings.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-danger/30 bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldAlert className="size-4 text-danger" />
        <span className="text-sm font-semibold">Risks</span>
        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {findings.length}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {findings.map((f) => {
          const s = SEV[f.severity] ?? SEV_LOW;
          const inner = (
            <div className="flex items-start gap-3 px-4 py-3">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", s.dot)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.detail}</p>
              </div>
              <span className={cn("shrink-0 text-[11px] font-medium", s.text)}>{s.label}</span>
            </div>
          );
          return (
            <li key={f.id}>
              {f.href ? (
                <Link href={f.href} className="block transition-colors hover:bg-muted/40">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
