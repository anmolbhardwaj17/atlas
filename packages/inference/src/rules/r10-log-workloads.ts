/**
 * R10 — log_workload_correlation → DEPLOYS_TO (operational-intelligence "reverse-
 * engineering" layer). CloudWatch log-group names evidence what runs INSIDE compute we
 * can't see into. For each `aws.logs.workload` signal (emitted by the AWS logs module),
 * this rule:
 *   1. normalizes the workload name (lowercase, alphanumeric, env suffix stripped) and
 *      matches it against Bitbucket/GitHub repository slugs the org has crawled;
 *   2. resolves WHERE that workload runs from the log-group's own naming:
 *        lambda  → the named Lambda function (exact)
 *        ecs     → the ECS service(s) whose task-definition family matches
 *        ec2/unknown → the account's EC2 instances (ambiguous by nature)
 *   3. emits DEPLOYS_TO(repo → host) with honest tiers: a unique, doubly-witnessed
 *      host (name match + log evidence) → inferred-high; EC2 with ONE instance →
 *      inferred-low (single-host heuristic); several instances → one inferred-low edge
 *      per instance, capped, never one wrong high (P3, BR-EDGE-4/5).
 * Evidence carries the log group + normalized names for citations (P4).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

interface WorkloadSignal {
  logGroup?: string;
  name?: string;
  host?: string;
  account?: string;
  region?: string;
  storedBytes?: number;
}

const EC2_EDGE_CAP = 3;

/** Normalize for matching: lowercase, drop non-alphanumerics, strip env suffixes. */
export function normalizeWorkload(raw: string): string {
  let v = raw.toLowerCase();
  v = v.replace(/[-_.](prod|production|prd|stage|staging|stg|demo|pilot|dev|test|qa)$/i, "");
  return v.replace(/[^a-z0-9]/g, "");
}

/** A repo matches a workload when normalized forms are equal, or one contains the other
 *  (min 5 chars so "api" can't glue everything together). */
// Generic tokens that appear in half the estate - shared alone they prove nothing.
// Exported so R11 (tag correlation) applies the same "generic value proves nothing" guard.
export const GENERIC_TOKENS = new Set([
  "function",
  "functions",
  "lambda",
  "lambdas",
  "service",
  "services",
  "server",
  "prod",
  "production",
  "demo",
  "pilot",
  "dev",
  "test",
  "stage",
  "staging",
  "qa",
  "aws",
  "logs",
  "log",
  "app",
  "web",
  "main",
  "core",
]);

function matches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // A residue that is itself a generic token proves nothing: env-suffix stripping turns
  // "lambda-test" into bare "lambda", which would substring-match every Lambda workload
  // at high confidence (caught live - P3).
  return short.length >= 5 && !GENERIC_TOKENS.has(short) && long.includes(short);
}

/** Split a name into meaningful tokens: separators + camelCase, drop short/generic ones. */
export function nameTokens(raw: string): Set<string> {
  const parts = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return new Set(
    parts
      .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))
      // Singular/plural fold: "integrations" (repo) must meet "integration" (workload).
      .map((t) => (t.length >= 5 && t.endsWith("s") ? t.slice(0, -1) : t)),
  );
}

/** Probable (token-level) match: >=2 shared meaningful tokens, or one shared token of
 *  length >=6 (distinctive enough on its own). Returns the shared tokens for evidence. */
function probableTokens(a: Set<string>, b: Set<string>, isRare: (t: string) => boolean): string[] {
  const shared = [...a].filter((t) => b.has(t));
  // >=2 shared tokens, one long distinctive token, or one SHORT token that is rare across
  // the org's repos ("chat" names 2 repos → distinctive here; "data" naming 15 would not be).
  if (shared.length >= 2 || shared.some((t) => t.length >= 6 || isRare(t))) return shared;
  return [];
}

