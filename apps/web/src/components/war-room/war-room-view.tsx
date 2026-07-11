"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Radar,
  ArrowLeft,
  RotateCw,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { streamAsk, createConversation, updateIncident, type Incident } from "@/lib/browser-api";
import type { MapData } from "@/lib/map-types";
import { WarRoomMap, subgraphAround } from "./war-room-map";
import { MarkdownLite } from "./markdown-lite";

interface Step {
  tool: string;
  summary: string;
}
interface Trace {
  steps: Step[];
  answer: string;
  confidence: string | null;
  citations: number;
  citedIds: string[];
  ranAt: string;
}

type Phase = "idle" | "running" | "done" | "error";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Human label for a tool call in the live investigation log. */
function toolLabel(tool: string): string {
  const t = tool.toLowerCase();
  if (t.includes("diagnose")) return "Diagnosing the resource";
  if (t.includes("blast") || t.includes("impact")) return "Tracing what it affects";
  if (t.includes("depend")) return "Tracing what it depends on";
  if (t.includes("event") || t.includes("change") || t.includes("timeline"))
    return "Checking recent changes";
  if (t.includes("pr") || t.includes("diff")) return "Reading the PR diff";
  if (t.includes("search") || t.includes("lookup") || t.includes("graph") || t.includes("traverse"))
    return "Searching the graph";
  return tool.replace(/[_-]+/g, " ");
}

const SEV_TEXT: Record<string, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-yellow-600 dark:text-yellow-500",
};

function isTrace(v: unknown): v is Trace {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as Trace).steps) &&
    typeof (v as Trace).answer === "string"
  );
}

/**
 * War Room (docs/plans/war-room.md). The broken node + its blast radius on a purpose-built live map,
 * beside a streamed, cited investigation. Every step shown is a REAL tool call from the existing
 * agentic diagnose loop; as it cites/touches nodes, they light up on the map so you watch the trace
 * walk the graph. The transcript is persisted so a reopened incident replays instead of re-running.
 */
