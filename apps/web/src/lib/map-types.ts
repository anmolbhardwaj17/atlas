import type { LucideIcon } from "lucide-react";
import { ENV_STYLE, PROVIDER_META } from "./taxonomy";

/** Shapes returned by GET /graph (mirrors the API's GraphNodeDto / GraphEdgeLite). */
/** Point-in-time runtime health (operational-intelligence Phase B). Absent = unknown -
 *  a designed state: we say "not checked", we never fake green (docs/09 §7). */
export interface NodeHealth {
  state: "healthy" | "degraded" | "unhealthy";
  reason?: string;
  checkedAt?: string;
}

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
  health?: NodeHealth | null;
  /** When Atlas first/last observed this node (ISO). Drives the "what changed" lens. */
  firstSeen?: string;
  lastSeen?: string;
  /** Full node attributes (the /graph API ships them) - the detail panel's key facts. */
  attributes?: Record<string, unknown>;
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

/** Provider derived from the URN prefix (robust - `aws:…`, `azure:…`, `gcp:…`, `github:…`). */
export function providerOf(node: MapNode): string {
  return node.urn.split(":")[0] || node.provider || "unknown";
}

const CLOUD_PROVIDERS = new Set(["aws", "azure", "gcp"]);

/**
 * Whether an edge crosses a cloud or account boundary - the multi-cloud money shot. Only
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
/** AI-suggested edges (awaiting confirm/reject) — cyan, distinct from the violet cross-boundary. */
export const AI_SUGGESTED_COLOR = "#06b6d4";

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

/**
 * Per-chip category visuals for the group-by filter bar. Colour encodes the category so the
 * lane filter reads at a glance: environments get a semantic hue + dot, clouds get their brand
 * hue + real brand logo, accounts stay neutral (an account id carries no provider identity).
 */
export interface ChipVisual {
  /** Selected-state Tailwind classes (environments). */
  activeClass?: string | undefined;
  /** Brand hex (clouds) - drives border/text/fill inline when selected. */
  brand?: string | undefined;
  /** Always-visible category dot (environments). */
  dot?: string | undefined;
  /** Brand logo key in cloud-icons-data (clouds). */
  logo?: string | undefined;
  /** Fallback glyph when no brand logo exists (atlas / packages lanes). */
  fallbackIcon?: LucideIcon | undefined;
}

export function chipVisual(mode: GroupMode, key: string): ChipVisual {
  if (mode === "environment") {
    const s = ENV_STYLE[key] ?? ENV_STYLE.unknown;
    return { activeClass: s?.chip, dot: s?.dot };
  }
  if (mode === "cloud") {
    const p = PROVIDER_META[key];
    return p ? { brand: p.brand, logo: p.logo, fallbackIcon: p.fallbackIcon } : {};
  }
  return {}; // account: neutral (no stable provider identity)
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