export const logWorkloadCorrelationRule: Rule = {
  key: "log_workload_correlation",
  version: 2,
  evaluate(input: InferenceInput): RuleOutput {
    const repos = [
      ...(input.nodesByKind.get("bitbucket.repository") ?? []),
      ...(input.nodesByKind.get("github.repository") ?? []),
    ];
    const ec2s = input.nodesByKind.get("aws.ec2.instance") ?? [];
    const lambdas = input.nodesByKind.get("aws.lambda.function") ?? [];
    const ecsServices = input.nodesByKind.get("aws.ecs.service") ?? [];
    if (repos.length === 0) return { nodes: [], edges: [] };

    const repoNorm = repos
      .map((r) => ({
        node: r,
        norm: normalizeWorkload(String(r.attributes.slug ?? r.urn.split("/").pop() ?? "")),
      }))
      .filter((r) => r.norm.length >= 4);

    // Token rarity across repos: a short token shared with <=2 repos is distinctive.
    const tokenRepoCount = new Map<string, number>();
    for (const r of repoNorm) {
      for (const t of nameTokens(String(r.node.attributes.slug ?? ""))) {
        tokenRepoCount.set(t, (tokenRepoCount.get(t) ?? 0) + 1);
      }
    }
    const isRareToken = (t: string): boolean => (tokenRepoCount.get(t) ?? 0) <= 2;

    const best = new Map<string, InferredEdge>();
    const keep = (e: InferredEdge): void => {
      const k = `${e.fromUrn}→${e.toUrn}`;
      const prev = best.get(k);
      if (!prev || (prev.tier === "inferred-low" && e.tier === "inferred-high")) best.set(k, e);
    };

    for (const signal of input.signalsByKind.get("aws.logs.workload") ?? []) {
      const data = signal.data as WorkloadSignal;
      const workload = data.name;
      if (!workload || !data.host) continue;
      const norm = normalizeWorkload(workload);
      if (norm.length < 4) continue;
      // AWS stock solutions (WAF Security Automations etc.) are vendor deployments -
      // no customer repo ships them; matching them only manufactures noise.
      if (/^(wafsecurityautomations|waf-|aws-)/i.test(workload)) continue;

      // Strong path: normalized substring match. Probable path: shared name tokens -
      // "this repo PROBABLY ships this workload" - always inferred-low, evidence names
      // the shared tokens so the claim is inspectable (P4).
      const strong = repoNorm.filter((r) => matches(r.norm, norm));
      const wlTokens = nameTokens(workload);
      const probable =
        strong.length > 0
          ? []
          : repoNorm
              .map((r) => ({
                ...r,
                shared: probableTokens(
                  nameTokens(String(r.node.attributes.slug ?? "")),
                  wlTokens,
                  isRareToken,
                ),
              }))
              .filter((r) => r.shared.length > 0)
              .slice(0, 3);
      const matchedRepos = strong.length > 0 ? strong : probable;
      if (matchedRepos.length === 0) continue;
      const probableOnly = strong.length === 0;

      // Resolve the host the log group itself names.
      let hosts: Array<{ node: NodeLite; tier: "inferred-high" | "inferred-low" }> = [];
      if (data.host === "lambda") {
        const fns = lambdas.filter((f) => f.attributes.functionName === workload);
        hosts = fns.map((f) => ({
          node: f,
          tier: fns.length === 1 ? "inferred-high" : "inferred-low",
        }));
      } else if (data.host === "ecs") {
        const svcs = ecsServices.filter((s) => {
          const td = s.attributes.taskDefinition;
          const family = typeof td === "string" ? /task-definition\/([^:/]+)/.exec(td)?.[1] : null;
          return family ? matches(normalizeWorkload(family), norm) : false;
        });
        hosts = svcs.map((s) => ({
          node: s,
          tier: svcs.length === 1 ? "inferred-high" : "inferred-low",
        }));
      } else {
        // ec2 / unknown: the workload lives on a box we can't see into. One instance →
        // it can only be there (still low: a name heuristic). Several → low each, capped.
        if (ec2s.length > 0 && ec2s.length <= EC2_EDGE_CAP) {
          hosts = ec2s.map((i) => ({ node: i, tier: "inferred-low" as const }));
        }
      }

      for (const repo of matchedRepos) {
        for (const h of hosts) {
          keep({
            type: "DEPLOYS_TO",
            fromUrn: repo.node.urn,
            toUrn: h.node.urn,
            // A token-level match is never more than probable, whatever the host says.
            tier: probableOnly ? "inferred-low" : h.tier,
            evidence: {
              rule: "log-workload",
              match: probableOnly ? "probable-name-tokens" : "name-substring",
              ...(probableOnly && "shared" in repo
                ? { sharedTokens: (repo as { shared: string[] }).shared }
                : {}),
              logGroup: data.logGroup,
              workload,
              matchedRepoSlug: repo.norm,
              hostKind: data.host,
              source: signal.subjectUrn,
            },
          });
        }
      }
    }
    return { nodes: [], edges: [...best.values()] };
  },
};