export function WarRoomView({
  incident,
  map,
  orgId,
}: {
  incident: Incident;
  map: MapData;
  orgId: string;
}) {
  const router = useRouter();
  const saved = isTrace(incident.evidence) ? incident.evidence : null;

  const subgraph = React.useMemo(
    () => subgraphAround(map, incident.nodeId, 2),
    [map, incident.nodeId],
  );

  const [phase, setPhase] = React.useState<Phase>(saved ? "done" : "idle");
  const [steps, setSteps] = React.useState<Step[]>(saved?.steps ?? []);
  const [answer, setAnswer] = React.useState<string>(saved?.answer ?? "");
  const [confidence, setConfidence] = React.useState<string | null>(saved?.confidence ?? null);
  const [citations, setCitations] = React.useState<number>(saved?.citations ?? 0);
  const [activeIds, setActiveIds] = React.useState<string[]>(saved?.citedIds ?? []);
  const [stepsOpen, setStepsOpen] = React.useState(!saved);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const started = React.useRef(false);

  const label = incident.nodeName ?? incident.nodeKind ?? "this resource";
  const question = `Why is ${label} unhealthy or at risk right now? Diagnose the most likely cause, what changed recently (deploys, config changes, merged PRs), and what depends on it. If nothing correlates, say so plainly.`;

  const run = React.useCallback(async () => {
    setPhase("running");
    setSteps([]);
    setAnswer("");
    setConfidence(null);
    setCitations(0);
    setActiveIds([incident.nodeId]);
    setStepsOpen(true);
    setError(null);

    const convId = await createConversation(orgId, `War Room — ${label}`, "map");
    if (!convId) {
      setError("Couldn't start the investigation.");
      setPhase("error");
      return;
    }
    const collectedSteps: Step[] = [];
    const cited = new Set<string>([incident.nodeId]);
    let text = "";
    let conf: string | null = null;
    let cites = 0;

    const light = (ids: Iterable<string>) => {
      let changed = false;
      for (const id of ids)
        if (!cited.has(id)) {
          cited.add(id);
          changed = true;
        }
      if (changed) setActiveIds([...cited]);
    };

    try {
      for await (const ev of streamAsk(orgId, convId, question)) {
        if (ev.type === "retrieval_step") {
          collectedSteps.push({ tool: ev.tool, summary: ev.summary });
          setSteps([...collectedSteps]);
          light(ev.summary.match(UUID_RE) ?? []); // light nodes as the trace mentions them
        } else if (ev.type === "token") {
          text += ev.text;
          setAnswer(text);
        } else if (ev.type === "citation") {
          cites += 1;
          setCitations(cites);
          if (ev.citation.kind === "node") light([ev.citation.id]);
        } else if (ev.type === "confidence") {
          conf = ev.overall;
          setConfidence(ev.overall);
        } else if (ev.type === "error") {
          setError(ev.message);
        }
      }
    } catch {
      setError("The investigation stream was interrupted.");
    }

    setPhase(text ? "done" : "error");
    setStepsOpen(false);
    const trace: Trace = {
      steps: collectedSteps,
      answer: text,
      confidence: conf,
      citations: cites,
      citedIds: [...cited],
      ranAt: new Date().toISOString(),
    };
    void updateIncident(orgId, incident.id, {
      status: "analyzing",
      evidence: trace,
      verdict: { summary: text, confidence: conf },
    });
  }, [orgId, incident.id, incident.nodeId, label, question]);

  React.useEffect(() => {
    if (!saved && !started.current) {
      started.current = true;
      void run();
    }
  }, [saved, run]);

  async function close(status: "resolved" | "dismissed") {
    setBusy(true);
    await updateIncident(orgId, incident.id, { status });
    router.push("/insights");
    router.refresh();
  }

  const terminal = incident.status === "resolved" || incident.status === "dismissed";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/insights"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to Insights
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Radar className="size-6 text-danger" /> War Room
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{label}</span>
            {incident.severity ? (
              <>
                {" · "}
                <span className={`font-medium ${SEV_TEXT[incident.severity] ?? ""}`}>
                  {incident.severity}
                </span>
              </>
            ) : null}
            {" · "}
            <span className="capitalize">{incident.status}</span>
          </p>
        </div>
        {!terminal ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => close("dismissed")}>
              Dismiss
            </Button>
            <Button size="sm" disabled={busy} onClick={() => close("resolved")}>
              Mark resolved
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Live blast-radius map */}
        <div className="h-[64vh] min-h-[440px] overflow-hidden rounded-xl border border-border bg-background">
          <WarRoomMap data={subgraph} focusId={incident.nodeId} activeIds={activeIds} />
        </div>

        {/* Investigation */}
        <div className="flex h-[64vh] min-h-[440px] flex-col rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Investigation</h2>
            {phase !== "running" ? (
              <Button variant="ghost" size="sm" onClick={() => void run()}>
                <RotateCw className="mr-1.5 size-3.5" /> Re-run
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Tracing…
              </span>
            )}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {/* Steps — real tool calls. Live while running; collapsed to an accordion once done. */}
            {steps.length > 0 ? (
              <div>
                {phase !== "running" ? (
                  <button
                    type="button"
                    onClick={() => setStepsOpen((v) => !v)}
                    className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform ${stepsOpen ? "" : "-rotate-90"}`}
                    />
                    Traced {steps.length} {steps.length === 1 ? "step" : "steps"}
                  </button>
                ) : null}
                {stepsOpen ? (
                  <ol className="space-y-1.5">
                    {steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                        <span>
                          <span className="font-medium">{toolLabel(s.tool)}</span>
                          {s.summary ? (
                            <span className="text-muted-foreground"> — {s.summary}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                    {phase === "running" ? (
                      <li className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Working…
                      </li>
                    ) : null}
                  </ol>
                ) : null}
              </div>
            ) : phase === "running" || phase === "idle" ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Starting the investigation…
              </p>
            ) : null}

            {/* Verdict */}
            {answer ? (
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">What Atlas found</h3>
                  {confidence ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                      {confidence} confidence
                    </span>
                  ) : null}
                </div>
                <MarkdownLite text={answer} />
                {citations > 0 ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {citations} cited {citations === 1 ? "source" : "sources"} · lit on the map ·
                    open Ask Atlas for the full evidence trail.
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="flex items-start gap-2 border-t border-border pt-4 text-sm text-danger">
                <XCircle className="mt-0.5 size-4 shrink-0" /> {error}
              </div>
            ) : null}
          </div>

          {incident.resolution ? (
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Resolution: {incident.resolution}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
