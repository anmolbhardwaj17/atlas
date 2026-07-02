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

/** Environment display order + labels (docs/09 — environments are a first-class grouping). */
export const ENV_ORDER = ["prod", "staging", "dev", "test", "unknown"] as const;
export const ENV_LABEL: Record<string, string> = {
  prod: "Production",
  staging: "Staging",
  dev: "Development",
  test: "Test / QA",
  unknown: "Code & shared",
};
