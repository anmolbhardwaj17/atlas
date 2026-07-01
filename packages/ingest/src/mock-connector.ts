import type {
  Connection,
  Connector,
  EdgeUpsert,
  HealthResult,
  NodeUpsert,
  RawResource,
  ResourceRef,
  Scope,
  Signal,
  SyncRun,
  VerifyResult,
  WorkPlan,
} from "@atlas/connector-sdk";

/**
 * A reference Connector over an in-memory fake provider — the F2 conformance/exit
 * fixture (docs/15 F2 exit). Deterministic; supports failure injection per scope
 * (to prove partial-sync safety) and tracks discover() calls (to prove resume skips
 * completed scopes).
 */
export interface MockResource {
  externalId: string;
  urn: string;
  kind: string;
  name: string;
  attributes?: Record<string, unknown>;
  edges?: Array<{ type: string; toUrn: string }>;
  /** Inference-input signals this resource emits (docs/05 §6.3). */
  signals?: Signal[];
}

export interface MockScope {
  key: string;
  resources: MockResource[];
}

/** Mutable control the test flips between runs. */
export interface MockControl {
  failingScopes: Set<string>;
}

export class MockConnector implements Connector {
  readonly provider = "mock";
  readonly discoverCalls: Record<string, number> = {};

  constructor(
    public scopes: MockScope[],
    private readonly control: MockControl = { failingScopes: new Set() },
  ) {}

  async verify(_conn: Connection): Promise<VerifyResult> {
    return { status: "connected" };
  }
  async health(_conn: Connection): Promise<HealthResult> {
    return { status: "connected" };
  }
  async plan(_conn: Connection, _run: SyncRun): Promise<WorkPlan> {
    return { scopes: this.scopes.map((s) => ({ key: s.key })) };
  }

  async *discover(scope: Scope): AsyncIterable<ResourceRef> {
    this.discoverCalls[scope.key] = (this.discoverCalls[scope.key] ?? 0) + 1;
    if (this.control.failingScopes.has(scope.key)) {
      throw new Error(`mock: scope ${scope.key} is failing`);
    }
    const cfg = this.scopes.find((s) => s.key === scope.key);
    for (const r of cfg?.resources ?? []) {
      yield { scopeKey: scope.key, externalId: r.externalId, kind: r.kind };
    }
  }

  async fetchDetail(ref: ResourceRef): Promise<RawResource> {
    const r = this.find(ref.externalId);
    if (!r) throw new Error(`mock: unknown resource ${ref.externalId}`);
    return { ref, payload: r, fetchedAt: "2026-07-01T00:00:00.000Z" };
  }

  normalize(raw: RawResource): NodeUpsert {
    const r = raw.payload as MockResource;
    return { urn: r.urn, kind: r.kind, displayName: r.name, attributes: r.attributes ?? {} };
  }

  extractSignals(raw: RawResource): Signal[] {
    return (raw.payload as MockResource).signals ?? [];
  }

  observedEdges(raw: RawResource): EdgeUpsert[] {
    const r = raw.payload as MockResource;
    return (r.edges ?? []).map((e) => ({
      type: e.type,
      fromUrn: r.urn,
      toUrn: e.toUrn,
      origin: "observed" as const,
    }));
  }

  private find(externalId: string): MockResource | undefined {
    for (const s of this.scopes) {
      const r = s.resources.find((x) => x.externalId === externalId);
      if (r) return r;
    }
    return undefined;
  }
}
