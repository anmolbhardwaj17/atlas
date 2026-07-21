import * as React from "react";
import { Activity, Circle, Waypoints, Clock, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MapNode } from "@/lib/map-types";
import { timeAgo } from "@/lib/format";
import { kindShort } from "@/lib/kind-visual";
import { EVENT_COLOR, EVENT_ICON, eventVerb } from "@/lib/event-taxonomy";

export interface NodeEvent {
  id: string;
  kind: string;
  occurredAt: string;
  actor: string | null;
  title: string;
  source: string;
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

/** A compact inline facts strip — the incident's key metadata, meant to sit under the verdict in the
 *  hero (not five heavy cards competing with the answer). Real data throughout. */
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
  const facts: Array<{ icon: LucideIcon; label: string; value: React.ReactNode }> = [
    {
      icon: Activity,
      label: "Health",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${HEALTH_DOT[state] ?? "bg-muted-foreground"}`} />
          <span className={`capitalize ${HEALTH_TEXT[state] ?? "text-muted-foreground"}`}>
            {state}
          </span>
        </span>
      ),
    },
    { icon: Circle, label: "Type", value: node ? kindShort(node.kind) : "—" },
    { icon: MapPin, label: "Env", value: node?.environment ?? node?.region ?? "—" },
    {
      icon: Waypoints,
      label: "Blast radius",
      value: impactCount > 0 ? `${impactCount} depend on it` : "None downstream",
    },
    {
      icon: Clock,
      label: "Last change",
      value: lastChange
        ? `${eventVerb(lastChange.kind)} · ${timeAgo(lastChange.occurredAt)}`
        : "None",
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {facts.map((f) => (
        <div key={f.label} className="flex items-center gap-1.5 text-sm">
          <f.icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{f.label}</span>
          <span className="font-medium">{f.value}</span>
        </div>
      ))}
    </div>
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
