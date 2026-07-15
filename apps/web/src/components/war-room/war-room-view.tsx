"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Crosshair,
  ArrowLeft,
  RotateCw,
  SkipForward,
  CornerDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { streamAsk, createConversation, updateIncident, type Incident } from "@/lib/browser-api";
import type { MapData, MapNode } from "@/lib/map-types";
import { SEVERITY_TEXT } from "@/lib/severity";
import { WarRoomMap } from "./war-room-map";
import { MarkdownLite } from "./markdown-lite";
import { ContextBar, Timeline, type NodeEvent } from "./war-room-context";

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

// Reveal one replayed diagnosis step every ~420ms — brisk enough to not feel slow, slow enough to read.
const REPLAY_STEP_MS = 420;
// Run the replay reset BEFORE paint so a reopened incident never flashes its full trace first. Falls
// back to useEffect during SSR (no `document`), where layout effects don't apply anyway.
const useIsoLayoutEffect =
  typeof document !== "undefined" ? React.useLayoutEffect : React.useEffect;
const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

const SEV_TEXT: Record<string, string> = SEVERITY_TEXT;

// The structured verdict the model appends (parsed client-side; no AI-backend change). Classifies the
// likely cause so the "Likely cause" card leads with a definite answer, not a wall of prose (P3/P4 —
// the classification is the model's, grounded in its own cited reasoning; "unknown" is first-class).
const VERDICT_META: Record<string, { label: string; cls: string }> = {
  "code-change": { label: "Code change", cls: "border-danger/40 bg-danger/10 text-danger" },
  "config-change": { label: "Config change", cls: "border-warning/40 bg-warning/10 text-warning" },
  dependency: { label: "Dependency", cls: "border-warning/40 bg-warning/10 text-warning" },
  capacity: {
    label: "Capacity",
    cls: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  chronic: {
    label: "Not new (chronic)",
    cls: "border-border bg-muted text-muted-foreground",
  },
  unknown: { label: "No clear culprit", cls: "border-border bg-muted text-muted-foreground" },
};

/** Hide the raw "VERDICT: …" line from the displayed prose (even mid-stream, before it's complete). */
function stripVerdict(text: string): string {
  const i = text.search(/\n?\s*VERDICT:/i);
  return i >= 0 ? text.slice(0, i).trim() : text.trim();
}
/** Pull the structured {type, cause} once the VERDICT line has fully streamed in. */
function parseVerdict(text: string): { type: string; cause: string } | null {
  const m = /VERDICT:\s*([a-z][a-z-]*)\s*[—:-]+\s*(.+?)\s*$/im.exec(text);
  if (!m) return null;
  return { type: (m[1] ?? "").toLowerCase(), cause: (m[2] ?? "").trim() };
}

interface Saved {
  turns: Turn[];
  citedIds: string[];
  citedEdgeIds: string[];
}
/** Restore a saved investigation (new turn-based shape, or the older single-answer shape). */
function loadSaved(evidence: unknown): Saved | null {
  if (typeof evidence !== "object" || evidence === null) return null;
  const e = evidence as Record<string, unknown>;
  const citedIds = (e.citedIds as string[]) ?? [];
  const citedEdgeIds = (e.citedEdgeIds as string[]) ?? [];
  if (Array.isArray(e.turns)) {
    return { turns: e.turns as Turn[], citedIds, citedEdgeIds };
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
      citedIds,
      citedEdgeIds,
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
  events,
  impactCount,
  orgId,
}: {
  incident: Incident;
  map: MapData;
  events: NodeEvent[];
  impactCount: number;
  orgId: string;
}) {
  const router = useRouter();
  const saved = React.useMemo(() => loadSaved(incident.evidence), [incident.evidence]);

  const nodeById = React.useMemo(() => new Map(map.nodes.map((n) => [n.id, n] as const)), [map]);
  const focalNode = nodeById.get(incident.nodeId);
  const lastChange = events.find((e) => e.kind !== "health_transition") ?? events[0] ?? null;

  const [turns, setTurns] = React.useState<Turn[]>(saved?.turns ?? []);
  const [activeIds, setActiveIds] = React.useState<string[]>(saved?.citedIds ?? [incident.nodeId]);
  const [citedEdgeIds, setCitedEdgeIds] = React.useState<string[]>(saved?.citedEdgeIds ?? []);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const started = React.useRef(false);
  const asking = React.useRef(false);
  const convRef = React.useRef<string | null>(null);
  const turnsRef = React.useRef<Turn[]>(turns);
  const citedRef = React.useRef<Set<string>>(new Set(saved?.citedIds ?? [incident.nodeId]));
  const citedEdgesRef = React.useRef<Set<string>>(new Set(saved?.citedEdgeIds ?? []));
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    turnsRef.current = turns;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const label = incident.nodeName ?? incident.nodeKind ?? "this resource";
  const diagnoseQuestion = `Why is ${label} unhealthy or at risk right now? Diagnose the most likely cause, what changed recently (deploys, config changes, merged PRs), and what depends on it. If nothing correlates, say so plainly. End your reply with ONE final line exactly in this format: "VERDICT: <type> — <one concise sentence naming the likely cause>", where <type> is one of code-change, config-change, dependency, capacity, chronic, or unknown (use "unknown" if nothing correlates).`;

  const light = React.useCallback((ids: Iterable<string>) => {
    let changed = false;
    for (const id of ids)
      if (!citedRef.current.has(id)) {
        citedRef.current.add(id);
        changed = true;
      }
    if (changed) setActiveIds([...citedRef.current]);
  }, []);

  // ── Replay-on-open ────────────────────────────────────────────────────────
  // A reopened incident already has its whole investigation saved; dumping it instantly loses the
  // sense of the trace unfolding. Replay it: reveal the first diagnosis's steps one-by-one while the
  // map lights the nodes each step touched, then settle into the full thread + verdict. Purely
  // client-side (the data's all in `saved`), skippable, and off under reduced-motion (instant, as before).
  const [replaying, setReplaying] = React.useState(false);
  const replayTimers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  const finishReplay = React.useCallback(() => {
    replayTimers.current.forEach(clearTimeout);
    replayTimers.current = [];
    if (!saved) return;
    citedRef.current = new Set(saved.citedIds);
    citedEdgesRef.current = new Set(saved.citedEdgeIds);
    turnsRef.current = saved.turns;
    setTurns(saved.turns);
    setActiveIds(saved.citedIds);
    setCitedEdgeIds(saved.citedEdgeIds);
    setReplaying(false);
  }, [saved]);

  useIsoLayoutEffect(() => {
    if (!saved || started.current || prefersReducedMotion()) return;
    const firstIdx = saved.turns.findIndex((t) => t.role === "assistant");
    if (firstIdx < 0) return; // nothing to replay
    started.current = true;
    setReplaying(true);

    // Reset to the pre-diagnosis state before the browser paints (no flash of the full trace).
    citedRef.current = new Set([incident.nodeId]);
    citedEdgesRef.current = new Set();
    setActiveIds([incident.nodeId]);
    setCitedEdgeIds([]);
    const head = saved.turns.slice(0, firstIdx); // any leading user turn(s), shown immediately
    const firstAsst = saved.turns[firstIdx];
    const steps = firstAsst?.steps ?? [];
    const shell: Turn = { role: "assistant", text: "", steps: [], streaming: true };
    setTurns([...head, shell]);

    const timers = replayTimers.current;
    const shown: Step[] = [];
    let t = 260;
    for (const s of steps) {
      timers.push(
        setTimeout(() => {
          shown.push(s);
          setTurns([...head, { role: "assistant", text: "", steps: [...shown], streaming: true }]);
          light(s.summary.match(UUID_RE) ?? []);
        }, t),
      );
      t += REPLAY_STEP_MS;
    }
    // Settle: the prose, verdict, follow-ups and all cited nodes land together.
    timers.push(setTimeout(finishReplay, t + 260));

    return () => {
      timers.forEach(clearTimeout);
      replayTimers.current = [];
    };
    // Mount-only (deps intentionally empty): a re-run would clear in-flight timers mid-replay; the
    // `started` ref guards against it. All closed-over values are from the first render and stable.
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
            else if (ev.citation.kind === "edge" && !citedEdgesRef.current.has(ev.citation.id)) {
              citedEdgesRef.current.add(ev.citation.id);
              setCitedEdgeIds([...citedEdgesRef.current]);
            }
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
          citedEdgeIds: [...citedEdgesRef.current],
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
    if (replaying) finishReplay(); // land the saved thread before appending a new turn
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
    citedEdgesRef.current = new Set();
    setActiveIds([incident.nodeId]);
    setCitedEdgeIds([]);
    setTurns([]);
    turnsRef.current = [];
    void ask(diagnoseQuestion, { initial: true });
  }

  const terminal = incident.status === "resolved" || incident.status === "dismissed";
  // While replaying, present the same "tracing" state as a live run so the verdict doesn't spoil the
  // steps unfolding beneath it — it lands when the replay settles.
  const inProgress = sending || replaying;
  const diagnosed = !replaying && turns.some((t) => t.role === "assistant" && t.text);
  const firstAsst = turns.find((t) => t.role === "assistant");
  const liveVerdict = firstAsst?.text ? parseVerdict(firstAsst.text) : null;
  // A proactively-opened incident carries a deterministic headline (no LLM) — show it immediately in
  // the hero while the full live diagnosis streams; the live verdict replaces it when it lands.
  const preliminaryVerdict = React.useMemo(() => {
    const v = incident.verdict as { classification?: string; summary?: string } | null;
    return v && typeof v.summary === "string" && v.summary
      ? { type: v.classification ?? "unknown", cause: v.summary }
      : null;
  }, [incident.verdict]);
  const verdict = replaying ? null : (liveVerdict ?? preliminaryVerdict);
  const heroConfidence = replaying ? null : (firstAsst?.confidence ?? null);
  const statusLabel = terminal
    ? incident.status
    : replaying
      ? "replaying…"
      : sending
        ? "analyzing…"
        : diagnosed
          ? "diagnosed"
          : incident.status;

  return (
    <div className="motion-stagger space-y-4">
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
            <Crosshair className="size-6 text-danger" /> War Room
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

      {/* Verdict hero — the answer FIRST (a non-expert reads this line and gets it; an SRE triages fast). */}
      <VerdictHero
        verdict={verdict}
        confidence={heroConfidence}
        sending={inProgress}
        diagnosed={diagnosed}
        node={focalNode}
        impactCount={impactCount}
        lastChange={lastChange}
      />

      <div className="grid gap-4 lg:h-[72vh] lg:grid-cols-[1.35fr_1fr]">
        {/* Left: the evidence — dependency chain (map) + what changed (timeline) */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex min-h-[300px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Dependency chain</h2>
              <p className="text-xs text-muted-foreground">
                The culprit path is red · lit nodes are what the trace examined.
              </p>
            </div>
            <div className="min-h-0 flex-1">
              <WarRoomMap
                full={map}
                focusId={incident.nodeId}
                activeIds={activeIds}
                citedEdgeIds={citedEdgeIds}
              />
            </div>
          </div>
          <div className="h-[220px] shrink-0 overflow-hidden rounded-xl border border-border bg-background">
            <Timeline events={events} />
          </div>
        </div>

        {/* Right: the investigation — the full write-up + follow-up chat */}
        <div className="flex min-h-[520px] flex-col rounded-xl border border-border bg-background lg:min-h-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Investigation</h2>
            {replaying ? (
              <Button variant="ghost" size="sm" onClick={finishReplay}>
                <SkipForward className="mr-1.5 size-3.5" /> Skip replay
              </Button>
            ) : sending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Tracing…
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={rerun}>
                <RotateCw className="mr-1.5 size-3.5" /> Re-run
              </Button>
            )}
          </div>

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
                  aria-label="Ask a follow-up question"
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
      </div>
    </div>
  );
}

/** The verdict hero — the answer, first. A classified badge + the one-line likely cause + confidence,
 *  over a compact facts strip. Reads for a non-expert (plain sentence) and an SRE (fast triage). */
function VerdictHero({
  verdict,
  confidence,
  sending,
  diagnosed,
  node,
  impactCount,
  lastChange,
}: {
  verdict: { type: string; cause: string } | null;
  confidence: string | null;
  sending: boolean;
  diagnosed: boolean;
  node: MapNode | undefined;
  impactCount: number;
  lastChange: NodeEvent | null;
}) {
  const meta = verdict ? (VERDICT_META[verdict.type] ?? VERDICT_META.unknown) : null;
  const headline =
    verdict?.cause ??
    (sending
      ? "Tracing the likely cause…"
      : diagnosed
        ? "Diagnosis complete — see the investigation for detail."
        : "Preparing the investigation…");
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
          {sending && !verdict ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Crosshair className="size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Likely cause
            </span>
            {meta ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
              >
                {meta.label}
              </span>
            ) : null}
            {confidence ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                {confidence} confidence
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] font-medium leading-snug text-foreground">{headline}</p>
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <ContextBar node={node} impactCount={impactCount} lastChange={lastChange} />
      </div>
    </div>
  );
}

/** One assistant turn — real tool-call steps (collapsed once done) + the markdown verdict prose. The
 *  raw VERDICT line is stripped (the hero shows it). */
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

  const confidenceChip = turn.confidence ? (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
      {turn.confidence} confidence
    </span>
  ) : null;

  const stepsBlock =
    steps.length > 0 ? (
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
    ) : null;

  const citationsNote = turn.citations ? (
    <p className="pt-0.5 text-xs text-muted-foreground">
      {turn.citations} cited {turn.citations === 1 ? "source" : "sources"} · lit on the map
    </p>
  ) : null;

  const prose = stripVerdict(turn.text);
  return (
    <div className="space-y-3">
      {stepsBlock}
      {prose ? (
        <div className="space-y-2">
          {confidenceChip}
          <MarkdownLite text={prose} />
          {citationsNote}
        </div>
      ) : null}
    </div>
  );
}
