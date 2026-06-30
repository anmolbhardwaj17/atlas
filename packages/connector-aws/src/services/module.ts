/**
 * Per-service module contract (docs/06 §5/§9). Each supported AWS service contributes
 * a module with the three PURE transforms — `normalize` / `observedEdges` /
 * `extractSignals` — that the connector dispatches to by node kind. Because they are
 * pure functions of a captured payload, they are unit-testable against golden fixtures
 * (docs/14 §10) and re-runnable from `raw_snapshots` without touching AWS (docs/05 rule
 * versioning). Adding a service is additive: a new module + node_kinds row (docs/06 §9).
 */
import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import type { AwsNodeKind, AwsScopeKind } from "../node-kinds";

/**
 * The unit the pure transforms operate on: the verbatim AWS describe object (`data`)
 * plus the account + region needed to build deterministic URNs (docs/05 §2.2). The
 * connector wraps every fetched resource in this shape; `raw_snapshots` stores it.
 */
export interface AwsRawPayload<T = unknown> {
  /** 12-digit account id (URN scope). */
  account: string;
  /** Region for region-scoped kinds; "global" for global kinds. */
  region: string;
  /** The provider-native describe object (e.g. one EC2 Instance). */
  data: T;
}

export interface ServiceModule<T = unknown> {
  /** Graph node kind this module emits (FK to node_kinds). */
  readonly kind: AwsNodeKind;
  /** Short service key for work-plan scopes & permission probes (e.g. "ec2"). */
  readonly service: string;
  /** Region- vs globally-scoped. */
  readonly scope: AwsScopeKind;
  /** raw → graph node (docs/05). Must set `attributes.region`/`attributes.accountRef`
   *  so the runner promotes the hot columns. */
  normalize(p: AwsRawPayload<T>): NodeUpsert;
  /** raw → directly-observed edges (docs/05 §4, origin always "observed"). */
  observedEdges(p: AwsRawPayload<T>): EdgeUpsert[];
  /** raw → inference inputs (docs/05 §6.3) consumed by G1; not edges. */
  extractSignals(p: AwsRawPayload<T>): Signal[];
}
