import * as React from "react";
import {
  Activity,
  Rocket,
  SlidersHorizontal,
  GitMerge,
  Bell,
  Circle,
  Waypoints,
  Clock,
  MapPin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MapNode } from "@/lib/map-types";
import { kindShort } from "@/lib/kind-visual";

export interface NodeEvent {
  id: string;
  kind: string;
  occurredAt: string;
  actor: string | null;
  title: string;
  source: string;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const HEALTH_DOT: Record<string, string> = {
  unhealthy: "bg-danger",
  degraded: "bg-warning",
  healthy: "bg-success",
};
const HEALTH_TEXT: Record<string, string> = {
  unhealthy: "text-danger",
  degraded: "text-warning",
  healthy: "text-success",
};

/** A compact stat. */
function Stat({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium">{children}</div>
    </div>
  );
}

/** At-a-glance facts about the broken resource — real data, so the War Room reads as an incident
 *  dashboard rather than a bare chat. */
export function ContextBar({
  node,
  impactCount,
  lastChange,
}: {
  node: MapNode | undefined;
  impactCount: number;
  lastChange: NodeEvent | null;
}) {
  const state = node?.health?.state ?? "unknown";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Stat icon={Activity} label="Health">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${HEALTH_DOT[state] ?? "bg-muted-foreground"}`} />
          <span className={`capitalize ${HEALTH_TEXT[state] ?? "text-muted-foreground"}`}>
            {state}
          </span>
        </span>
      </Stat>
      <Stat icon={Circle} label="Type">
        {node ? kindShort(node.kind) : "—"}
      </Stat>
      <Stat icon={MapPin} label="Environment">
        <span className={node?.environment === "production" ? "text-foreground" : ""}>
          {node?.environment ?? node?.region ?? "—"}
        </span>
      </Stat>
      <Stat icon={Waypoints} label="Blast radius">
        {impactCount > 0 ? `${impactCount} depend on it` : "None downstream"}
      </Stat>
      <Stat icon={Clock} label="Last change">
        {lastChange ? `${eventVerb(lastChange.kind)} · ${timeAgo(lastChange.occurredAt)}` : "None"}
      </Stat>
    </div>
  );
}

const EVENT_ICON: Record<string, LucideIcon> = {
  deploy: Rocket,
  config_change: SlidersHorizontal,
  pr_merged: GitMerge,
  health_transition: Activity,
  alarm_transition: Bell,
};
const EVENT_COLOR: Record<string, string> = {
  deploy: "text-foreground",
  config_change: "text-warning",
  pr_merged: "text-muted-foreground",
  health_transition: "text-danger",
  alarm_transition: "text-danger",
};
function eventVerb(kind: string): string {
  return (
    { deploy: "Deployed", config_change: "Config changed", pr_merged: "PR merged" }[kind] ??
    "Changed"
  );
}

/** The resource's real change history (node_events) — the "what changed, when" that grounds RCA. */
export function Timeline({ events }: { events: NodeEvent[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Recent changes</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recorded changes on this resource — so a recent deploy or config change is unlikely
            to be the cause.
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((e) => {
              const Icon = EVENT_ICON[e.kind] ?? Circle;
              return (
                <li key={e.id} className="flex items-start gap-2.5">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${EVENT_COLOR[e.kind] ?? ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {timeAgo(e.occurredAt)}
                      {e.actor ? ` · ${e.actor}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
