/**
 * Retrieval tool registry (docs/plans/ai-knowledge-engine-p1-design §5, DD-P1-4). The agentic
 * loop lets the LLM gather grounded context by calling these - a SMALL, typed, read-only,
 * org-scoped, BOUNDED surface over the RetrievalPort (never the open world, A41/AE-7). Each tool:
 *   - advertises a JSON-schema `ToolSpec` to the model,
 *   - clamps its inputs server-side (never trusts model numbers - AIR-7),
 *   - returns a `ToolOutcome`: a compact `summary` for the model + structured, citable facts for
 *     the ContextAccumulator (so citation binding stays deterministic no matter how many hops).
 *
 * This is also the exact surface we later publish as MCP (docs/10 §12) - one design, two consumers.
 */
import type {
  EstateOverview,
  NodeEventFact,
  RetrievalPort,
  RetrievedEdge,
  RetrievedNode,
  SearchHit,
  TimelineChange,
  Traversal,
} from "./retrieval-port";
import type { ToolSpec } from "./llm";

/** What a tool contributes: a model-facing summary + citable facts for the accumulator. */
export interface ToolOutcome {
  /** Compact, token-frugal text shown to the model as the tool result. */
  summary: string;
  /** Full nodes to cite (from get_node). */
  nodes?: RetrievedNode[];
  /** Edges to cite (from get_neighbors). */
  edges?: RetrievedEdge[];
  /** A traversal to cite (from traverse). */
  traversal?: Traversal;
  /** Recent changes (from timeline). */
  timeline?: TimelineChange[];
  /** Whole-org aggregate snapshot (from estate_overview). */
  estate?: EstateOverview;
  /** Change-timeline facts per subject node (from diagnose) - each event is citable. */
  events?: Array<{ subject: string; items: NodeEventFact[] }>;
  /** An on-demand PR diff (from get_pr_diff) - reference text tied to the PR node. */
  diff?: { prName: string; text: string; truncated: boolean };
}

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "number" ? Math.floor(v) : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
};
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

/** The P1 tool set. Each entry is a spec (for the model) + a bounded `run` (over the port). */
interface Tool {
  spec: ToolSpec;
  run(port: RetrievalPort, orgId: string, input: Record<string, unknown>): Promise<ToolOutcome>;
}

