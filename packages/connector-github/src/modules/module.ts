/**
 * Per-entity module contract (docs/07 §3, mirrors the AWS ServiceModule). Each GitHub
 * entity kind contributes PURE normalize/observedEdges/extractSignals, dispatched by
 * node kind, so they are golden-fixture testable and re-runnable from `raw_snapshots`.
 */
import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import type { GithubNodeKind } from "../node-kinds";

export interface GithubModule<T = unknown> {
  readonly kind: GithubNodeKind;
  normalize(payload: T): NodeUpsert;
  observedEdges(payload: T): EdgeUpsert[];
  extractSignals(payload: T): Signal[];
}

/** An observed edge (origin always "observed", docs/05 §4). */
export function observed(
  type: string,
  fromUrn: string,
  toUrn: string,
  attributes?: Record<string, unknown>,
): EdgeUpsert {
  return attributes
    ? { type, fromUrn, toUrn, origin: "observed", attributes }
    : { type, fromUrn, toUrn, origin: "observed" };
}
