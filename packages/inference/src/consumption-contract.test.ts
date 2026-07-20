import { describe, it, expect } from "vitest";
import { ALL_RULES } from "./rules";
import type { InferenceInput, NodeLite, SignalLite } from "./types";

/**
 * C2 safety contract. The engine scopes the heavy JSONB load to the union of every rule's
 * `consumesKinds` / `consumesSignalKinds` (`engine.buildInput`), blanking attributes for non-consumed
 * node kinds and skipping non-consumed signals entirely. That is only safe if every rule DECLARES
 * each kind/signal it actually reads via `nodesByKind.get` / `signalsByKind.get`.
 *
 * This test enforces the contract by construction: it runs each registered rule's `evaluate()` with
 * `nodesByKind` / `signalsByKind` wrapped so every `.get(kind)` call is recorded, then asserts the
 * rule declared everything it read. So an under-declaration — the failure that would silently drop
 * inferred edges on a real tenant — turns into a red test here instead. Over-declaration is fine.
 *
 * The fixture seeds a node of every declared kind and a signal of every declared signal-kind (with a
 * superset `data` shape) so the rules' loops actually execute their `.get` calls, plus a couple of
 * observed/inferred edges for the edge-driven rules (r4/r5/r6/r16). Endpoint resolution goes through
 * `nodesByUrn` (always fully loaded), so it needs no declaration and isn't part of the contract.
 */

/** A Map that records every key passed to `.get()` — the instrumentation behind the contract. */
class RecordingMap<V> extends Map<string, V> {
  readonly accessed = new Set<string>();
  override get(key: string): V | undefined {
    this.accessed.add(key);
    return super.get(key);
  }
}

const ALL_KINDS = [...new Set(ALL_RULES.flatMap((r) => r.consumesKinds))];
const ALL_SIGNAL_KINDS = [...new Set(ALL_RULES.flatMap((r) => r.consumesSignalKinds))];

/** Rich, generic attributes so nested/attribute-gated `.get` paths (e.g. ARN resolution) execute. */
const RICH_ATTRS: Record<string, unknown> = {
  region: "us-east-1",
  accountRef: "123456789012",
  bucketName: "my-bucket",
  tableName: "my-table",
  dbInstanceIdentifier: "my-db",
  endpoint: "my-db.example.rds.amazonaws.com",
  host: "my-db.example",
  image: "repo/app:abc1234def5678",
  taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/app:1",
  state: "OPEN",
  tags: { repository: "org/app", "atlas:repo": "org/app", commit: "abc1234def5678" },
};

/** A superset signal payload covering every rule's expected `data` shape. */
const RICH_SIGNAL_DATA: Record<string, unknown> = {
  variables: {
    DD_SERVICE: "orders",
    DATABASE_URL: "postgres://my-db.example:5432/app",
    BUCKET: "arn:aws:s3:::my-bucket",
    COMMIT_SHA: "abc1234def5678",
  },
  // r8 reads lowercase effect/resources; include one s3/dynamodb/rds ARN so refs.resolveResourceArn
  // (and thus the nested nodesByKind.get for those kinds) actually fires under recording.
  statements: [
    {
      effect: "Allow",
      actions: ["s3:GetObject", "dynamodb:GetItem", "rds-db:connect"],
      resources: [
        "arn:aws:s3:::my-bucket",
        "arn:aws:dynamodb:us-east-1:123456789012:table/my-table",
        "arn:aws:rds:us-east-1:123456789012:db:my-db",
      ],
    },
  ],
  rules: [{ direction: "ingress", protocol: "tcp", fromPort: 5432, toPort: 5432, cidr: "10.0.0.0/8" }],
  files: ["src/orders/handler.ts", "README.md"],
  targetGroups: [{ arn: "arn:aws:elasticloadbalancing:...:targetgroup/tg/1", targetArns: [] }],
  repo: "org/app",
  target: "aws:ecs:svc/orders",
  image: "repo/app:abc1234def5678",
};

function buildRecordingInput(): {
  input: InferenceInput;
  nodesByKind: RecordingMap<NodeLite[]>;
  signalsByKind: RecordingMap<SignalLite[]>;
} {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new RecordingMap<NodeLite[]>();
  for (const kind of ALL_KINDS) {
    const node: NodeLite = {
      id: `id-${kind}`,
      urn: `urn:${kind}:1`,
      kind,
      name: kind.split(".").pop() ?? kind,
      attributes: { ...RICH_ATTRS },
    };
    nodesByUrn.set(node.urn, node);
    nodesByKind.set(kind, [node]);
  }

  const signalsByKind = new RecordingMap<SignalLite[]>();
  const signals: SignalLite[] = [];
  for (const kind of ALL_SIGNAL_KINDS) {
    const sig: SignalLite = { subjectUrn: `urn:subject:${kind}`, kind, data: { ...RICH_SIGNAL_DATA } };
    signalsByKind.set(kind, [sig]);
    signals.push(sig);
  }

  const someUrn = ALL_KINDS[0] ? `urn:${ALL_KINDS[0]}:1` : "urn:x:1";
  const input: InferenceInput = {
    orgSlug: "acme",
    nodesByUrn,
    nodesByKind,
    signals,
    signalsByKind,
    // Edges so the edge-driven rules exercise their loops. The ASSUMES_ROLE edge points at the
    // policy-statements signal's subject so r8's ARN-resolution path (refs → s3/dynamodb/rds) fires.
    observedEdges: [
      { type: "OWNED_BY", fromUrn: someUrn, toUrn: "urn:user:1" },
      { type: "CONTAINS", fromUrn: someUrn, toUrn: "urn:child:1" },
      { type: "ASSUMES_ROLE", fromUrn: "urn:runtime:1", toUrn: "urn:subject:aws.iam.policy_statements" },
    ],
    inferredEdges: [{ type: "DEPLOYS_TO", fromUrn: someUrn, toUrn: someUrn, tier: "inferred-high" }],
    rejectedEdgeKeys: new Set<string>(),
  };
  return { input, nodesByKind, signalsByKind };
}

describe("C2 consumption contract", () => {
  it("has at least one registered rule to check", () => {
    expect(ALL_RULES.length).toBeGreaterThan(0);
  });

  for (const rule of ALL_RULES) {
    it(`${rule.key} declares every kind/signal it reads`, () => {
      const { input, nodesByKind, signalsByKind } = buildRecordingInput();
      // Rules are pure — evaluating them only reads the input; any throw is a fixture gap, not a pass.
      rule.evaluate(input);

      const undeclaredKinds = [...nodesByKind.accessed].filter(
        (k) => !rule.consumesKinds.includes(k),
      );
      const undeclaredSignals = [...signalsByKind.accessed].filter(
        (k) => !rule.consumesSignalKinds.includes(k),
      );

      expect(
        undeclaredKinds,
        `${rule.key} reads nodesByKind.get() for undeclared kind(s) — add them to consumesKinds`,
      ).toEqual([]);
      expect(
        undeclaredSignals,
        `${rule.key} reads signalsByKind.get() for undeclared signal kind(s) — add to consumesSignalKinds`,
      ).toEqual([]);
    });
  }
});
