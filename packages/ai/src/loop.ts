/**
 * Agentic retrieval loop (docs/plans/ai-knowledge-engine-p1-design §4/§6, DD-P1-3). The LLM
 * PLANS retrieval by calling read-only tools; we execute them, feed results back, and repeat
 * until it has enough grounded context OR a budget is hit. The loop only GATHERS — the final
 * answer is narrated separately from the accumulated CONTEXT (closed-context guarantee intact).
 *
 * Bounded by construction (AIR-7/8): MAX_HOPS, MAX_TOOL_CALLS, a node budget, and per-tool input
 * clamps. Deterministic under the MockLLMProvider (scripted tool_calls) → fully unit-testable.
 */
import type { LLMProvider, ChatMessage, ToolCall } from "./llm";
import type {
  RetrievalPort,
  RetrievedNode,
  RetrievedEdge,
  Traversal,
  TimelineChange,
  NodeEventFact,
} from "./retrieval-port";
import type { EstateOverview } from "./retrieval-port";
import type { BuiltContext, Cite } from "./context";
import { PLANNER_SYSTEM } from "./prompt";
import { TOOL_SPECS, runTool } from "./tools";

const MAX_HOPS = 5;
const MAX_TOOL_CALLS = 12;
const NODE_BUDGET = 80;

export interface RetrievalStep {
  hop: number;
  tool: string;
  summary: string;
}

export interface LoopResult {
  built: BuiltContext;
  steps: RetrievalStep[];
  /** True once ANY grounded fact was accumulated (the grounding gate for the agentic path). */
  grounded: boolean;
}

/**
 * Accumulates citable facts across tool hops and renders one deterministic, marker-tagged
 * CONTEXT block (the multi-hop generalisation of buildContext). De-dups nodes/edges by id so a
 * node seen in two hops keeps one marker → citation binding stays deterministic (DD-5).
 */
export class ContextAccumulator {
  private readonly nodes = new Map<string, RetrievedNode>();
  private readonly edges = new Map<string, RetrievedEdge>();
  private readonly traversals: Traversal[] = [];
  private readonly timeline: TimelineChange[] = [];
  private estate: EstateOverview | undefined;
  private readonly events: Array<{ subject: string; items: NodeEventFact[] }> = [];
  private readonly diffs: Array<{ prName: string; text: string; truncated: boolean }> = [];
  private readonly notes: string[] = [];

  add(o: {
    nodes?: RetrievedNode[];
    edges?: RetrievedEdge[];
    traversal?: Traversal;
    timeline?: TimelineChange[];
    estate?: EstateOverview;
    events?: Array<{ subject: string; items: NodeEventFact[] }>;
    diff?: { prName: string; text: string; truncated: boolean };
  }): void {
    for (const n of o.nodes ?? []) this.nodes.set(n.id, n);
    for (const e of o.edges ?? []) this.edges.set(e.id, e);
    if (o.traversal) this.traversals.push(o.traversal);
    if (o.timeline?.length) this.timeline.push(...o.timeline);
    if (o.estate) this.estate = o.estate;
    if (o.events?.length) this.events.push(...o.events);
    if (o.diff) this.diffs.push(o.diff);
  }

  note(n: string): void {
    this.notes.push(n);
  }

  /** Distinct citable node ids surfaced so far (node budget + "nodes considered"). */
  nodeCount(): number {
    return this.nodes.size;
  }

  isEmpty(): boolean {
    return (
      this.nodes.size === 0 &&
      this.edges.size === 0 &&
      this.traversals.length === 0 &&
      this.timeline.length === 0 &&
      this.estate === undefined &&
      this.events.length === 0 &&
      this.diffs.length === 0
    );
  }

