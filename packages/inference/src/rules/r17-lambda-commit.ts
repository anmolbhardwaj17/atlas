/**
 * R17 — lambda_commit_provenance → DEPLOYS_TO (docs/plans/operational-intelligence.md, Phase A).
 *
 * The Lambda sibling of R12. ECS runs an ECR image whose tag carries the build SHA; a Lambda's
 * deployed commit hides in one of three places instead:
 *   1. a container Lambda's image URI tag (`…/repo:main-a1b2c3d`) — identical to R12's ECS path;
 *   2. the function `Description` (CI often stamps "deployed from a1b2c3d");
 *   3. a tag value (`GIT_SHA=a1b2c3d`).
 * If any candidate SHA matches a crawled PR's commit hash, that repo `DEPLOYS_TO` the Lambda.
 *
 * Confidence mirrors R12: a git-SHA match is near-certain provenance (`inferred-high`); a token that
 * matches commits in several repos degrades to `inferred-low` each (P3 — never one wrong high). NOT
 * observed: a rule correlates two observed facts (the SHA on the function + the PR SHA); a directly-read
 * deploy record (a CI/CD connector) is what earns `observed`. `CodeSha256` is deliberately ignored — it
 * is a hash of the deployment zip, NOT a git SHA, so treating it as one would fabricate matches.
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";
import { shasFromImage } from "./r12-images";

const PR_KINDS = ["bitbucket.pullrequest", "github.pull_request"];
/** Git SHA token (7–40 hex, word-bounded) — the ≥1-letter guard excludes pure-numeric build dates. */
const SHA_WORD = /\b[0-9a-f]{7,40}\b/gi;

/** Extract candidate git SHAs from free text (a description / tag value). */
export function shasFromText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(SHA_WORD) ?? []) {
    const t = m.toLowerCase();
    if (/[a-f]/.test(t)) out.push(t); // must contain a hex letter → not a date/number
  }
  return out;
}

/** All candidate SHAs a Lambda node exposes, tagged with where each came from (for the citation). */
function lambdaShaCandidates(fn: NodeLite): Array<{ sha: string; via: string; raw: string }> {
  const out: Array<{ sha: string; via: string; raw: string }> = [];
  const image = fn.attributes.imageUri;
  if (typeof image === "string") {
    for (const sha of shasFromImage(image)) out.push({ sha, via: "image-tag-sha", raw: image });
  }
  const desc = fn.attributes.description;
  if (typeof desc === "string") {
    for (const sha of shasFromText(desc)) out.push({ sha, via: "description-sha", raw: desc });
  }
  const tags = fn.attributes.tags;
  if (tags && typeof tags === "object") {
    for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      for (const sha of shasFromText(v)) out.push({ sha, via: "tag-sha", raw: `${k}=${v}` });
    }
  }
  return out;
}

export const lambdaCommitProvenanceRule: Rule = {
  key: "lambda_commit_provenance",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    const repos = [
      ...(input.nodesByKind.get("bitbucket.repository") ?? []),
      ...(input.nodesByKind.get("github.repository") ?? []),
    ];
    const lambdas = input.nodesByKind.get("aws.lambda.function") ?? [];
    if (repos.length === 0 || lambdas.length === 0) return { nodes: [], edges: [] };

    // repo slug → repo node (PRs carry the slug that identifies their repo).
    const repoBySlug = new Map<string, NodeLite>();
    for (const r of repos) {
      const slug = String(r.attributes.slug ?? r.urn.split("/").pop() ?? "");
      if (slug) repoBySlug.set(slug, r);
    }

    // commit SHA (full) → the repos whose PRs carry it. Usually exactly one.
    const reposBySha = new Map<string, Set<NodeLite>>();
    for (const kind of PR_KINDS) {
      for (const pr of input.nodesByKind.get(kind) ?? []) {
        const slug = String(pr.attributes.repoSlug ?? pr.attributes.repo ?? "");
        const repo = repoBySlug.get(slug);
        if (!repo) continue;
        const shas = pr.attributes.commitShas;
        if (!Array.isArray(shas)) continue;
        for (const raw of shas) {
          if (typeof raw !== "string" || raw.length < 7) continue;
          const sha = raw.toLowerCase();
          const set = reposBySha.get(sha) ?? new Set<NodeLite>();
          set.add(repo);
          reposBySha.set(sha, set);
        }
      }
    }
    if (reposBySha.size === 0) return { nodes: [], edges: [] };
    const commitShas = [...reposBySha.keys()];

    const best = new Map<string, InferredEdge>();
    const keep = (e: InferredEdge): void => {
      const k = `${e.fromUrn}→${e.toUrn}`;
      const prev = best.get(k);
      if (!prev || (prev.tier === "inferred-low" && e.tier === "inferred-high")) best.set(k, e);
    };

    for (const fn of lambdas) {
      for (const cand of lambdaShaCandidates(fn)) {
        // Prefix match: the token may be a 7-char short SHA, the commit stores the full 40.
        const matchedShas = commitShas.filter(
          (c) => c.startsWith(cand.sha) || cand.sha.startsWith(c),
        );
        for (const matchedSha of matchedShas) {
          const matchedRepos = [...(reposBySha.get(matchedSha) ?? [])];
          const tier = matchedRepos.length === 1 ? "inferred-high" : "inferred-low";
          for (const repo of matchedRepos) {
            keep({
              type: "DEPLOYS_TO",
              fromUrn: repo.urn,
              toUrn: fn.urn,
              tier,
              evidence: {
                rule: "lambda-commit",
                match: cand.via,
                source: fn.urn,
                lambdaSha: cand.sha,
                matchedCommitSha: matchedSha,
                from: cand.raw,
              },
            });
          }
        }
      }
    }
    return { nodes: [], edges: [...best.values()] };
  },
};
