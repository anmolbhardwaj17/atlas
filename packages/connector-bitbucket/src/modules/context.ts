/**
 * Crawl context carried on each cached payload. Bitbucket detail payloads (an environment,
 * a PR) don't always echo their workspace/repo, so `discover` stamps `_atlas` onto every
 * payload; the pure module transforms read it to build stable URNs. It lives under a reserved
 * key so it round-trips through the raw snapshot without colliding with API fields.
 */
export interface AtlasContext {
  workspace: string;
  repoSlug?: string;
}

const KEY = "_atlas";

export function withContext<T extends object>(payload: T, ctx: AtlasContext): T {
  return { ...payload, [KEY]: ctx };
}

export function readContext(payload: unknown): AtlasContext {
  const ctx = (payload as Record<string, unknown>)?.[KEY] as AtlasContext | undefined;
  if (!ctx || typeof ctx.workspace !== "string" || !ctx.workspace) {
    throw new Error("bitbucket module: payload is missing its _atlas workspace context");
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