  build(orgId: string): BuiltContext {
    const cites: Cite[] = [];
    const nodeMarker = new Map<string, string>();
    const edgeMarker = new Map<string, string>();
    const nodeLines: string[] = [];
    const edgeLines: string[] = [];

    const nodeRef = (
      id: string,
      kind: string,
      name: string | null,
      confidence?: string | null,
    ): string => {
      let marker = nodeMarker.get(id);
      if (!marker) {
        marker = `N${nodeMarker.size + 1}`;
        nodeMarker.set(id, marker);
        cites.push({ marker, kind: "node", id, confidence: confidence ?? null });
        nodeLines.push(
          `  ${marker} (cite:${id}) kind=${kind} name=${name ?? "?"}${confidence ? ` confidence=${confidence}` : ""}`,
        );
      }
      return marker;
    };
    const edgeRef = (
      id: string,
      from: string,
      type: string,
      to: string,
      confidence: string,
    ): void => {
      if (edgeMarker.has(id)) return;
      const marker = `E${edgeMarker.size + 1}`;
      edgeMarker.set(id, marker);
      cites.push({ marker, kind: "edge", id, confidence });
      edgeLines.push(
        `  ${marker} (cite:${id}) ${from} --${type}--> ${to} confidence=${confidence}`,
      );
    };

    // Full nodes (from get_node).
    for (const n of this.nodes.values()) nodeRef(n.id, n.kind, n.name, n.confidence);

    // Traversals — root + impacted + the why-edge toward the root.
    for (const t of this.traversals) {
      const rootMarker = nodeRef(t.root.id, t.root.kind, t.root.name);
      for (const imp of t.impacted) {
        const fromMarker = nodeRef(imp.node.id, imp.node.kind, imp.node.name);
        const via = imp.via[0];
        if (via) edgeRef(via.edgeId, fromMarker, via.type, rootMarker, via.confidence);
      }
      if (t.truncated) this.notes.push("a traversal was truncated to the node budget");
      for (const w of t.warnings) this.notes.push(w);
    }

    // Loose edges (from get_neighbors) — register endpoints as nodes, then the edge.
    for (const e of this.edges.values()) {
      const fromMarker = nodeRef(e.from.id, "", e.from.name);
      const toMarker = nodeRef(e.to.id, "", e.to.name);
      edgeRef(e.id, fromMarker, e.type, toMarker, e.confidence);
    }

    const timelineLines = this.timeline.map(
      (c) => `  ${c.at} ${c.changeKind} ${c.changeType}: ${compact(c.entity)}`,
    );

    // Change-timeline events (from diagnose) → computed A-marker facts, deduped by event id.
    // The A namespace is shared with estate facts (markers must stay [NEA]\d+ for binding).
    let aCount = 0;
    const eventLines: string[] = [];
    const seenEvents = new Set<string>();
    for (const group of this.events) {
      for (const ev of group.items) {
        if (seenEvents.has(ev.id)) continue;
        seenEvents.add(ev.id);
        aCount += 1;
        const marker = `A${aCount}`;
        cites.push({ marker, kind: "computed", id: `event:${ev.id}`, confidence: "observed" });
        eventLines.push(
          `  ${marker} (cite:event:${ev.id}) ${ev.occurredAt} [${ev.kind}] on ${group.subject}: ${ev.title}${ev.actor ? ` (by ${ev.actor})` : ""}`,
        );
      }
    }

    // Estate (computed aggregate facts → A-markers, continuing the shared counter).
    const estateLines: string[] = [];
    if (this.estate) estateLines.push(...renderEstate(this.estate, cites, aCount));

    const sections: string[] = [`[CONTEXT — org:${orgId} — these are the ONLY facts you may use]`];
    if (nodeLines.length) sections.push("NODES:", ...nodeLines);
    if (edgeLines.length) sections.push("EDGES:", ...edgeLines);
    if (timelineLines.length) sections.push("CHANGES:", ...timelineLines);
    if (eventLines.length)
      sections.push(
        "CHANGE TIMELINE (what changed, when, by whom - cite the marker for any claim built on an event):",
        ...eventLines,
      );
    if (estateLines.length)
      sections.push(
        "ESTATE OVERVIEW (aggregate facts computed from your synced graph — state these figures directly and cite the marker):",
        ...estateLines,
      );
    if (this.diffs.length)
      sections.push(
        ...this.diffs.map(
          (d) =>
            `PR DIFF - ${d.prName}${d.truncated ? " (truncated)" : ""} (reference code; cite the PR's N marker when describing it):\n${d.text}`,
        ),
      );
    if (this.notes.length) sections.push("FRESHNESS:", ...this.notes.map((n) => `  ${n}`));
    sections.push("[END CONTEXT]");

    return {
      context: sections.join("\n"),
      cites,
      nodesConsidered: nodeMarker.size,
      freshnessNotes: [...this.notes],
    };
  }
}

/**
 * Run the agentic loop for a question. An async generator: it YIELDS each `RetrievalStep` as a
 * tool runs (so the caller can stream "show your work" live) and RETURNS the accumulated
 * `LoopResult`. Drain with a `for await` + capture the generator's return value, or use
 * `collectLoop` when you only need the result.
 */
