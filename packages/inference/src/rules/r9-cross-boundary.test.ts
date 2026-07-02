import { describe, it, expect } from "vitest";
import { crossBoundaryConnectsRule } from "./r9-cross-boundary";
import type { InferenceInput, NodeLite, SignalLite } from "../types";

function makeInput(nodes: NodeLite[], signals: SignalLite[]): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    nodesByUrn.set(n.urn, n);
    const list = nodesByKind.get(n.kind) ?? [];
    list.push(n);
    nodesByKind.set(n.kind, list);
  }
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const list = signalsByKind.get(s.kind) ?? [];
    list.push(s);
    signalsByKind.set(s.kind, list);
  }
  return {
    orgSlug: "acme",
    nodesByUrn,
    nodesByKind,
    signals,
    signalsByKind,
    observedEdges: [],
    inferredEdges: [],
  };
}
const node = (urn: string, kind: string, attributes: Record<string, unknown>): NodeLite => ({
  id: urn,
  urn,
  kind,
  attributes,
});
const env = (subjectUrn: string, kind: string, variables: Record<string, string>): SignalLite => ({
  subjectUrn,
  kind,
  data: { variables },
});

const AWS_LAMBDA = "aws:us-east-1:111111111111:lambda:api";
const AWS_RDS = "aws:us-east-1:222222222222:rds:orders";
const AWS_RDS_HOST = "orders.abc.us-east-1.rds.amazonaws.com";
const AZ_SQL = "azure:eastus:sub-aaaa:sql:orders-db";
const AZ_SQL_HOST = "orders-db.database.windows.net";
const GCP_RUN = "gcp:us-central1:proj-web:cloudrun:web";

describe("R9 cross_boundary_connects", () => {
  it("AWS compute → Azure SQL (cross-cloud + cross-account) CONNECTS_TO", () => {
    const out = crossBoundaryConnectsRule.evaluate(
      makeInput(
        [
          node(AWS_LAMBDA, "aws.lambda.function", { accountRef: "111111111111" }),
          node(AZ_SQL, "azure.sql.database", {
            fullyQualifiedDomainName: AZ_SQL_HOST,
            accountRef: "sub-aaaa",
          }),
        ],
        [
          env(AWS_LAMBDA, "aws.lambda.env", {
            DATABASE_URL: `Server=${AZ_SQL_HOST};Database=orders`,
          }),
        ],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({
      type: "CONNECTS_TO",
      fromUrn: AWS_LAMBDA,
      toUrn: AZ_SQL,
      tier: "inferred-high",
    });
    expect(out.edges[0]?.evidence).toMatchObject({
      crossCloud: true,
      crossAccount: true,
      fromProvider: "aws",
      toProvider: "azure",
      match: "azure-sql",
    });
  });

  it("GCP Cloud Run → AWS RDS (cross-cloud) CONNECTS_TO", () => {
    const out = crossBoundaryConnectsRule.evaluate(
      makeInput(
        [
          node(GCP_RUN, "gcp.cloudrun", { accountRef: "proj-web" }),
          node(AWS_RDS, "aws.rds.instance", {
            endpointAddress: AWS_RDS_HOST,
            accountRef: "222222222222",
          }),
        ],
        [env(GCP_RUN, "gcp.cloudrun.env", { DB_HOST: AWS_RDS_HOST })],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ type: "CONNECTS_TO", fromUrn: GCP_RUN, toUrn: AWS_RDS });
    expect(out.edges[0]?.evidence).toMatchObject({
      crossCloud: true,
      fromProvider: "gcp",
      toProvider: "aws",
    });
  });

  it("does NOT emit AWS→AWS (that's R3's job — no double emission)", () => {
    const out = crossBoundaryConnectsRule.evaluate(
      makeInput(
        [
          node(AWS_LAMBDA, "aws.lambda.function", { accountRef: "111111111111" }),
          node(AWS_RDS, "aws.rds.instance", {
            endpointAddress: AWS_RDS_HOST,
            accountRef: "222222222222",
          }),
        ],
        [env(AWS_LAMBDA, "aws.lambda.env", { DB_HOST: AWS_RDS_HOST })],
      ),
    );
    expect(out.edges).toEqual([]);
  });

  it("same-cloud cross-account (Azure → Azure, different subscription) flags crossAccount", () => {
    const AZ_FN = "azure:eastus:sub-app:function:worker";
    const out = crossBoundaryConnectsRule.evaluate(
      makeInput(
        [
          node(AZ_FN, "azure.function", { accountRef: "sub-app" }),
          node(AZ_SQL, "azure.sql.database", {
            fullyQualifiedDomainName: AZ_SQL_HOST,
            accountRef: "sub-aaaa",
          }),
        ],
        [env(AZ_FN, "azure.function.env", { SQL: `jdbc:sqlserver://${AZ_SQL_HOST}` })],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]?.evidence).toMatchObject({ crossCloud: false, crossAccount: true });
  });

  it("no reference → no edge", () => {
    const out = crossBoundaryConnectsRule.evaluate(
      makeInput(
        [
          node(AWS_LAMBDA, "aws.lambda.function", {}),
          node(AZ_SQL, "azure.sql.database", { fullyQualifiedDomainName: AZ_SQL_HOST }),
        ],
        [env(AWS_LAMBDA, "aws.lambda.env", { LOG_LEVEL: "info" })],
      ),
    );
    expect(out.edges).toEqual([]);
  });
});
