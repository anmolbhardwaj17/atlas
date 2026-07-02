/**
 * Environment inference (docs/05 - a derived, best-effort grouping). Cloud resources rarely
 * declare their environment in one place, so we look, in priority order:
 *   1. an explicit tag/attribute (`environment`/`env`/`stage`/`tier`),
 *   2. failing that, a name/URN convention (`prod-`, `staging-`, `dev-`, …).
 * The value is normalized to a small canonical set so the map can group cleanly. This is a
 * *hint* for grouping/coloring, never a security boundary (that's account/region/tenant).
 */
export type Environment = "prod" | "staging" | "dev" | "test" | "unknown";

const TAG_KEYS = ["environment", "env", "stage", "tier"];

/** Canonicalize a raw value/token to an Environment (or null if it doesn't look like one). */
function canonical(raw: string): Environment | null {
  const v = raw.trim().toLowerCase();
  if (/^(prod|production|prd)$/.test(v)) return "prod";
  if (/^(stag(e|ing)?|stg|preprod|pre-prod|uat)$/.test(v)) return "staging";
  if (/^(dev|development|sandbox)$/.test(v)) return "dev";
  if (/^(test|qa|testing)$/.test(v)) return "test";
  return null;
}

/** Scan free text (name/urn) for an environment token bounded by non-word chars. */
function fromText(text: string): Environment | null {
  const t = text.toLowerCase();
  // Order matters: check the more specific tokens first.
  if (/\b(prod|production|prd)\b|(^|[-_/])prod([-_/]|$)/.test(t)) return "prod";
  if (/\b(staging|stage|stg|preprod|uat)\b|(^|[-_/])(staging|stg)([-_/]|$)/.test(t))
    return "staging";
  if (/\b(dev|development|sandbox)\b|(^|[-_/])dev([-_/]|$)/.test(t)) return "dev";
  if (/\b(test|qa)\b|(^|[-_/])(test|qa)([-_/]|$)/.test(t)) return "test";
  return null;
}

export interface EnvInferenceInput {
  name?: string | null;
  urn?: string;
  tags?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export function inferEnvironment(node: EnvInferenceInput): Environment {
  // 1. Explicit tag/attribute (case-insensitive key match).
  const bags = [node.tags ?? {}, node.attributes ?? {}];
  for (const bag of bags) {
    for (const [key, value] of Object.entries(bag)) {
      if (TAG_KEYS.includes(key.toLowerCase()) && typeof value === "string") {
        const env = canonical(value);
        if (env) return env;
      }
    }
  }
  // 2. Naming convention.
  return fromText(`${node.name ?? ""} ${node.urn ?? ""}`) ?? "unknown";
}
