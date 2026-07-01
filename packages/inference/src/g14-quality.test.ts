import { describe, it, expect } from "vitest";
import { evaluateAll } from "./evaluate";
import { ALL_RULES } from "./rules";
import type { EdgeLite, InferenceInput, NodeLite, SignalLite } from "./types";

function makeInput(p: {
  nodes?: NodeLite[];
  signals?: SignalLite[];
  observedEdges?: EdgeLite[];
  orgSlug?: string;
}): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of p.nodes ?? []) {
    nodesByUrn.set(n.urn, n);
    const l = nodesByKind.get(n.kind);
    if (l) l.push(n);
    else nodesByKind.set(n.kind, [n]);
  }
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of p.signals ?? []) {
    const l = signalsByKind.get(s.kind);
    if (l) l.push(s);
    else signalsByKind.set(s.kind, [s]);
  }
  return {
    orgSlug: p.orgSlug ?? "acme",
    nodesByUrn,
    nodesByKind,
    signals: p.signals ?? [],
    signalsByKind,
    observedEdges: p.observedEdges ?? [],
    inferredEdges: [],
  };
}
const node = (urn: string, kind: string, attributes: Record<string, unknown> = {}): NodeLite => ({
  id: urn,
  urn,
  kind,
  attributes,
});
const edgeKey = (e: { type: string; fromUrn: string; toUrn: string }): string =>
  `${e.type}:${e.fromUrn}->${e.toUrn}`;

// ── The docs/05 §9 worked example (Acme) as a single fixture ──────────────────
const REPO = "github:acme/orders-svc";
const ECS = "aws:us-east-1:111122223333:ecs-service:prod/orders";
const LAMBDA = "aws:us-east-1:111122223333:lambda:orders-worker";
const RDS = "aws:us-east-1:111122223333:rds:prod-orders";
const RDS_HOST = "prod-orders.abc.us-east-1.rds.amazonaws.com";
const SG_APP = "aws:us-east-1:111122223333:sg:sg-app";
const SG_DB = "aws:us-east-1:111122223333:sg:sg-db";
const TEAM = "github:acme:team:payments";
const PR = "github:acme/orders-svc:pr:482";
const SERVICE = "atlas:acme:service:orders-svc";

function workedExample(): InferenceInput {
  return makeInput({
    orgSlug: "acme",
    nodes: [
      node(REPO, "github.repository", { owner: "acme", repo: "orders-svc" }),
      node(ECS, "aws.ecs.service", { serviceName: "orders", cluster: "prod", vpcId: "vpc-1" }),
      node(LAMBDA, "aws.lambda.function", { functionName: "orders-worker", vpcId: "vpc-1" }),
      node(RDS, "aws.rds.instance", {
        engine: "postgres",
        endpointPort: 5432,
        endpointAddress: RDS_HOST,
        vpcId: "vpc-1",
      }),
      node(SG_APP, "aws.securitygroup", { groupId: "sg-app", vpcId: "vpc-1" }),
      node(SG_DB, "aws.securitygroup", { groupId: "sg-db", vpcId: "vpc-1" }),
      node(TEAM, "github.team", { slug: "payments" }),
      node(PR, "github.pull_request", { number: 482 }),
    ],
    observedEdges: [
      { type: "PROTECTS", fromUrn: SG_APP, toUrn: ECS },
      { type: "PROTECTS", fromUrn: SG_DB, toUrn: RDS },
      { type: "OWNED_BY", fromUrn: REPO, toUrn: TEAM },
    ],
    signals: [
      {
        subjectUrn: `${REPO}:workflow:.github/workflows/deploy.yml`,
        kind: "github.workflow.deploy",
        data: { repo: REPO, targets: [{ kind: "ecs", cluster: "prod", service: "orders" }] },
      },
      {
        subjectUrn: SG_DB,
        kind: "aws.sg.rules",
        data: {
          ingress: [{ protocol: "tcp", fromPort: 5432, toPort: 5432, groupRefs: ["sg-app"] }],
        },
      },
      { subjectUrn: LAMBDA, kind: "aws.lambda.env", data: { variables: { DB_HOST: RDS_HOST } } },
      {
        subjectUrn: PR,
        kind: "github.pr.files",
        data: { files: ["src/a.ts"], mergedAt: "2026-06-30T00:00:00Z" },
      },
    ],
  });
}

