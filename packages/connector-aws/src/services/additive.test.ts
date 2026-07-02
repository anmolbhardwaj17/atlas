import { describe, it, expect } from "vitest";
import type { AwsRawPayload } from "./module";
import { dynamodbModule, elasticacheModule, apigatewayModule } from "./additive";

const ACCT = "123456789012";
const REGION = "us-east-1";

function p<T>(data: T): AwsRawPayload<T> {
  return { account: ACCT, region: REGION, data };
}

describe("additive: DynamoDB", () => {
  it("normalizes a table → node (no edges/signals; R3 resolves the node directly)", () => {
    const raw = p({
      TableName: "carts",
      TableArn: `arn:aws:dynamodb:${REGION}:${ACCT}:table/carts`,
      TableStatus: "ACTIVE",
      ItemCount: 42,
      BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
      Tags: [{ Key: "team", Value: "checkout" }],
    });
    const node = dynamodbModule.normalize(raw);
    expect(node.urn).toBe("aws:us-east-1:123456789012:dynamodb:carts");
    expect(node.kind).toBe("aws.dynamodb.table");
    expect(node.attributes.billingMode).toBe("PAY_PER_REQUEST");
    expect(node.attributes.itemCount).toBe(42);
    expect((node.attributes.tags as Record<string, string>).team).toBe("checkout");
    expect(dynamodbModule.observedEdges(raw)).toEqual([]);
    expect(dynamodbModule.extractSignals(raw)).toEqual([]);
  });
});

describe("additive: ElastiCache", () => {
  const raw = p({
    CacheClusterId: "sessions",
    Engine: "redis",
    EngineVersion: "7.1",
    CacheNodeType: "cache.t4g.small",
    SecurityGroups: [{ SecurityGroupId: "sg-cache" }],
    ConfigurationEndpoint: { Address: "sessions.abc.cache.amazonaws.com", Port: 6379 },
  });

  it("normalizes a cluster with its endpoint", () => {
    const node = elasticacheModule.normalize(raw);
    expect(node.urn).toBe("aws:us-east-1:123456789012:elasticache:sessions");
    expect(node.attributes.engine).toBe("redis");
    expect(node.attributes.endpointAddress).toBe("sessions.abc.cache.amazonaws.com");
    expect(node.attributes.endpointPort).toBe(6379);
  });

  it("emits PROTECTS(sg→cache) and an endpoint signal", () => {
    const edges = elasticacheModule.observedEdges(raw);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "PROTECTS",
      fromUrn: "aws:us-east-1:123456789012:sg:sg-cache",
      toUrn: "aws:us-east-1:123456789012:elasticache:sessions",
      origin: "observed",
    });
    const signals = elasticacheModule.extractSignals(raw);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: "aws.elasticache.endpoint",
      subjectUrn: "aws:us-east-1:123456789012:elasticache:sessions",
      data: { host: "sessions.abc.cache.amazonaws.com", port: 6379, engine: "redis" },
    });
  });

  it("falls back to a cache-node endpoint when there's no configuration endpoint", () => {
    const node = elasticacheModule.normalize(
      p({
        CacheClusterId: "cc",
        Engine: "memcached",
        CacheNodes: [{ Endpoint: { Address: "cc.node.cache.amazonaws.com", Port: 11211 } }],
      }),
    );
    expect(node.attributes.endpointAddress).toBe("cc.node.cache.amazonaws.com");
    expect(node.attributes.endpointPort).toBe(11211);
  });
});

describe("additive: API Gateway", () => {
  it("normalizes an HTTP API and emits ROUTES_TO(api→lambda) from an integration URI", () => {
    const raw = p({
      ApiId: "a1b2c3",
      Name: "checkout-api",
      ProtocolType: "HTTP",
      Integrations: [
        {
          IntegrationUri: `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/arn:aws:lambda:${REGION}:${ACCT}:function:checkout/invocations`,
        },
        // A duplicate target must not produce a duplicate edge.
        { Uri: `arn:aws:lambda:${REGION}:${ACCT}:function:checkout` },
      ],
    });
    const node = apigatewayModule.normalize(raw);
    expect(node.urn).toBe("aws:us-east-1:123456789012:apigateway:a1b2c3");
    expect(node.displayName).toBe("checkout-api");

    const edges = apigatewayModule.observedEdges(raw);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "ROUTES_TO",
      fromUrn: "aws:us-east-1:123456789012:apigateway:a1b2c3",
      toUrn: "aws:us-east-1:123456789012:lambda:checkout",
      origin: "observed",
    });
  });

  it("emits no edge when an integration targets a non-Lambda backend", () => {
    const raw = p({
      id: "rest1",
      name: "legacy",
      Integrations: [{ Uri: "http://internal.example.com/orders" }],
    });
    expect(apigatewayModule.observedEdges(raw)).toEqual([]);
  });
});