const TOOLS: Record<string, Tool> = {
  search: {
    spec: {
      name: "search",
      description:
        "Find candidate graph nodes (services, resources, repos, people, PRs) matching a query. Returns id/kind/name to then fetch with get_node. Use for entity questions before get_node/traverse.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "search terms (a name, id, or concept)" },
          limit: { type: "integer", description: "max hits (1-10)" },
        },
        required: ["q"],
      },
    },
    async run(port, orgId, input) {
      const limit = clampInt(input.limit, 1, 10, 5);
      const hits = await port.search(orgId, asStr(input.q), limit);
      return { summary: summariseHits(hits) };
    },
  },

  get_node: {
    spec: {
      name: "get_node",
      description:
        "Fetch full detail + provenance for one node by id (from search/traverse). Use to state facts about a specific entity.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "node id" } },
        required: ["id"],
      },
    },
    async run(port, orgId, input) {
      const node = await port.getNode(orgId, asStr(input.id));
      if (!node) return { summary: `no node found for id=${asStr(input.id)}` };
      return {
        summary: `node ${node.name ?? "?"} kind=${node.kind} status=${node.status} confidence=${node.confidence}${node.region ? ` region=${node.region}` : ""}`,
        nodes: [node],
      };
    },
  },

  get_neighbors: {
    spec: {
      name: "get_neighbors",
      description:
        "List the 1-hop edges of a node (what it connects to / what connects to it), optionally filtered by edge type. Use to understand a specific entity's relationships.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "node id" },
          direction: { type: "string", enum: ["in", "out", "both"] },
          edgeType: { type: "string", description: "optional edge type filter, e.g. DEPLOYS_TO" },
        },
        required: ["id"],
      },
    },
    async run(port, orgId, input) {
      const dir = input.direction === "in" || input.direction === "out" ? input.direction : "both";
      let edges = await port.edges(orgId, asStr(input.id), dir);
      const type = asStr(input.edgeType);
      if (type) edges = edges.filter((e) => e.type === type);
      return { summary: summariseEdges(edges), edges };
    },
  },

  traverse: {
    spec: {
      name: "traverse",
      description:
        "Traverse the graph from a node: mode='blast' = what breaks if it fails (inbound impact closure); mode='deps' = what it depends on. Use for impact/dependency questions.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "node id" },
          mode: { type: "string", enum: ["blast", "deps"] },
          depth: { type: "integer", description: "max hops (1-5)" },
        },
        required: ["id", "mode"],
      },
    },
    async run(port, orgId, input) {
      const depth = clampInt(input.depth, 1, 5, 3);
      const id = asStr(input.id);
      const t =
        input.mode === "deps"
          ? await port.dependencies(orgId, id, { depth })
          : await port.blastRadius(orgId, id, { depth });
      return {
        summary: summariseTraversal(t, input.mode === "deps" ? "depends on" : "impacts"),
        traversal: t,
      };
    },
  },

  timeline: {
    spec: {
      name: "timeline",
      description:
        "List recent graph changes (nodes/edges created or updated) in the last N days. Use for 'what changed / happened recently' questions.",
      inputSchema: {
        type: "object",
        properties: {
          sinceDays: { type: "integer", description: "look-back window in days (1-90)" },
        },
      },
    },
    async run(port, orgId, input) {
      const sinceDays = clampInt(input.sinceDays, 1, 90, 7);
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const changes = await port.timeline(orgId, since, null, 50);
      return {
        summary: `${changes.length} change(s) in the last ${sinceDays}d`,
        timeline: changes,
      };
    },
  },

  estate_overview: {
    spec: {
      name: "estate_overview",
      description:
        "Whole-org aggregate snapshot: inventory counts (repos/services/datastores/clouds/etc.), top contributors, most active repos, pipeline coverage, and findings. Use for 'how many / top / most / what do I have / what needs attention' questions.",
      inputSchema: { type: "object", properties: {} },
    },
    async run(port, orgId) {
      const e = await port.estateOverview(orgId);
      return { summary: summariseEstate(e), estate: e };
    },
  },

  diagnose: {
    spec: {
      name: "diagnose",
      description:
        "Root-cause helper for a broken/unhealthy resource: returns its live health, its blast radius, WHO DEPLOYS TO IT, and the change timeline (config changes, deploys, health transitions, merged PRs) for it and its deployers in a time window. Use for 'why is X broken / unhealthy / failing' questions, then get_pr_diff on a suspicious merged PR.",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string", description: "the id of the broken/suspect node" },
          hours: { type: "number", description: "lookback window in hours (default 48, max 336)" },
        },
        required: ["node_id"],
      },
    },
    async run(port, orgId, input) {
      const id = asStr(input.node_id);
      const hours = clampInt(input.hours, 1, 336, 48);
      const node = await port.getNode(orgId, id);
      if (!node) return { summary: `no node with id ${id}` };

      const [events, edges, blast] = await Promise.all([
        port.nodeEvents(orgId, id, 40),
        port.edges(orgId, id, "both"),
        port.blastRadius(orgId, id, { depth: 2 }),
      ]);
      const cutoff = Date.now() - hours * 3_600_000;
      const inWindow = (evs: NodeEventFact[]): NodeEventFact[] =>
        evs.filter((e) => new Date(e.occurredAt).getTime() >= cutoff);

      const own = inWindow(events).slice(0, 15);
      // Who ships code onto this node - their recent merges/deploys are prime suspects.
      const deployers = edges.filter((e) => e.type === "DEPLOYS_TO" && e.to.id === id).slice(0, 3);
      const deployerEvents: Array<{ subject: string; items: NodeEventFact[] }> = [];
      for (const d of deployers) {
        const evs = inWindow(await port.nodeEvents(orgId, d.from.id, 30)).slice(0, 10);
        if (evs.length > 0) deployerEvents.push({ subject: d.from.name ?? d.from.id, items: evs });
      }

      const fmt = (e: NodeEventFact): string =>
        `${e.occurredAt} [${e.kind}] ${e.title}${e.actor ? ` (by ${e.actor})` : ""}`;
      const lines: string[] = [
        `${node.name ?? node.id} (${node.kind})` +
          (node.health
            ? ` - health: ${node.health.state}${node.health.reason ? ` (${node.health.reason})` : ""}`
            : " - health: unknown (not checked)"),
        own.length
          ? `its changes in the last ${hours}h:\n${own.map(fmt).join("\n")}`
          : `no recorded changes on it in the last ${hours}h`,
        ...deployerEvents.map(
          (d) => `changes on deployer ${d.subject}:\n${d.items.map(fmt).join("\n")}`,
        ),
        deployers.length === 0 ? "no repository is known to deploy to it (no DEPLOYS_TO edge)" : "",
        `blast radius: ${blast.impacted.length} resource(s) depend on it`,
        "Correlate the timeline with the failure: rank hypotheses by how close in time and how directly connected each change is, cite every claim, and inspect a suspicious merged PR with get_pr_diff. If the window shows no changes, say plainly that no likely culprit was found in it - do not invent one.",
      ].filter(Boolean);

      const eventFacts = [
        ...(own.length ? [{ subject: node.name ?? node.id, items: own }] : []),
        ...deployerEvents,
      ];
      return {
        summary: lines.join("\n"),
        nodes: [node],
        edges: deployers,
        traversal: blast,
        ...(eventFacts.length ? { events: eventFacts } : {}),
      };
    },
  },

  get_pr_diff: {
    spec: {
      name: "get_pr_diff",
      description:
        "Fetch the actual code diff of a merged/open pull-request NODE (id from diagnose or search). Use it to check whether a suspicious PR plausibly caused a failure. Returns the diff text (truncated).",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string", description: "the pull-request node id" },
        },
        required: ["node_id"],
      },
    },
    async run(port, orgId, input) {
      const id = asStr(input.node_id);
      const node = await port.getNode(orgId, id);
      if (!node) return { summary: `no node with id ${id}` };
      const diff = await port.prDiff(orgId, id, 12_000);
      if (!diff) {
        return {
          summary: `no diff available for ${node.name ?? id} (not a pull request, or the source is unreachable)`,
          nodes: [node],
        };
      }
      return {
        summary:
          `diff of ${node.name ?? id}${diff.truncated ? " (truncated)" : ""} - cite this PR's N marker when referencing it:\n` +
          diff.text,
        nodes: [node],
        diff: { prName: node.name ?? id, text: diff.text, truncated: diff.truncated },
      };
    },
  },
};

