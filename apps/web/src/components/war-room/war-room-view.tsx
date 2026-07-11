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
  CornerDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { streamAsk, createConversation, updateIncident, type Incident } from "@/lib/browser-api";
import type { MapData } from "@/lib/map-types";
import { kindIcon, KIND_LOGO } from "@/lib/kind-visual";
import { CloudIcon } from "@/components/cloud-icon";
import { WarRoomMap } from "./war-room-map";
import { MarkdownLite } from "./markdown-lite";

interface Step {
  tool: string;
  summary: string;
}
interface Turn {
  role: "user" | "assistant";
  text: string;
  steps?: Step[];
  confidence?: string | null;
  citations?: number;
  streaming?: boolean;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

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

/** Restore a saved investigation (new turn-based shape, or the older single-answer shape). */
function loadSaved(evidence: unknown): { turns: Turn[]; citedIds: string[] } | null {
  if (typeof evidence !== "object" || evidence === null) return null;
  const e = evidence as Record<string, unknown>;
  if (Array.isArray(e.turns)) {
    return { turns: e.turns as Turn[], citedIds: (e.citedIds as string[]) ?? [] };
  }
  if (typeof e.answer === "string" && Array.isArray(e.steps)) {
    return {
      turns: [
        {
          role: "assistant",
          text: e.answer,
          steps: e.steps as Step[],
          confidence: (e.confidence as string | null) ?? null,
          citations: (e.citations as number) ?? 0,
        },
      ],
      citedIds: (e.citedIds as string[]) ?? [],
    };
  }
  return null;
}

/**
 * War Room (docs/plans/war-room.md). Investigation (left) as a live AI chat beside a purpose-built map
 * (right). The first turn auto-diagnoses the broken node; every step is a REAL tool call and the nodes
 * it touches light up + connect in red on the map. You can then ASK FOLLOW-UPS in the same conversation.
 * The whole thread is persisted so a reopened incident replays it.
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
  const saved = React.useMemo(() => loadSaved(incident.evidence), [incident.evidence]);

  const nodeById = React.useMemo(() => new Map(map.nodes.map((n) => [n.id, n] as const)), [map]);

  const [turns, setTurns] = React.useState<Turn[]>(saved?.turns ?? []);
  const [activeIds, setActiveIds] = React.useState<string[]>(saved?.citedIds ?? [incident.nodeId]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const started = React.useRef(false);
  const asking = React.useRef(false);
  const convRef = React.useRef<string | null>(null);
  const turnsRef = React.useRef<Turn[]>(turns);
  const citedRef = React.useRef<Set<string>>(new Set(saved?.citedIds ?? [incident.nodeId]));
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    turnsRef.current = turns;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const label = incident.nodeName ?? incident.nodeKind ?? "this resource";
  const diagnoseQuestion = `Why is ${label} unhealthy or at risk right now? Diagnose the most likely cause, what changed recently (deploys, config changes, merged PRs), and what depends on it. If nothing correlates, say so plainly.`;

  const light = React.useCallback((ids: Iterable<string>) => {
    let changed = false;
    for (const id of ids)
      if (!citedRef.current.has(id)) {
        citedRef.current.add(id);
        changed = true;
      }
    if (changed) setActiveIds([...citedRef.current]);
  }, []);

  const ask = React.useCallback(
    async (question: string, opts?: { initial?: boolean }) => {
      if (asking.current || !question.trim()) return;
      asking.current = true;
      setSending(true);
      setError(null);

      if (!convRef.current) {
        convRef.current = await createConversation(orgId, `War Room — ${label}`, "map");
      }
      const convId = convRef.current;
      if (!convId) {
        setError("Couldn't start the investigation.");
        asking.current = false;
        setSending(false);
        return;
      }

      const base = turnsRef.current;
      const lead: Turn[] = opts?.initial ? [] : [{ role: "user", text: question }];
      const asst: Turn = { role: "assistant", text: "", steps: [], streaming: true };
      const commit = () => setTurns([...base, ...lead, { ...asst }]);
      commit();

      const collectedSteps: Step[] = [];
      try {
        for await (const ev of streamAsk(orgId, convId, question)) {
          if (ev.type === "retrieval_step") {
            collectedSteps.push({ tool: ev.tool, summary: ev.summary });
            asst.steps = [...collectedSteps];
            light(ev.summary.match(UUID_RE) ?? []);
            commit();
          } else if (ev.type === "token") {
            asst.text += ev.text;
            commit();
          } else if (ev.type === "citation") {
            asst.citations = (asst.citations ?? 0) + 1;
            if (ev.citation.kind === "node") light([ev.citation.id]);
            commit();
          } else if (ev.type === "confidence") {
            asst.confidence = ev.overall;
            commit();
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }
      } catch {
        setError("The investigation stream was interrupted.");
      }

      asst.streaming = false;
      const finalTurns = [...base, ...lead, { ...asst }];
      setTurns(finalTurns);
      asking.current = false;
      setSending(false);

      const firstAsst = finalTurns.find((t) => t.role === "assistant");
      void updateIncident(orgId, incident.id, {
        evidence: {
          turns: finalTurns,
          citedIds: [...citedRef.current],
          ranAt: new Date().toISOString(),
        },
        verdict: { summary: firstAsst?.text ?? "", confidence: firstAsst?.confidence ?? null },
      });
    },
    [orgId, incident.id, label, light],
  );

  // Auto-diagnose once for a fresh incident.
  React.useEffect(() => {
    if (!saved && !started.current) {
      started.current = true;
      void ask(diagnoseQuestion, { initial: true });
    }
  }, [saved, ask, diagnoseQuestion]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    await ask(q);
  }

  async function close(status: "resolved" | "dismissed") {
    setBusy(true);
    await updateIncident(orgId, incident.id, { status });
    router.push("/insights");
    router.refresh();
  }

  function rerun() {
    citedRef.current = new Set([incident.nodeId]);
    setActiveIds([incident.nodeId]);
    setTurns([]);
    turnsRef.current = [];
    void ask(diagnoseQuestion, { initial: true });
  }

  const terminal = incident.status === "resolved" || incident.status === "dismissed";
  const diagnosed = turns.some((t) => t.role === "assistant" && t.text);
  const statusLabel = terminal
    ? incident.status
    : sending
      ? "analyzing…"
      : diagnosed
        ? "diagnosed"
        : incident.status;

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
            <span className="capitalize">{statusLabel}</span>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(380px,1fr)_1.35fr]">
        {/* Investigation — a live AI chat (left) */}
        <div className="flex h-[66vh] min-h-[460px] flex-col rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Investigation</h2>
            {sending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Tracing…
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={rerun}>
                <RotateCw className="mr-1.5 size-3.5" /> Re-run
              </Button>
            )}
          </div>

          {/* Resources traced — real provider icons, mirroring the lit map nodes. */}
          {activeIds.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
              {activeIds.map((id) => {
                const n = nodeById.get(id);
                if (!n) return null;
                const logo = KIND_LOGO[n.kind];
                const Icon = kindIcon(n.kind);
                const focal = id === incident.nodeId;
                return (
                  <span
                    key={id}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                      focal ? "border-danger/50 bg-danger/[0.06]" : "border-border bg-muted/40"
                    }`}
                  >
                    {logo ? (
                      <CloudIcon name={logo} className="size-4" />
                    ) : (
                      <Icon className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="max-w-[160px] truncate">{n.name ?? n.kind}</span>
                  </span>
                );
              })}
            </div>
          ) : null}

          {/* Thread */}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {turns.length === 0 && !sending ? (
              <p className="text-sm text-muted-foreground">Starting the investigation…</p>
            ) : null}
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-muted px-3.5 py-2 text-sm">
                    {t.text}
                  </div>
                </div>
              ) : (
                <AssistantTurn key={i} turn={t} />
              ),
            )}
            {error ? (
              <div className="flex items-start gap-2 text-sm text-danger">
                <XCircle className="mt-0.5 size-4 shrink-0" /> {error}
              </div>
            ) : null}
          </div>

          {/* Ask a follow-up */}
          {!terminal ? (
            <form onSubmit={submit} className="border-t border-border p-2.5">
              <div className="flex items-end gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 focus-within:border-foreground/40">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) void submit(e);
                  }}
                  rows={1}
                  placeholder="Ask a follow-up — e.g. “what did that PR change?”"
                  className="max-h-28 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                  title="Send"
                >
                  <CornerDownLeft className="size-4" />
                </button>
              </div>
            </form>
          ) : null}
        </div>

        {/* Live map (right) */}
        <div className="h-[66vh] min-h-[460px] overflow-hidden rounded-xl border border-border bg-background">
          <WarRoomMap full={map} focusId={incident.nodeId} activeIds={activeIds} />
        </div>
      </div>
    </div>
  );
}

/** One assistant turn: its real tool-call steps (collapsed once done) + the markdown verdict. */
function AssistantTurn({ turn }: { turn: Turn }) {
  const steps = turn.steps ?? [];
  const StepList = (
    <ol className="space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
          <span>
            <span className="font-medium">{toolLabel(s.tool)}</span>
            {s.summary ? <span className="text-muted-foreground"> — {s.summary}</span> : null}
          </span>
        </li>
      ))}
      {turn.streaming ? (
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Working…
        </li>
      ) : null}
    </ol>
  );

  return (
    <div className="space-y-3">
      {steps.length > 0 ? (
        turn.streaming ? (
          StepList
        ) : (
          <details className="group">
            <summary className="mb-2 inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <span className="transition-transform group-open:rotate-90">▸</span>
              Traced {steps.length} {steps.length === 1 ? "step" : "steps"}
            </summary>
            {StepList}
          </details>
        )
      ) : null}

      {turn.text ? (
        <div className="space-y-2">
          {turn.confidence ? (
            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
              {turn.confidence} confidence
            </span>
          ) : null}
          <MarkdownLite text={turn.text} />
          {turn.citations ? (
            <p className="pt-0.5 text-xs text-muted-foreground">
              {turn.citations} cited {turn.citations === 1 ? "source" : "sources"} · lit on the map
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