export async function* retrievalLoop(
  deps: { port: RetrievalPort; llm: LLMProvider },
  orgId: string,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<RetrievalStep, LoopResult> {
  const acc = new ContextAccumulator();
  const steps: RetrievalStep[] = [];
  const messages: ChatMessage[] = [{ role: "user", content: question }];
  const seen = new Set<string>();
  let toolCalls = 0;

  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    if (signal?.aborted) break;
    const calls: ToolCall[] = [];
    for await (const ev of deps.llm.complete({
      system: PLANNER_SYSTEM,
      messages,
      tools: TOOL_SPECS,
      maxTokens: 512,
      temperature: 0,
      ...(signal ? { signal } : {}),
    })) {
      if (ev.type === "tool_call") calls.push({ id: ev.id, name: ev.name, input: ev.input });
      // planner tokens are "thinking about which tool" — not shown to the user.
    }
    if (calls.length === 0) break; // model has enough → stop gathering

    messages.push({ role: "assistant", content: "", toolCalls: calls });
    for (const c of calls) {
      if (toolCalls >= MAX_TOOL_CALLS) {
        acc.note("retrieval stopped at the tool-call budget");
        break;
      }
      const key = `${c.name}:${JSON.stringify(c.input)}`;
      if (seen.has(key)) {
        messages.push({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: "(already retrieved — try a different query or stop)",
        });
        continue;
      }
      seen.add(key);
      toolCalls += 1;
      const outcome = await runTool(deps.port, orgId, c.name, c.input);
      acc.add(outcome);
      const step: RetrievalStep = { hop, tool: c.name, summary: outcome.summary };
      steps.push(step);
      yield step;
      messages.push({ role: "tool", toolCallId: c.id, name: c.name, content: outcome.summary });
    }
    if (toolCalls >= MAX_TOOL_CALLS || acc.nodeCount() >= NODE_BUDGET) {
      acc.note("retrieval truncated to the budget");
      break;
    }
  }

  return { built: acc.build(orgId), steps, grounded: !acc.isEmpty() };
}

/** Drain the loop ignoring live steps — for the non-streaming path + unit tests. */
export async function collectLoop(
  deps: { port: RetrievalPort; llm: LLMProvider },
  orgId: string,
  question: string,
  signal?: AbortSignal,
): Promise<LoopResult> {
  const gen = retrievalLoop(deps, orgId, question, signal);
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

// --- helpers shared with context.ts's rendering (kept in sync deliberately) ---

function compact(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

function renderEstate(e: EstateOverview, cites: Cite[], startAt = 0): string[] {
  const lines: string[] = [];
  let a = startAt;
  const acite = (id: string, line: string): void => {
    a += 1;
    const marker = `A${a}`;
    cites.push({ marker, kind: "computed", id, confidence: "observed" });
    lines.push(`  ${marker} (cite:${id}) ${line}`);
  };
  const inv = e.inventory;
  acite(
    "estate:inventory",
    `inventory: repositories=${inv.repositories} services=${inv.services} datastores=${inv.datastores} pipelines=${inv.pipelines} openPullRequests=${inv.pullRequests} contributors=${inv.contributors} clouds=${inv.clouds} accounts=${inv.accounts} environments=${inv.environments} totalResources=${inv.resources} totalRelationships=${inv.relationships}`,
  );
  if (e.infrastructure.length) {
    acite(
      "estate:infrastructure",
      `cloud infrastructure by kind: ${e.infrastructure
        .map(
          (i) => `${i.kind}=${i.count}${i.notHealthy > 0 ? ` (${i.notHealthy} not healthy)` : ""}`,
        )
        .join(" · ")}`,
    );
  }
  if (e.topContributors.length)
    acite(
      "estate:contributors",
      `top contributors (last 30d, by pull requests raised): ${e.topContributors.map((c) => `${c.name ?? "unknown"}=${c.count}`).join(", ")}`,
    );
  if (e.mostActiveRepos.length)
    acite(
      "estate:active_repos",
      `most active repositories (last 30d, by pull requests): ${e.mostActiveRepos.map((r) => `${r.name ?? "unknown"}=${r.count}`).join(", ")}`,
    );
  if (e.pipelineCoverage.total > 0)
    acite(
      "estate:pipeline_coverage",
      `pipeline coverage: ${e.pipelineCoverage.withPipeline} of ${e.pipelineCoverage.total} repositories have a CI/CD pipeline`,
    );
  if (e.crossBoundary.crossCloud || e.crossBoundary.crossAccount)
    acite(
      "estate:cross_boundary",
      `cross-boundary edges: crossCloud=${e.crossBoundary.crossCloud} crossAccount=${e.crossBoundary.crossAccount}`,
    );
  if (e.findings.length)
    acite(
      "estate:findings",
      `needs attention: ${e.findings.map((f) => `[${f.severity}] ${f.title}${f.count !== undefined ? ` (${f.count})` : ""}`).join("; ")}`,
    );
  acite(
    "estate:sources",
    `connected sources: ${e.sources.total} (${e.sources.healthy} healthy)${e.sources.lastSyncAt ? `, last sync ${e.sources.lastSyncAt}` : ""}`,
  );
  return lines;
}
