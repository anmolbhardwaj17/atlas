/**
 * @atlas/connector-sdk — the provider-agnostic ingestion contract (docs/06 §3, DD-1).
 *
 * Core graph/inference code and the sync runner call ONLY this interface; they never
 * import `aws-sdk` or the GitHub SDK. That is what makes adding GCP/GitLab additive
 * (P5/NFR-19). This contract is **frozen in F2** (RMR-6) — provider connectors (I1/I2)
 * implement it; conformance is verified against it.
 *
 * The crawl is a pipeline of small, individually idempotent & resumable stages
 * (docs/02 §5.2, P7): plan → discover → fetchDetail → (normalize | extractSignals |
 * observedEdges). The last three are PURE functions of a captured `RawResource`, so
 * they're unit-testable against fixtures and re-runnable from `raw_snapshots` without
 * touching the provider (supports docs/05 rule versioning).
 */

/** Provider id. Open union — extensible without changing this contract (DD-1). */
export type ConnectorProvider = "aws" | "github" | (string & {});

/** A source link (docs/04 §5.2) as the connector sees it — non-secret config plus a
 *  pointer to credentials in the Secrets Broker (never the secret itself, BR-CONN-1). */
export interface Connection {
  id: string;
  orgId: string;
  provider: ConnectorProvider;
  displayName: string;
  config: Record<string, unknown>;
  secretRef: string | null;
}

export type SyncRunType = "full" | "incremental" | "webhook";

/** A crawl execution (docs/04 §5.2). `checkpoint` is the resumability cursor (P7). */
export interface SyncRun {
  id: string;
  orgId: string;
  connectionId: string;
  type: SyncRunType;
  checkpoint: Record<string, unknown>;
}

// ── Lifecycle / health ──────────────────────────────────────────────────────

export type VerifyStatus = "connected" | "degraded" | "error";

/** Result of verify()/health() (FR-1.3/1.6/1.9). `degraded` carries the missing
 *  read permissions so the UI can show exactly what to grant (US-1, P3). */
export interface VerifyResult {
  status: VerifyStatus;
  /** Read permissions the role/app is missing (degraded) — e.g. "ec2:DescribeInstances". */
  missingPermissions?: string[];
  message?: string;
}
export type HealthResult = VerifyResult;

// ── Crawl stages ────────────────────────────────────────────────────────────

/** A unit of work to crawl, e.g. one region×service (AWS) or one repo (GitHub). The
 *  connector defines `key` and any `params`; `cursor` resumes mid-scope (P7). */
export interface Scope {
  key: string;
  params?: Record<string, unknown>;
  cursor?: string | null;
}

export interface WorkPlan {
  scopes: Scope[];
}

/** A lightweight reference to a discovered resource (ids, paginated) — cheap to list
 *  before the (costlier) detail fetch. */
export interface ResourceRef {
  scopeKey: string;
  /** Provider-native id (ARN, node id, …) — basis for the stable URN at normalize. */
  externalId: string;
  /** Target node kind (docs/05 §3.1), e.g. "aws.lambda.function". */
  kind: string;
}

/** Full attributes + the raw provider payload (persisted to `raw_snapshots`, P4). */
export interface RawResource {
  ref: ResourceRef;
  payload: unknown;
  /** ISO-8601 capture time (provenance). */
  fetchedAt: string;
}

/** A graph node to upsert, keyed by stable URN (docs/04 `uq_node_urn`, docs/05). */
export interface NodeUpsert {
  urn: string;
  kind: string;
  displayName: string;
  attributes: Record<string, unknown>;
}

/** An inference input (docs/05 §6) — a fact extracted from a raw payload that the
 *  inference engine (G1) turns into edges. Not an edge itself. */
export interface Signal {
  kind: string;
  /** URN of the node this signal is about. */
  subjectUrn: string;
  data: Record<string, unknown>;
}

/** A direct, observed edge (docs/05) — origin is always "observed" (highest trust,
 *  P3/P4); inferred edges come from the inference engine, not connectors. */
export interface EdgeUpsert {
  type: string;
  fromUrn: string;
  toUrn: string;
  origin: "observed";
  attributes?: Record<string, unknown>;
}

// ── Runtime context ─────────────────────────────────────────────────────────

/** Resolves provider credentials from the Secrets Broker by `secret_ref` (docs/13 §7).
 *  The connector receives material only at call time; it never persists secrets. */
export interface SecretAccessor {
  get(secretRef: string): Promise<Record<string, string>>;
}

export interface ConnectorLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Per-run context handed to the crawl stages. */
export interface CrawlContext {
  connection: Connection;
  run: SyncRun;
  secrets: SecretAccessor;
  log: ConnectorLogger;
  /** Cooperative cancellation (worker shutdown / timeout). */
  signal?: AbortSignal;
}

// ── The contract ────────────────────────────────────────────────────────────

export interface Connector {
  readonly provider: ConnectorProvider;

  /** AssumeRole/App probe + permission report (FR-1.3). Pure & repeatable. */
  verify(conn: Connection): Promise<VerifyResult>;
  /** Periodic re-check (FR-1.9). */
  health(conn: Connection): Promise<HealthResult>;

  /** Enumerate the scopes to crawl (deterministic; cursor stored on the run). */
  plan(conn: Connection, run: SyncRun): Promise<WorkPlan>;
  /** List resource refs in a scope (paginated; resumable via scope.cursor). */
  discover(scope: Scope, ctx: CrawlContext): AsyncIterable<ResourceRef>;
  /** Fetch full attributes + raw payload for one ref (upsert-keyed by URN). */
  fetchDetail(ref: ResourceRef, ctx: CrawlContext): Promise<RawResource>;

  /** Pure: raw → graph node (docs/05). */
  normalize(raw: RawResource): NodeUpsert;
  /** Pure: raw → inference inputs (docs/05 §6). */
  extractSignals(raw: RawResource): Signal[];
  /** Pure: raw → directly-observed edges (docs/05). */
  observedEdges(raw: RawResource): EdgeUpsert[];
}

export { fetchWithTimeout } from "./net";
export type { FetchTimeoutOptions } from "./net";
