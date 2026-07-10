/**
 * R11 — tag_code_correlation → DEPLOYS_TO (docs/05 §6.4, docs/plans/signal-enrichment.md).
 *
 * AWS resources very often carry an explicit tag naming the code that owns/ships them
 * (`repository`, `service`, `application`, a CloudFormation stack name, …). Unlike a name
 * *guess* (R10), a tag is a DELIBERATE human label — so an exact, unique match to a crawled
 * repo is strong evidence and earns `inferred-high`; a value that matches several repos
 * falls to `inferred-low` per repo (P3 — many low, never one wrong high); a generic or
 * too-short value proves nothing and is skipped.
 *
 * Only compute runtimes (lambda / ecs.service / ec2) are `DEPLOYS_TO` targets — a `service`
 * tag on a *datastore* is ownership, not deployment (a future OWNED_BY extension), so it is
 * deliberately out of scope here. Evidence carries the tag key/value + matched slug (P4).
 *
 * The `Name` tag is handled too but always at `inferred-low`: it's a display label (often the
 * only identifier an EC2 box carries), weaker evidence than a deliberate code tag — so an exact
 * `Name` match to a repo is a hint, never asserted high. This is the main repo→EC2 bridge over
 * data we already crawl (no extra IAM), and the same exact-equality + generic guard keeps it
 * precise: a messy `Name` ("MyCo Prod Payments API") won't match; only a clean `payments` will.
 *
 * Reuses R10's `normalizeWorkload` (env-suffix + non-alphanum stripping) and `GENERIC_TOKENS`
 * so the two code↔infra matchers share one notion of "meaningful name".
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";
import { normalizeWorkload, GENERIC_TOKENS } from "./r10-log-workloads";

/** Tag keys (compared lowercased) whose value names the code that owns/ships a resource. */
const CODE_TAG_KEYS = new Set([
  "repository",
  "repo",
  "git_repository",
  "git-repository",
  "gitrepository",
  "service",
  "servicename",
  "service-name",
  "service_name",
  "application",
  "app",
  "appname",
  "app-name",
  "app_name",
  "project",
  "component",
  "aws:cloudformation:stack-name",
  // The instance/resource display name — the universal identifier (esp. for EC2). Weaker than a
  // deliberate code tag, so matches on it are forced to inferred-low below.
  "name",
]);

/** Tag keys that are display labels, not deliberate code labels → capped at inferred-low. */
const WEAK_TAG_KEYS = new Set(["name"]);

/** Kinds that can be a DEPLOYS_TO target: compute runtimes only (not datastores). */
const TARGET_KINDS = ["aws.lambda.function", "aws.ecs.service", "aws.ec2.instance"] as const;

/** The repo-identifying part of a tag value: the last path segment of a repo path/URL, with
 *  a trailing `.git` removed. `bitbucket.org/siemba/payments.git` → `payments`; `orders` → `orders`. */
export function repoSegment(raw: string): string {
  const v = raw.trim().replace(/\.git$/i, "");
  return v.split(/[/\\]/).filter(Boolean).pop() ?? v;
}

export const tagCodeCorrelationRule: Rule = {
  key: "tag_code_correlation",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    const repos = [
      ...(input.nodesByKind.get("bitbucket.repository") ?? []),
      ...(input.nodesByKind.get("github.repository") ?? []),
    ];
    if (repos.length === 0) return { nodes: [], edges: [] };

    // Index repos by normalized slug. A tag is explicit, so we match by EXACT equality
    // (not substring) — that is the precision guarantee (P3). Several repos can normalize
    // to the same slug (rare); that ambiguity is handled by tiering below.
    const reposByNorm = new Map<string, NodeLite[]>();
    for (const r of repos) {
      const slug = String(r.attributes.slug ?? r.urn.split("/").pop() ?? "");
      const norm = normalizeWorkload(slug);
      if (norm.length < 4) continue;
      const list = reposByNorm.get(norm);
      if (list) list.push(r);
      else reposByNorm.set(norm, [r]);
    }
    if (reposByNorm.size === 0) return { nodes: [], edges: [] };

    const best = new Map<string, InferredEdge>();
    const keep = (e: InferredEdge): void => {
      const k = `${e.fromUrn}→${e.toUrn}`;
      const prev = best.get(k);
      if (!prev || (prev.tier === "inferred-low" && e.tier === "inferred-high")) best.set(k, e);
    };

    for (const kind of TARGET_KINDS) {
      for (const host of input.nodesByKind.get(kind) ?? []) {
        const tags = host.attributes.tags;
        if (!tags || typeof tags !== "object") continue;
        for (const [rawKey, rawVal] of Object.entries(tags as Record<string, unknown>)) {
          if (typeof rawVal !== "string" || !rawVal) continue;
          if (!CODE_TAG_KEYS.has(rawKey.toLowerCase())) continue;
          const norm = normalizeWorkload(repoSegment(rawVal));
          // A generic ("service", "app") or too-short value proves nothing (P3).
          if (norm.length < 4 || GENERIC_TOKENS.has(norm)) continue;
          const matched = reposByNorm.get(norm);
          if (!matched || matched.length === 0) continue;
          // A deliberate code tag: unique match → inferred-high; ambiguous → inferred-low each
          // (never one wrong high). A `Name` (display-label) match is always inferred-low.
          const weak = WEAK_TAG_KEYS.has(rawKey.toLowerCase());
          const tier = !weak && matched.length === 1 ? "inferred-high" : "inferred-low";
          for (const repo of matched) {
            keep({
              type: "DEPLOYS_TO",
              fromUrn: repo.urn,
              toUrn: host.urn,
              tier,
              evidence: {
                rule: "tag-code",
                match: weak ? "resource-name-tag" : "resource-tag",
                tagKey: rawKey,
                tagValue: rawVal,
                matchedRepoSlug: norm,
                source: host.urn,
              },
            });
          }
        }
      }
    }
    return { nodes: [], edges: [...best.values()] };
  },
};
