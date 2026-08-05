import Link from "next/link";
import { HeartPulse, Activity, ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";

/** Live runtime-health rollup from `/summary` (operational-intelligence Phase B). Mirrors the
 *  server contract in `graph.service.ts` (DashboardSummary.health). */
export interface EstateHealth {
  monitored: number;
  unhealthy: number;
  degraded: number;
  checkedAt: string | null;
  top: Array<{
    id: string;
    name: string | null;
    state: "degraded" | "unhealthy";
    reason: string | null;
  }>;
}

/**
 * The dashboard "is anything broken right now" trust strip — the dashboard's answer to the map
 * turning red (operational-intelligence Phase B). It reads LIVE health (what the health poll marked
 * degraded/unhealthy this minute), which is distinct from the posture score (hygiene findings) and
 * from source freshness (`trust`). Three honest states:
 *   • nothing monitored  → render nothing (health polling off / no live signal — an `unknown` we
 *     never dress up as "all healthy", docs/09 §7).
 *   • all healthy        → a calm, low-key confirmation ("we are watching, and it’s green").
 *   • degraded/unhealthy → a red (any unhealthy) or amber (degraded only) alert with the worst
 *     resources named + deep-linked, and a live "checked Ns ago" recency stamp.
 */
export function HealthStrip({ health }: { health: EstateHealth }) {
  // Honest `unknown`: if nothing is being polled we have no runtime signal to show — stay silent
  // rather than imply everything is fine.
  if (health.monitored === 0) return null;

  const broken = health.unhealthy + health.degraded;

  if (broken === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2.5 text-sm">
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
          <HeartPulse className="size-4 shrink-0 text-success" />
          <span className="font-medium">
            All {health.monitored} monitored resource{health.monitored === 1 ? " is" : "s are"}{" "}
            healthy
          </span>
        </div>
        {health.checkedAt ? (
          <span className="text-xs text-muted-foreground">checked {timeAgo(health.checkedAt)}</span>
        ) : null}
      </div>
    );
  }

  // Any hard-down resource makes this a red alarm; degraded-only is amber.
  const danger = health.unhealthy > 0;
  const tone = danger
    ? { border: "border-danger/30", bg: "bg-danger/[0.07]", dot: "bg-danger", text: "text-danger" }
    : {
        border: "border-warning/30",
        bg: "bg-warning/[0.08]",
        dot: "bg-warning",
        text: "text-warning",
      };

  const parts: string[] = [];
  if (health.unhealthy > 0) parts.push(`${health.unhealthy} unhealthy`);
  if (health.degraded > 0) parts.push(`${health.degraded} degraded`);
  const headline = parts.join(" · ");

  return (
    <div className={cn("rounded-xl border px-4 py-3", tone.border, tone.bg)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5 shrink-0">
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-70",
                tone.dot,
              )}
            />
            <span className={cn("relative inline-flex size-2.5 rounded-full", tone.dot)} />
          </span>
          <Activity className={cn("size-4 shrink-0", tone.text)} />
          <span className="text-sm font-semibold">
            <span className={tone.text}>{headline}</span>{" "}
            <span className="font-medium text-foreground">right now</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {health.checkedAt ? (
            <span className="text-xs text-muted-foreground">
              checked {timeAgo(health.checkedAt)}
            </span>
          ) : null}
          <Link
            href="/map"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium transition-colors hover:border-foreground/40"
          >
            View on map <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>

      {/* The worst-first sample, each deep-linked to its resource — turns "3 unhealthy" into the
          specific things a responder should open. */}
      {health.top.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {health.top.map((n) => (
            <li key={n.id}>
              <Link
                href={`/explore/${n.id}`}
                className="group inline-flex max-w-[22rem] items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs transition-colors hover:border-foreground/40"
                title={n.reason ?? undefined}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    n.state === "unhealthy" ? "bg-danger" : "bg-warning",
                  )}
                />
                <span className="truncate font-medium">{n.name ?? n.id}</span>
                {n.reason ? (
                  <span className="truncate text-muted-foreground">— {n.reason}</span>
                ) : null}
                <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