/** Tool specs to advertise to the model. */
export const TOOL_SPECS: ToolSpec[] = Object.values(TOOLS).map((t) => t.spec);
export const TOOL_NAMES = Object.keys(TOOLS);

/** Execute a tool by name with clamped input. Unknown tool → a structured error the model can
 *  recover from (never throws into the loop). */
export async function runTool(
  port: RetrievalPort,
  orgId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const tool = TOOLS[name];
  if (!tool)
    return { summary: `error: unknown tool "${name}". Available: ${TOOL_NAMES.join(", ")}` };
  try {
    return await tool.run(port, orgId, input ?? {});
  } catch (err) {
    return { summary: `error running ${name}: ${(err as Error).message}` };
  }
}

// ---- compact model-facing summaries (token-frugal; the full facts go to the accumulator) ----

function summariseHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "no matches";
  return `${hits.length} candidate(s): ${hits
    .slice(0, 10)
    .map((h) => `${h.name ?? "?"} (${h.kind}) [${h.id}]`)
    .join("; ")}`;
}

function summariseEdges(edges: RetrievedEdge[]): string {
  if (edges.length === 0) return "no edges";
  return `${edges.length} edge(s): ${edges
    .slice(0, 20)
    .map(
      (e) => `${e.from.name ?? e.from.id} --${e.type}--> ${e.to.name ?? e.to.id} (${e.confidence})`,
    )
    .join("; ")}`;
}

function summariseTraversal(t: Traversal, verb: string): string {
  if (t.impacted.length === 0) return `nothing ${verb} ${t.root.name ?? t.root.id}`;
  return `${t.root.name ?? t.root.id} ${verb} ${t.impacted.length}: ${t.impacted
    .slice(0, 15)
    .map((i) => `${i.node.name ?? i.node.id} (d${i.distance}, ${i.pathConfidence})`)
    .join("; ")}${t.truncated ? " (truncated)" : ""}`;
}

function summariseEstate(e: EstateOverview): string {
  const inv = e.inventory;
  const parts = [
    `inventory: repositories=${inv.repositories} services=${inv.services} datastores=${inv.datastores} pipelines=${inv.pipelines} openPRs=${inv.pullRequests} contributors=${inv.contributors} clouds=${inv.clouds} accounts=${inv.accounts}`,
    ...(e.infrastructure.length
      ? [
          `cloud infrastructure: ${e.infrastructure
            .map(
              (i) =>
                `${i.kind}=${i.count}${i.notHealthy > 0 ? ` (${i.notHealthy} not healthy)` : ""}`,
            )
            .join(" · ")}`,
        ]
      : []),
  ];
  if (e.topContributors.length)
    parts.push(
      `top contributors: ${e.topContributors.map((c) => `${c.name}=${c.count}`).join(", ")}`,
    );
  if (e.mostActiveRepos.length)
    parts.push(
      `most active repos: ${e.mostActiveRepos.map((r) => `${r.name}=${r.count}`).join(", ")}`,
    );
  if (e.pipelineCoverage.total)
    parts.push(`pipeline coverage: ${e.pipelineCoverage.withPipeline}/${e.pipelineCoverage.total}`);
  if (e.findings.length)
    parts.push(`findings: ${e.findings.map((f) => `[${f.severity}] ${f.title}`).join("; ")}`);
  return parts.join(" | ");
}
