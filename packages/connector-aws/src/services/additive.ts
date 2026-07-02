/**
 * Additive service modules (docs/06 §9): DynamoDB table, ElastiCache cluster, API Gateway.
 * Purely additive — a new module + an already-seeded node_kinds row, no core change.
 *
 * - **DynamoDB** is a STORES_IN target: R3 (docs/05 §6.4) matches Lambda/ECS env values
 *   referencing the table by name/ARN against the table node directly, so no signal is
 *   needed here (the resolvable node is enough).
 * - **ElastiCache** emits PROTECTS(sg→cache) (feeds R2 SG-reachability) and an endpoint
 *   signal (host:port) mirroring RDS, ready for an R3 extension.
 * - **API Gateway** emits ROUTES_TO(api→lambda) parsed from Lambda-proxy integration URIs.
 *
 * (IAM *policy* is intentionally NOT a browsable node — NG6 / docs/06 §4. Its statements
 * already feed the R8 access inference via the IAM-role module's `aws.iam.policy_statements`
 * signal, so IAM-policy coverage exists as an inference input, by design.)
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";
import { observed, tagsToObject, lambdaUrnFromArn } from "./helpers";

// ── DynamoDB ──────────────────────────────────────────────────────────────────
interface DynamoTable {
  TableName: string;
  TableArn?: string;
  TableStatus?: string;
  ItemCount?: number;
  BillingModeSummary?: { BillingMode?: string };
  Tags?: Array<{ Key?: string; Value?: string }>;
}

export const dynamodbModule: ServiceModule<DynamoTable> = {
  kind: "aws.dynamodb.table",
  service: "dynamodb",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.dynamodb.table", { account, region, naturalKey: data.TableName }),
      kind: "aws.dynamodb.table",
      displayName: data.TableName,
      attributes: {
        region,
        accountRef: account,
        tableName: data.TableName,
        billingMode: data.BillingModeSummary?.BillingMode,
        itemCount: data.ItemCount,
        status: data.TableStatus,
        tags: tagsToObject(data.Tags),
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};

// ── ElastiCache ─────────────────────────────────────────────────────────────
interface CacheCluster {
  CacheClusterId: string;
  ARN?: string;
  Engine?: string;
  EngineVersion?: string;
  CacheNodeType?: string;
  SecurityGroups?: Array<{ SecurityGroupId?: string }>;
  ConfigurationEndpoint?: { Address?: string; Port?: number };
  CacheNodes?: Array<{ Endpoint?: { Address?: string; Port?: number } }>;
}

function cacheEndpoint(data: CacheCluster): { host: string; port: number | undefined } | null {
  const cfg = data.ConfigurationEndpoint;
  if (cfg?.Address) return { host: cfg.Address, port: cfg.Port };
  const node = data.CacheNodes?.find((n) => n.Endpoint?.Address)?.Endpoint;
  return node?.Address ? { host: node.Address, port: node.Port } : null;
}

export const elasticacheModule: ServiceModule<CacheCluster> = {
  kind: "aws.elasticache.cluster",
  service: "elasticache",
  scope: "region",
  normalize({ account, region, data }) {
    const ep = cacheEndpoint(data);
    return {
      urn: awsUrn("aws.elasticache.cluster", { account, region, naturalKey: data.CacheClusterId }),
      kind: "aws.elasticache.cluster",
      displayName: data.CacheClusterId,
      attributes: {
        region,
        accountRef: account,
        cacheClusterId: data.CacheClusterId,
        engine: data.Engine,
        engineVersion: data.EngineVersion,
        nodeType: data.CacheNodeType,
        endpointAddress: ep?.host,
        endpointPort: ep?.port,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const self = awsUrn("aws.elasticache.cluster", {
      account,
      region,
      naturalKey: data.CacheClusterId,
    });
    const edges = [];
    for (const sg of data.SecurityGroups ?? []) {
      if (sg.SecurityGroupId) {
        const sgUrn = awsUrn("aws.securitygroup", {
          account,
          region,
          naturalKey: sg.SecurityGroupId,
        });
        edges.push(observed("PROTECTS", sgUrn, self));
      }
    }
    return edges;
  },
  extractSignals({ account, region, data }) {
    const ep = cacheEndpoint(data);
    if (!ep) return [];
    const subjectUrn = awsUrn("aws.elasticache.cluster", {
      account,
      region,
      naturalKey: data.CacheClusterId,
    });
    return [
      {
        kind: "aws.elasticache.endpoint",
        subjectUrn,
        data: { host: ep.host, port: ep.port, engine: data.Engine },
      },
    ];
  },
};

// ── API Gateway ─────────────────────────────────────────────────────────────
interface ApiGatewayApi {
  /** REST (v1) `id` or HTTP (v2) `ApiId`. */
  id?: string;
  ApiId?: string;
  name?: string;
  Name?: string;
  ProtocolType?: string;
  /** Integrations resolved at fetch-detail; Lambda-proxy URIs embed the function ARN. */
  Integrations?: Array<{ Uri?: string; IntegrationUri?: string }>;
}

/** The embedded Lambda ARN inside an API Gateway integration URI (or a bare ARN). */
const LAMBDA_ARN = /arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]+/;

export const apigatewayModule: ServiceModule<ApiGatewayApi> = {
  kind: "aws.apigateway",
  service: "apigateway",
  scope: "region",
  normalize({ account, region, data }) {
    const apiId = data.id ?? data.ApiId ?? "";
    return {
      urn: awsUrn("aws.apigateway", { account, region, naturalKey: apiId }),
      kind: "aws.apigateway",
      displayName: data.name ?? data.Name ?? apiId,
      attributes: {
        region,
        accountRef: account,
        apiId,
        name: data.name ?? data.Name,
        protocolType: data.ProtocolType,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const apiId = data.id ?? data.ApiId ?? "";
    const self = awsUrn("aws.apigateway", { account, region, naturalKey: apiId });
    const edges = [];
    const seen = new Set<string>();
    for (const integ of data.Integrations ?? []) {
      const match = LAMBDA_ARN.exec(integ.Uri ?? integ.IntegrationUri ?? "");
      const lambdaUrn = match ? lambdaUrnFromArn(match[0]) : null;
      if (lambdaUrn && !seen.has(lambdaUrn)) {
        seen.add(lambdaUrn);
        edges.push(observed("ROUTES_TO", self, lambdaUrn));
      }
    }
    return edges;
  },
  extractSignals() {
    return [];
  },
};
