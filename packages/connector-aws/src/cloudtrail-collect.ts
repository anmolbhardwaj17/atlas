/**
 * CloudTrail change collection (operational-intelligence Phase C). `LookupEvents` gives
 * 90 days of management events with ZERO customer setup - "who changed what, when" for
 * free, read-only. We fetch WRITE events only (ReadOnly=false) in a lookback window and
 * map each onto the graph node its resources name. Mapping is conservative (P3): an
 * event whose resources we can't resolve to a crawled node kind is dropped, never
 * guessed. Each mapped event is idempotent downstream via its CloudTrail event id.
 */
import {
  CloudTrailClient,
  paginateLookupEvents,
  type LookupEventsCommandInput,
} from "@aws-sdk/client-cloudtrail";
import { awsUrn } from "./urn";
import type { AwsNodeKind } from "./node-kinds";
import { clientConfig } from "./aws/client-config";
import { isAccessDenied } from "./permission-probe";
import type { AwsTempCredentials } from "./credentials";

export interface ChangeEvent {
  /** URN of the node this change applies to (resolved conservatively). */
  urn: string;
  /** CloudTrail event id — the downstream dedupe key. */
  eventId: string;
  /** e.g. "AuthorizeSecurityGroupIngress", "UpdateFunctionCode20150331v2". */
  eventName: string;
  occurredAt: string;
  /** IAM principal that made the change (CloudTrail Username). */
  actor: string | null;
  /** e.g. "ec2.amazonaws.com". */
  eventSource: string | null;
}

export interface CloudTrailCollectInput {
  credentials: AwsTempCredentials;
  accountId: string;
  regions: string[];
  /** Only events after this instant (poll lookback / initial backfill boundary). */
  since: Date;
  signal?: AbortSignal;
}

export interface CloudTrailCollectResult {
  events: ChangeEvent[];
  /** Regions where the lookup could not run (denied/unavailable) — named, never silent. */
  skipped: Array<{ region: string; message: string }>;
}

/** CloudTrail resource types → the crawled node kind + how its name becomes a URN key. */
const RESOURCE_KINDS: Record<string, { kind: AwsNodeKind; global?: boolean }> = {
  "AWS::EC2::SecurityGroup": { kind: "aws.securitygroup" },
  "AWS::EC2::Instance": { kind: "aws.ec2.instance" },
  "AWS::EC2::VPC": { kind: "aws.vpc" },
  "AWS::EC2::Subnet": { kind: "aws.subnet" },
  "AWS::Lambda::Function": { kind: "aws.lambda.function" },
  "AWS::RDS::DBInstance": { kind: "aws.rds.instance" },
  "AWS::S3::Bucket": { kind: "aws.s3.bucket", global: true },
  "AWS::ECS::Cluster": { kind: "aws.ecs.cluster" },
  "AWS::ECS::Service": { kind: "aws.ecs.service" },
  "AWS::ElasticLoadBalancingV2::LoadBalancer": { kind: "aws.elb" },
  "AWS::ECR::Repository": { kind: "aws.ecr.repository" },
};

/** Lambda ARNs / ELB ARNs sometimes arrive as the resource name — reduce to the natural key. */
function naturalKeyFor(kind: AwsNodeKind, raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  if (name.startsWith("arn:")) {
    if (kind === "aws.lambda.function") {
      const m = /:function:([^:]+)/.exec(name);
      return m?.[1] ?? null;
    }
    if (kind === "aws.elb") {
      const m = /loadbalancer\/(?:app|net)\/([^/]+)\//.exec(name);
      return m?.[1] ?? null;
    }
    if (kind === "aws.ecs.service") {
      const m = /:service\/(.+)$/.exec(name);
      return m?.[1] ?? null; // already cluster/service
    }
    // Other ARN-shaped names: last path-ish segment is usually the id.
    const tail = name.split(/[/:]/).pop();
    return tail ?? null;
  }
  return name;
}

export async function collectCloudTrailEvents(
  input: CloudTrailCollectInput,
): Promise<CloudTrailCollectResult> {
  const out = new Map<string, ChangeEvent>();
  const skipped: CloudTrailCollectResult["skipped"] = [];

  for (const region of input.regions) {
    const client = new CloudTrailClient(clientConfig(input.credentials, region));
    const params: LookupEventsCommandInput = {
      StartTime: input.since,
      LookupAttributes: [{ AttributeKey: "ReadOnly", AttributeValue: "false" }],
      MaxResults: 50,
    };
    try {
      for await (const page of paginateLookupEvents({ client }, params)) {
        for (const ev of page.Events ?? []) {
          if (!ev.EventId || !ev.EventTime || !ev.EventName) continue;
          for (const res of ev.Resources ?? []) {
            const desc = res.ResourceType ? RESOURCE_KINDS[res.ResourceType] : undefined;
            if (!desc || !res.ResourceName) continue;
            const key = naturalKeyFor(desc.kind, res.ResourceName);
            if (!key) continue;
            const urn = awsUrn(desc.kind, {
              account: input.accountId,
              ...(desc.global ? {} : { region }),
              naturalKey: key,
            });
            // One CloudTrail event may name several resources → one change per (event, urn).
            const dedupe = `${ev.EventId}:${urn}`;
            if (out.has(dedupe)) continue;
            out.set(dedupe, {
              urn,
              eventId: dedupe,
              eventName: ev.EventName,
              occurredAt: ev.EventTime.toISOString(),
              actor: ev.Username ?? null,
              eventSource: ev.EventSource ?? null,
            });
          }
        }
      }
    } catch (err) {
      if (input.signal?.aborted) throw err;
      skipped.push({
        region,
        message: isAccessDenied(err)
          ? "access denied (cloudtrail:LookupEvents)"
          : ((err as Error).message ?? "failed"),
      });
    }
  }

  return { events: [...out.values()], skipped };
}
