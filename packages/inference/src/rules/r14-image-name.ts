/**
 * R14 — image_name_correlation → DEPLOYS_TO (docs/05 §6.4).
 *
 * The companion to R12: when an ECS task-def's image tag is NOT a git SHA (`:latest`, `:v1.2.3`),
 * R12's commit match can't fire — but the image's REPOSITORY NAME still names the code. Teams name
 * their ECR image after the repo (`…/api-backend:latest` ← repo `api-backend-provapt`,
 * `…/integration-prod:latest` ← repo `integrations`). This matches that name to a crawled repo slug
 * and links the repo to the ECS service running the task-def.
 *
 * The image name is a DELIBERATE deploy artifact (like a tag in R11), so a unique match earns
 * `inferred-high`; several repos matching → `inferred-low` each (P3 — never one wrong high). Reuses
 * R10's `normalizeWorkload` + `GENERIC_TOKENS`; matching is exact-or-substring (min 5, non-generic)
 * so an image stem (`api-backend`) meets its fuller repo slug (`api-backend-provapt`), but `api`
 * can't glue everything together. Evidence carries the image + matched slug (P4).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";
import { normalizeWorkload, GENERIC_TOKENS } from "./r10-log-workloads";

/** The image repository name (last path segment before the tag/digest) of an image URI.
 *  `123.dkr.ecr.us-east-1.amazonaws.com/team/api-backend:latest` → `api-backend`. */
export function imageName(image: string): string | null {
  const beforeDigest = image.split("@")[0] ?? image;
  // Everything after the registry host (first `/`), so a host:port isn't mistaken for a tag.
  const afterHost = beforeDigest.includes("/")
    ? beforeDigest.slice(beforeDigest.indexOf("/") + 1)
    : beforeDigest;
  const noTag = afterHost.split(":")[0] ?? afterHost;
  return noTag.split("/").filter(Boolean).pop() ?? null;
}

/** The task-def family named by an ECS service's `taskDefinition` ARN (…task-definition/<family>:rev). */
function familyOf(node: NodeLite): string | null {
  const td = node.attributes.taskDefinition;
  if (typeof td !== "string") return null;
  return /task-definition\/([^:/]+)/.exec(td)?.[1] ?? null;
}

/** Exact, or one normalized form contains the other (min 5, non-generic) — an image stem meeting a
 *  fuller repo slug. Mirrors R10's `matches` precision guard. */
function nameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && !GENERIC_TOKENS.has(short) && long.includes(short);
}

export const imageNameCorrelationRule: Rule = {
  key: "image_name_correlation",
  version: 1,
  consumesKinds: ["bitbucket.repository", "github.repository", "aws.ecs.service", "aws.ecs.taskdef"],
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

    const repoNorm = repos
      .map((r) => ({
        node: r,
        norm: normalizeWorkload(String(r.attributes.slug ?? r.urn.split("/").pop() ?? "")),
      }))
      .filter((r) => r.norm.length >= 4);
    if (repoNorm.length === 0) return { nodes: [], edges: [] };

    // taskdef family → its images (the `images` attribute the ECS module captures).
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
        const name = imageName(image);
        if (!name) continue;
        const norm = normalizeWorkload(name);
        if (norm.length < 4 || GENERIC_TOKENS.has(norm)) continue;
        const matched = repoNorm.filter((r) => nameMatches(r.norm, norm));
        if (matched.length === 0) continue;
        const tier = matched.length === 1 ? "inferred-high" : "inferred-low";
        for (const r of matched) {
          keep({
            type: "DEPLOYS_TO",
            fromUrn: r.node.urn,
            toUrn: service.urn,
            tier,
            evidence: {
              rule: "image-name",
              match: "ecr-image-name",
              image,
              imageName: name,
              matchedRepoSlug: r.norm,
              source: service.urn,
            },
          });
        }
      }
    }
    return { nodes: [], edges: [...best.values()] };
  },
};