const GOLDEN_EDGES = [
  `CHANGED_BY:${SERVICE}->${PR}`,
  `CONNECTS_TO:${ECS}->${RDS}`,
  `CONNECTS_TO:${LAMBDA}->${RDS}`,
  `DEPLOYS_TO:${REPO}->${ECS}`,
  `IMPLEMENTS:${REPO}->${SERVICE}`,
  `OWNED_BY:${SERVICE}->${TEAM}`,
  `RUNS:${ECS}->${SERVICE}`,
].sort();

describe("G1.4 determinism (golden file, IE-1/A19)", () => {
  it("reproduces the docs/05 §9 worked-example edge set exactly", () => {
    const plan = evaluateAll(workedExample(), ALL_RULES);
    expect(plan.edges.map(edgeKey).sort()).toEqual(GOLDEN_EDGES);
    expect(plan.nodes.map((n) => n.urn)).toEqual([SERVICE]); // one derived atlas.service
    // Every edge is cited + tiered (no un-sourced / untiered edge, P4/DD-4).
    for (const e of plan.edges) {
      expect(["inferred-high", "inferred-low"]).toContain(e.tier);
      expect(Object.keys(e.evidence).length).toBeGreaterThan(0);
    }
  });

  it("is deterministic — identical inputs yield an identical plan", () => {
    const a = evaluateAll(workedExample(), ALL_RULES);
    const b = evaluateAll(workedExample(), ALL_RULES);
    expect(a).toEqual(b);
  });
});

// ── Precision sampling (docs/00 §7.2 ≥95%) ───────────────────────────────────
interface LabeledCase {
  name: string;
  input: InferenceInput;
  /** Ground-truth correct edges the rules should produce (true positives). */
  correct: string[];
}

const CASES: LabeledCase[] = [
  { name: "worked-example", input: workedExample(), correct: GOLDEN_EDGES },
  {
    name: "R2 wrong port → no false CONNECTS_TO",
    input: makeInput({
      nodes: [
        node(ECS, "aws.ecs.service", { serviceName: "x", vpcId: "vpc-1" }),
        node(RDS, "aws.rds.instance", { endpointPort: 5432, vpcId: "vpc-1" }),
        node(SG_APP, "aws.securitygroup", { groupId: "sg-app", vpcId: "vpc-1" }),
        node(SG_DB, "aws.securitygroup", { groupId: "sg-db", vpcId: "vpc-1" }),
      ],
      observedEdges: [
        { type: "PROTECTS", fromUrn: SG_APP, toUrn: ECS },
        { type: "PROTECTS", fromUrn: SG_DB, toUrn: RDS },
      ],
      signals: [
        {
          subjectUrn: SG_DB,
          kind: "aws.sg.rules",
          data: { ingress: [{ fromPort: 80, toPort: 80, groupRefs: ["sg-app"] }] },
        },
      ],
    }),
    correct: [], // must produce nothing
  },
  {
    name: "R8 wildcard IAM → no false edge",
    input: makeInput({
      nodes: [node("aws:global:111122223333:s3:assets", "aws.s3.bucket", { bucketName: "assets" })],
      observedEdges: [
        { type: "ASSUMES_ROLE", fromUrn: LAMBDA, toUrn: "aws:global:111122223333:iam-role:r" },
      ],
      signals: [
        {
          subjectUrn: "aws:global:111122223333:iam-role:r",
          kind: "aws.iam.policy_statements",
          data: { statements: [{ effect: "Allow", actions: ["s3:*"], resources: ["*"] }] },
        },
      ],
    }),
    correct: [],
  },
];

describe("G1.4 precision sampling (≥95%)", () => {
  it("produces zero false-positive inferred edges on the labeled set", () => {
    let produced = 0;
    let truePositives = 0;
    for (const c of CASES) {
      const correct = new Set(c.correct);
      const edges = evaluateAll(c.input, ALL_RULES).edges.map(edgeKey);
      produced += edges.length;
      truePositives += edges.filter((k) => correct.has(k)).length;
      // Also: no expected edge missing (recall sanity on the labeled set).
      for (const k of c.correct) expect(edges).toContain(k);
    }
    const precision = produced === 0 ? 1 : truePositives / produced;
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(precision).toBe(1); // our rules are precise on the labeled fixtures
  });
});
