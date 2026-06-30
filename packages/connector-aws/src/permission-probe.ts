/**
 * Permission detection (docs/06 §8, FR-1.6, P3). During verify (and every sync) Atlas
 * probes each supported service with a cheap read call. An `AccessDenied` is captured
 * per-service into the connection's missing permissions, turning the connection
 * `degraded` (not `error`) so the UI shows exactly which IAM actions to grant and the
 * AI caveats answers touching omitted scopes. Never present an incomplete graph as
 * complete.
 *
 * I1.2 defines the framework + classification; the concrete per-service probes are
 * supplied by the service modules in I1.3 (each discoverer contributes its probe).
 */
import type { AwsScopeKind } from "./node-kinds";
import type { AwsTempCredentials } from "./credentials";

export interface ProbeInput {
  credentials: AwsTempCredentials;
  accountId: string;
  /** A representative region (region-scoped probes); undefined for global probes. */
  region?: string;
  signal?: AbortSignal;
}

/** A single service's read-permission probe. */
export interface PermissionProbe {
  /** Short service key (e.g. "ec2", "lambda") — matches the discoverer it guards. */
  service: string;
  /** The IAM action reported when this probe is denied (e.g. "ec2:DescribeInstances"). */
  iamAction: string;
  /** Region- vs globally-scoped → which region the probe runs in. */
  scope: AwsScopeKind;
  /** Make a minimal read call; resolve on success, throw on any error (classified by caller). */
  probe(input: ProbeInput): Promise<void>;
}

/** True when an AWS SDK error denotes a denied/forbidden read (vs. transient/other).
 *  Covers the common access-denied spellings across services (EC2 uses
 *  `UnauthorizedOperation`; most services use `AccessDenied(Exception)`). */
export function isAccessDenied(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const name = `${e?.name ?? ""} ${e?.Code ?? ""}`;
  if (/AccessDenied|UnauthorizedOperation|AuthorizationError|Forbidden/i.test(name)) return true;
  return e?.$metadata?.httpStatusCode === 403;
}
