/** Shapes returned by GET /graph (mirrors the API's GraphNodeDto / GraphEdgeLite). */
export interface MapNode {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
  provider: string;
  region: string | null;
  status: string;
  confidence: string;
  environment: string;
  accountRef: string | null;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  origin: string;
  confidence: string;
}

export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
  truncated: boolean;
}

/** Provider derived from the URN prefix (robust — `aws:…`, `azure:…`, `gcp:…`, `github:…`). */
export function providerOf(node: MapNode): string {
  return node.urn.split(":")[0] || node.provider || "unknown";
}

const CLOUD_PROVIDERS = new Set(["aws", "azure", "gcp"]);

/**
 * Whether an edge crosses a cloud or account boundary — the multi-cloud money shot. Only
 * cloud→cloud edges count (a repo→service edge isn't "cross-cloud"): different provider →
 * crossCloud; same cloud, different account/subscription/project → crossAccount.
 */
export function edgeCrossing(
  from: MapNode | undefined,
  to: MapNode | undefined,
): { crossCloud: boolean; crossAccount: boolean } {
  if (!from || !to) return { crossCloud: false, crossAccount: false };
  const pf = providerOf(from);
  const pt = providerOf(to);
  if (!CLOUD_PROVIDERS.has(pf) || !CLOUD_PROVIDERS.has(pt)) {
    return { crossCloud: false, crossAccount: false };
  }
  if (pf !== pt) return { crossCloud: true, crossAccount: false };
  return {
    crossCloud: false,
    crossAccount: !!from.accountRef && !!to.accountRef && from.accountRef !== to.accountRef,
  };
}

/** Violet accent for cross-boundary edges (the one accent that earns its place on the map). */
export const CROSS_COLOR = "#8b5cf6";

// ── Environments ─────────────────────────────────────────────────────────────
export const ENV_ORDER = ["prod", "staging", "dev", "test", "unknown"] as const;
export const ENV_LABEL: Record<string, string> = {
  prod: "Production",
  staging: "Staging",
  dev: "Development",
  test: "Test / QA",
  unknown: "Code & shared",
};

// ── Clouds / providers ───────────────────────────────────────────────────────
const PROVIDER_ORDER = ["aws", "azure", "gcp", "github", "bitbucket", "atlas", "external"];
const PROVIDER_LABEL: Record<string, string> = {
  aws: "Amazon Web Services",
  azure: "Microsoft Azure",
  gcp: "Google Cloud",
  github: "GitHub",
  bitbucket: "Bitbucket",
  atlas: "Atlas services",
  external: "Packages",
};

/** How the map lanes are grouped. */
export type GroupMode = "environment" | "cloud" | "account";

export interface Grouping {
  keyOf: (n: MapNode) => string;
  labelOf: (key: string) => string;
  /** Order the present group keys into lane order. */
  order: (keys: string[]) => string[];
}

function byFixedOrder(fixed: readonly string[]): (keys: string[]) => string[] {
  return (keys) =>
    [...keys].sort((a, b) => {
      const ia = fixed.indexOf(a);
      const ib = fixed.indexOf(b);
      return (
        (ia === -1 ? fixed.length : ia) - (ib === -1 ? fixed.length : ib) || a.localeCompare(b)
      );
    });
}

export function groupingFor(mode: GroupMode): Grouping {
  if (mode === "cloud") {
    return {
      keyOf: (n) => providerOf(n),
      labelOf: (k) => PROVIDER_LABEL[k] ?? k,
      order: byFixedOrder(PROVIDER_ORDER),
    };
  }
  if (mode === "account") {
    return {
      keyOf: (n) => n.accountRef ?? "shared",
      // Prefix the account with its provider so "999988887777" reads as an AWS account, etc.
      labelOf: (k) => k,
      order: (keys) =>
        [...keys].sort((a, b) => (a === "shared" ? 1 : b === "shared" ? -1 : a.localeCompare(b))),
    };
  }
  // environment (default)
  return {
    keyOf: (n) =>
      ENV_ORDER.includes(n.environment as (typeof ENV_ORDER)[number]) ? n.environment : "unknown",
    labelOf: (k) => ENV_LABEL[k] ?? k,
    order: byFixedOrder(ENV_ORDER),
  };
}
