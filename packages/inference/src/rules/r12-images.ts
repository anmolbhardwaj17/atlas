/**
 * R12 — image_commit_provenance → DEPLOYS_TO (docs/05 §6.4, docs/plans/signal-enrichment.md slice 2).
 *
 * The strongest code→infra matcher: instead of guessing from names (R1/R10) or labels (R11),
 * it matches the *artifact's actual build commit*. An ECS task definition runs an ECR image
 * whose TAG typically carries the git short-SHA it was built from (`repo:main-a1b2c3d`,
 * `:sha-a1b2c3d`, or a bare `a1b2c3d`). If that SHA matches a crawled PR's commit hash, the
 * running image was built from that commit → its repo `DEPLOYS_TO` the ECS service running it.
 *
 * Confidence: `inferred-high` — a git-SHA match is near-certain provenance. A token matching
 * commits in several repos → `inferred-low` each (P3 — never one wrong high). NOT `observed`:
 * a rule correlates two observed facts (image tag + PR SHA); a directly-read deploy record
 * (the CI/CD connector, docs/07c) is what earns `observed`.
 *
 * Precision guards (P3): a candidate SHA is 7–40 hex AND contains at least one `a–f` letter
 * (so pure-numeric build dates like `20240115` are not treated as SHAs); matching is by prefix
 * (image tags carry the 7-char short SHA; commits store the full 40). A tag with no SHA-shaped
 * token (`latest`, `v1.2.3`) yields nothing. Evidence carries the image + both SHAs (P4).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

const PR_KINDS = ["bitbucket.pullrequest", "github.pull_request"];
/** Git short-SHA (default 7) up to a full 40; must contain a hex letter (excludes date-like ints). */
const SHA_TOKEN = /[0-9a-f]*[a-f][0-9a-f]*/gi;

/** Extract candidate git SHAs (7–40 hex, ≥1 letter) from an image URI's tag portion. */
export function shasFromImage(image: string): string[] {
  // Drop any `@sha256:…` docker digest (not a git SHA), then take the tag after the last `:`.
  const beforeDigest = image.split("@")[0] ?? image;
  const colon = beforeDigest.lastIndexOf(":");
  const tag = colon > 0 ? beforeDigest.slice(colon + 1) : "";
  if (!tag) return [];
  const out: string[] = [];
  for (const m of tag.match(SHA_TOKEN) ?? []) {
    const t = m.toLowerCase();
    if (t.length >= 7 && t.length <= 40) out.push(t);
  }
  return out;
}

/** The taskdef family named by an ECS service's `taskDefinition` ARN (…task-definition/<family>:rev). */
function familyOf(node: NodeLite): string | null {
  const td = node.attributes.taskDefinition;
  if (typeof td !== "string") return null;
  return /task-definition\/([^:/]+)/.exec(td)?.[1] ?? null;
}

export const imageCommitProvenanceRule: Rule = {
  key: "image_commit_provenance",
  version: 1,
  consumesKinds: ["bitbucket.repository", "github.repository", "aws.ecs.service", "aws.ecs.taskdef", ...PR_KINDS],
  consumesSignalKinds: [],
  evaluate(input: InferenceInput): RuleOutput {
    const repos = [
      ...(input.nodesByKind.get("bitbucket.repository") ?? []),
      ...(input.nodesByKind.get("github.repository") ?? []),
    ];
    const services = input.nodesByKind.get("aws.ecs.service") ?? [];
    const taskdefs = input.nodesByKind.get("aws.ecs.taskdef") ?? [];
    if (repos.length === 0 || services.length === 0 || taskdefs.length === 0) {
      return { nodes: [], edges: [] };
    }

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

    // taskdef family → the images it runs (from the `images` attribute the ECS module captures).
    const imagesByFamily = new Map<string, string[]>();
    for (const td of taskdefs) {
      const family = String(td.attributes.family ?? "");
      const images = td.attributes.images;
      if (family && Array.isArray(images)) {
        imagesByFamily.set(
          family,
          images.filter((i): i is string => typeof i === "string"),
        );
      }
    }

    const best = new Map<string, InferredEdge>();
    const keep = (e: InferredEdge): void => {
      const k = `${e.fromUrn}→${e.toUrn}`;
      const prev = best.get(k);
      if (!prev || (prev.tier === "inferred-low" && e.tier === "inferred-high")) best.set(k, e);
    };

    for (const service of services) {
      const family = familyOf(service);
      if (!family) continue;
      for (const image of imagesByFamily.get(family) ?? []) {
        for (const token of shasFromImage(image)) {
          // Prefix match: the image carries the short SHA, the commit stores the full 40.
          const matchedShas = commitShas.filter((c) => c.startsWith(token) || token.startsWith(c));
          for (const matchedSha of matchedShas) {
            const matchedRepos = [...(reposBySha.get(matchedSha) ?? [])];
            const tier = matchedRepos.length === 1 ? "inferred-high" : "inferred-low";
            for (const repo of matchedRepos) {
              keep({
                type: "DEPLOYS_TO",
                fromUrn: repo.urn,
                toUrn: service.urn,
                tier,
                evidence: {
                  rule: "image-commit",
                  match: "image-tag-sha",
                  image,
                  imageSha: token,
                  matchedCommitSha: matchedSha,
                  source: service.urn,
                },
              });
            }
          }
        }
      }
    }
    return { nodes: [], edges: [...best.values()] };
  },
};
