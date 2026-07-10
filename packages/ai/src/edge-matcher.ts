/**
 * AI edge matcher (docs/05 §6, docs/10) — the reasoning layer on top of deterministic inference.
 * Given runtimes with NO code link and the org's candidate repos, it asks the model whether any
 * repo plausibly deploys to / runs on each runtime, and WHY. Output is proposals only — never
 * asserted as fact: they become `origin='ai_suggested'` edges the user confirms or rejects (P3).
 *
 * Pure and NestJS-free (mirrors answer.ts): takes an `LLMProvider`, collects a single-shot
 * completion, and parses a strict JSON array. A deterministic pre-gate (caller side) ensures we
 * only spend a model call when there's real context. Every proposal is validated against the input
 * URNs, so a hallucinated node can never become an edge (P4).
 */
import type { LLMProvider } from "./llm";

export interface RuntimeCandidate {
  urn: string;
  /** aws.lambda.function | aws.ecs.service | aws.ec2.instance | … */
  kind: string;
  name: string;
  /** A compact, safe attribute bag (tags, key config) — no secrets. */
  facts: Record<string, string>;
}

export interface RepoCandidate {
  urn: string;
  slug: string;
  language?: string | null;
  description?: string | null;
}

export interface EdgeMatcherInput {
  runtimes: RuntimeCandidate[];
  repos: RepoCandidate[];
}

/** One AI-proposed repo→runtime link. `confidence` is the MODEL's self-assessment (kept in
 *  evidence for the user); the edge itself is always stored at the app's `ai-suggested` tier. */
export interface EdgeSuggestion {
  repoUrn: string;
  runtimeUrn: string;
  confidence: "low" | "medium" | "high";
  reasoning: string;
}

const SYSTEM = `You are an infrastructure analyst for Atlas, an engineering knowledge graph.
Your job: decide which source-code REPOSITORY (if any) is deployed to / runs on each cloud RUNTIME.

Runtimes are Lambda functions, ECS services, AND EC2 instances — treat all three equally. An EC2
instance or ECS service is just as likely to be a repo's deployment target as a Lambda; match on its
name, tags (esp. Name), and (for ECS) its task-def family / container image.

Rules:
- Only propose a link when there is a concrete, defensible reason: the names clearly correspond
  (including stems — an EC2 "report-server" plausibly runs a "reports-generator" repo), or a repo's
  stated purpose/language plainly matches what the runtime does.
- BUT some runtimes are infrastructure with NO product repo: a VPN, bastion, Jenkins/CI box, a
  CLI/utility host, a migration or patch server, a NAT/proxy. Do NOT match those to a repo — omit them.
- Prefer NO link over a wrong link. If nothing plausibly matches a runtime, omit it. Never force a match.
- Never invent repos or runtimes. Only use the exact urns given to you.
- Each proposal must include a short, specific reason a human can verify (name similarity/stem,
  purpose, language, tags, image).
- Assign the MODEL's own confidence: "high" (names/purpose clearly correspond), "medium" (a solid but
  not certain fit), "low" (a plausible stem/purpose guess worth a human glance).

Respond with ONLY a JSON array (no prose, no markdown fences), each element:
{"repoUrn": "...", "runtimeUrn": "...", "confidence": "high|medium|low", "reasoning": "..."}
If there are no defensible matches, respond with [].`;

function buildUserMessage(input: EdgeMatcherInput): string {
  const runtimes = input.runtimes
    .map((r) => {
      const facts = Object.entries(r.facts)
        .slice(0, 8)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `- urn=${r.urn} | kind=${r.kind} | name=${r.name}${facts ? ` | ${facts}` : ""}`;
    })
    .join("\n");
  const repos = input.repos
    .map(
      (r) =>
        `- urn=${r.urn} | slug=${r.slug}${r.language ? ` | lang=${r.language}` : ""}${
          r.description ? ` | ${r.description.slice(0, 120)}` : ""
        }`,
    )
    .join("\n");
  return `RUNTIMES (each needs a repo, if one plausibly matches):\n${runtimes}\n\nCANDIDATE REPOSITORIES:\n${repos}`;
}

/** Strip markdown fences and pull out the first JSON array in the text (defensive parsing). */
function extractJsonArray(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Run the matcher. Returns validated proposals — each references a real input runtime + repo, has a
 * non-empty reason, and a valid confidence. Returns [] on empty input or an unparseable response
 * (never throws for a bad model reply — the caller treats "no suggestions" as a valid outcome).
 */
export async function matchEdges(
  llm: LLMProvider,
  input: EdgeMatcherInput,
  opts?: { signal?: AbortSignal },
): Promise<EdgeSuggestion[]> {
  if (input.runtimes.length === 0 || input.repos.length === 0) return [];

  let text = "";
  for await (const ev of llm.complete({
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(input) }],
    maxTokens: 1500,
    temperature: 0, // grounded decision, not creativity
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })) {
    if (ev.type === "token") text += ev.text;
  }

  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];

  const runtimeUrns = new Set(input.runtimes.map((r) => r.urn));
  const repoUrns = new Set(input.repos.map((r) => r.urn));
  const out: EdgeSuggestion[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const repoUrn = typeof o.repoUrn === "string" ? o.repoUrn : "";
    const runtimeUrn = typeof o.runtimeUrn === "string" ? o.runtimeUrn : "";
    const reasoning = typeof o.reasoning === "string" ? o.reasoning.trim() : "";
    const confidence = o.confidence === "high" || o.confidence === "medium" ? o.confidence : "low";
    // Validate against the input — a hallucinated node can never become an edge (P4).
    if (!repoUrns.has(repoUrn) || !runtimeUrns.has(runtimeUrn) || !reasoning) continue;
    const key = `${repoUrn}→${runtimeUrn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repoUrn, runtimeUrn, confidence, reasoning });
  }
  return out;
}
