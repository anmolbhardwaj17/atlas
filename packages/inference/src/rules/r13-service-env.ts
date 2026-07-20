/**
 * R13 — service_name_env_correlation → DEPLOYS_TO (docs/05 §6.4, docs/plans/signal-enrichment.md slice 3).
 *
 * A runtime usually self-reports its canonical service name in an env var — `OTEL_SERVICE_NAME`,
 * `DD_SERVICE`, `SERVICE_NAME`, or `service.name=` inside `OTEL_RESOURCE_ATTRIBUTES`. That name
 * is the identifier engineers actually use for the service, so matching it to a repo slug is a
 * high-signal, near-observed code→infra link — and it costs nothing new (the env vars are already
 * crawled as `aws.lambda.env` / `aws.ecs.env` signals for R3).
 *
 * Confidence: exact normalized equality to one repo → `inferred-high`; several repos with the same
 * normalized name → `inferred-low` each (P3). Generic/short values skipped (shared `GENERIC_TOKENS`).
 * Distinct from R3, which matches env *values* against datastore endpoints (not service names).
 *
 * Target runtime: the signal's subject — a Lambda directly, or (for a task-definition env) the ECS
 * service(s) running that family. Evidence carries the env key/value + matched slug (P4).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";
import { normalizeWorkload, GENERIC_TOKENS } from "./r10-log-workloads";

const ENV_SIGNAL_KINDS = ["aws.lambda.env", "aws.ecs.env"];

/** Env keys (compared uppercase) whose VALUE is the canonical service/app name at runtime. */
const SERVICE_NAME_KEYS = new Set([
  "OTEL_SERVICE_NAME",
  "DD_SERVICE",
  "DD_SERVICE_NAME",
  "SERVICE_NAME",
  "APP_NAME",
  "APPLICATION_NAME",
  "NEW_RELIC_APP_NAME",
  "SERVICE",
  "APP",
]);

/** `service.name` out of an OTEL_RESOURCE_ATTRIBUTES value (`service.name=payments,deployment.env=prod`). */
function otelServiceName(v: string): string | null {
  for (const part of v.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim().toLowerCase() === "service.name") {
      const val = part.slice(eq + 1).trim();
      if (val) return val;
    }
  }
  return null;
}

/** The recognized service-name values in an env-var record, each with the key it came from. */
export function serviceNameValues(
  vars: Record<string, unknown>,
): Array<{ key: string; name: string }> {
  const out: Array<{ key: string; name: string }> = [];
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== "string" || !v) continue;
    const key = k.toUpperCase();
    if (SERVICE_NAME_KEYS.has(key)) out.push({ key: k, name: v });
    else if (key === "OTEL_RESOURCE_ATTRIBUTES") {
      const name = otelServiceName(v);
      if (name) out.push({ key: k, name });
    }
  }
  return out;
}

export const serviceNameEnvRule: Rule = {
  key: "service_name_env_correlation",
  version: 1,
  consumesKinds: ["bitbucket.repository", "github.repository", "aws.ecs.service", "aws.lambda.function", "aws.ecs.taskdef"],
  consumesSignalKinds: ENV_SIGNAL_KINDS,
  evaluate(input: InferenceInput): RuleOutput {
    const repos = [
      ...(input.nodesByKind.get("bitbucket.repository") ?? []),
      ...(input.nodesByKind.get("github.repository") ?? []),
    ];
    if (repos.length === 0) return { nodes: [], edges: [] };

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

    // ECS task-def env signals subject the taskdef; the DEPLOYS_TO runtime is the service.
    const servicesByFamily = new Map<string, NodeLite[]>();
    for (const s of input.nodesByKind.get("aws.ecs.service") ?? []) {
      const td = s.attributes.taskDefinition;
      const family = typeof td === "string" ? /task-definition\/([^:/]+)/.exec(td)?.[1] : null;
      if (!family) continue;
      const list = servicesByFamily.get(family);
      if (list) list.push(s);
      else servicesByFamily.set(family, [s]);
    }

    const best = new Map<string, InferredEdge>();
    const keep = (e: InferredEdge): void => {
      const k = `${e.fromUrn}→${e.toUrn}`;
      const prev = best.get(k);
      if (!prev || (prev.tier === "inferred-low" && e.tier === "inferred-high")) best.set(k, e);
    };

    for (const kind of ENV_SIGNAL_KINDS) {
      for (const signal of input.signalsByKind.get(kind) ?? []) {
        const subject = input.nodesByUrn.get(signal.subjectUrn);
        if (!subject) continue;
        const vars = (signal.data as { variables?: unknown }).variables;
        if (!vars || typeof vars !== "object") continue;
        const values = serviceNameValues(vars as Record<string, unknown>);
        if (values.length === 0) continue;

        // Resolve the runtime the DEPLOYS_TO should point at.
        let targets: NodeLite[] = [];
        if (subject.kind === "aws.lambda.function") targets = [subject];
        else if (subject.kind === "aws.ecs.taskdef") {
          targets = servicesByFamily.get(String(subject.attributes.family ?? "")) ?? [];
        }
        if (targets.length === 0) continue;

        for (const { key, name } of values) {
          const norm = normalizeWorkload(name);
          if (norm.length < 4 || GENERIC_TOKENS.has(norm)) continue;
          const matched = reposByNorm.get(norm);
          if (!matched) continue;
          const tier = matched.length === 1 ? "inferred-high" : "inferred-low";
          for (const repo of matched) {
            for (const target of targets) {
              keep({
                type: "DEPLOYS_TO",
                fromUrn: repo.urn,
                toUrn: target.urn,
                tier,
                evidence: {
                  rule: "service-env",
                  match: "service-name-env",
                  envKey: key,
                  envValue: name,
                  matchedRepoSlug: norm,
                  source: target.urn,
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
