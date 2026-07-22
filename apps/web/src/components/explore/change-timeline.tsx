"use client";

import * as React from "react";
import Link from "next/link";
import { Circle, ExternalLink } from "lucide-react";
import type { NodeEvent } from "@/lib/graph-types";
import { EVENT_COLOR, EVENT_ICON, EVENT_LABEL } from "@/lib/event-taxonomy";
import { cn } from "@/lib/cn";

const INITIAL = 12;

/**
 * The unified, cited change timeline (Phase C exit): deploys · PR merges · config changes · health
 * transitions in one newest-first feed. Kind-filterable (chips filter the already-fetched events
 * client-side — snappy, no refetch). Every entry carries its citation (P4): a PR links through to
 * its node, and a PR surfaced on a *service* timeline via a `DEPLOYS_TO` edge shows the deploying
 * repo it came from, so the reason it belongs here is never un-sourced.
 */
export function ChangeTimeline({ events }: { events: NodeEvent[] }) {
  const [active, setActive] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  // Kinds actually present, in a stable canonical order, with counts — drives the filter chips.
  const present = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return [...Object.keys(EVENT_LABEL)]
      .filter((k) => counts.has(k))
      .map((k) => ({ kind: k, count: counts.get(k) ?? 0 }));
  }, [events]);

  const filtered = active ? events.filter((e) => e.kind === active) : events;
  const shown = expanded ? filtered : filtered.slice(0, INITIAL);

  return (
    <div>
      {present.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip label="All" count={events.length} on={!active} onClick={() => setActive(null)} />
          {present.map(({ kind, count }) => (
            <FilterChip
              key={kind}
              label={EVENT_LABEL[kind] ?? kind}
              count={count}
              on={active === kind}
              onClick={() => setActive(active === kind ? null : kind)}
            />
          ))}
        </div>
      ) : null}

      <ol className="relative">
        {shown.map((e, i, arr) => {
          const Icon = EVENT_ICON[e.kind] ?? Circle;
          const last = i === arr.length - 1;
          const prNodeId = typeof e.evidence?.prNodeId === "string" ? e.evidence.prNodeId : null;
          const viaRepoId =
            e.evidence?.via === "DEPLOYS_TO" && typeof e.evidence?.viaRepoId === "string"
              ? e.evidence.viaRepoId
              : null;
          return (
            <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
              {!last ? (
                <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-border" />
              ) : null}
              <span
                className={cn(
                  "relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-card ring-4 ring-card",
                  EVENT_COLOR[e.kind] ?? "text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug" title={e.title}>
                  {e.title}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{new Date(e.occurredAt).toLocaleString()}</span>
                  <span aria-hidden>·</span>
                  <span>{e.source}</span>
                  {e.actor ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{e.actor}</span>
                    </>
                  ) : null}
                  {viaRepoId ? (
                    <>
                      <span aria-hidden>·</span>
                      <Link
                        href={`/explore/${viaRepoId}`}
                        className="text-primary hover:underline"
                        title="This PR is on this timeline because its repo deploys here (DEPLOYS_TO)"
                      >
                        via deploy
                      </Link>
                    </>
                  ) : null}
                  {prNodeId ? (
                    <>
                      <span aria-hidden>·</span>
                      <Link
                        href={`/explore/${prNodeId}`}
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        view PR <ExternalLink className="size-3" />
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {filtered.length > INITIAL ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : `Show ${filtered.length - INITIAL} more`}
        </button>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
        on
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
      aria-pressed={on}
    >
      {label}
      <span className={cn("tabular-nums", on ? "text-primary/70" : "text-muted-foreground/70")}>
        {count}
      </span>
    </button>
  );
}
