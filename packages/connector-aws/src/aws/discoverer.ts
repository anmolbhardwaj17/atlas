/**
 * Discoverer contract (docs/06 §5.2). A discoverer issues the live List/Describe calls
 * for one service and yields fully-resolved resources — discover+detail are collapsed
 * where the list already returns full objects (docs/06 §5.2 optimization). The pure
 * transforms (I1.3) then map each payload to nodes/edges/signals.
 *
 * Discoverers stream (AsyncIterable) so memory stays bounded on large accounts (AWR-4);
 * the connector's permission probe simply triggers the first page (AccessDenied surfaces).
 */
import type { ResourceRef } from "@atlas/connector-sdk";
import type { AwsNodeKind, AwsScopeKind } from "../node-kinds";
import type { CrawlCredentials } from "../credentials";
import type { AwsRawPayload } from "../services/module";
import type { PermissionProbe } from "../permission-probe";

export interface CrawlScopeInput {
  credentials: CrawlCredentials;
  account: string;
  /** Region for region-scoped services; "global" for global services. */
  region: string;
  signal?: AbortSignal;
}

export interface DiscoveredResource {
  ref: ResourceRef;
  payload: AwsRawPayload;
}

export interface Discoverer {
  readonly service: string;
  readonly scope: AwsScopeKind;
  readonly kind: AwsNodeKind;
  /** IAM action reported when this discoverer's read is denied (permission detection). */
  readonly iamAction: string;
  crawl(input: CrawlScopeInput): AsyncIterable<DiscoveredResource>;
}

/** Build the ref a discoverer attaches to each resource (scopeKey mirrors plan()). */
export function makeRef(d: Discoverer, region: string, externalId: string): ResourceRef {
  const prefix = d.scope === "global" ? "global" : region;
  return { scopeKey: prefix + "/" + d.service, externalId, kind: d.kind };
}

/** Wrap a fetched AWS object as a DiscoveredResource (ref + account/region payload). */
export function emit(
  d: Discoverer,
  input: CrawlScopeInput,
  externalId: string,
  data: unknown,
): DiscoveredResource {
  return {
    ref: makeRef(d, input.region, externalId),
    payload: { account: input.account, region: input.region, data },
  };
}

/**
 * Derive a verify/health permission probe from a discoverer: consume the first item,
 * which triggers the underlying List/Describe — an AccessDenied propagates and is
 * classified by the caller (docs/06 §8). Stops after one item to stay cheap.
 */
export function probeFromDiscoverer(d: Discoverer): PermissionProbe {
  return {
    service: d.service,
    iamAction: d.iamAction,
    scope: d.scope,
    async probe(input) {
      const region = input.region ?? "global";
      for await (const item of d.crawl({
        credentials: input.credentials,
        account: input.accountId,
        region,
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        void item;
        break;
      }
    },
  };
}
