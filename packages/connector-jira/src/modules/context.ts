/**
 * Crawl context stamped onto each cached payload. A Jira issue payload names its project but not the
 * Atlassian site, so `discover` stamps `_atlas: { site }` onto every payload; the pure module
 * transforms read it to build stable `jira:<site>:…` URNs. Reserved key so it round-trips through the
 * raw snapshot without colliding with API fields.
 */
/** A Jira custom field detected (by name) to hold intent — Acceptance Criteria / Definition of
 *  Done / Remediation. Discovered per connection (field ids are company-specific), so intent that
 *  lives outside the description still reaches the coverage judge (IV-3 (b), convention-agnostic). */
export interface IntentField {
  id: string;
  label: string;
}

export interface AtlasContext {
  site: string;
  /** Intent-bearing custom fields to read off the issue's `fields` map, if any. */
  intentFields?: IntentField[];
}

const KEY = "_atlas";

export function withContext<T extends object>(payload: T, ctx: AtlasContext): T {
  return { ...payload, [KEY]: ctx };
}

export function readContext(payload: unknown): AtlasContext {
  const ctx = (payload as Record<string, unknown>)?.[KEY] as AtlasContext | undefined;
  if (!ctx || typeof ctx.site !== "string" || !ctx.site) {
    throw new Error("jira module: payload is missing its _atlas site context");
  }
  return ctx;
}

export function str(payload: unknown, key: string): string | undefined {
  const v = (payload as Record<string, unknown>)?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function obj(payload: unknown, key: string): Record<string, unknown> | undefined {
  const v = (payload as Record<string, unknown>)?.[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}
