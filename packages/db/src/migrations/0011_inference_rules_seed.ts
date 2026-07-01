// Inference-rule registry seed (docs/05 §6.4). Each rule the engine (G1) runs has a
// stable (key, version); edges it derives carry `inference_rule_id` → this row, and a
// version bump enables reproducibility/rollout (IE-5, BR-RULE-2). `confidence_tier` is
// the rule's NOMINAL tier; the actual edge confidence is set per-edge (R1 can emit high
// OR low). Observed rules (R5 CODEOWNERS, R7 routing chain) are emitted by connectors,
// not here. Idempotent (ON CONFLICT (key, version)).

interface RuleSeed {
  key: string;
  name: string;
  produces: string;
  tier: "inferred-high" | "inferred-low";
  description: string;
}

const RULES: RuleSeed[] = [
  {
    key: "repo_deploys_to_runtime",
    name: "R1 repo deploys to runtime",
    produces: "DEPLOYS_TO",
    tier: "inferred-high",
    description:
      "Workflow deploy target resolves to an AWS runtime (ARN/name exact=high, heuristic=low)",
  },
  {
    key: "service_derivation",
    name: "R4 service derivation",
    produces: "IMPLEMENTS,RUNS",
    tier: "inferred-high",
    description:
      "From a high-confidence DEPLOYS_TO, derive atlas.service + IMPLEMENTS (repo) and RUNS (runtime)",
  },
  {
    key: "pr_changes_service",
    name: "R6 PR changes service",
    produces: "CHANGED_BY",
    tier: "inferred-high",
    description:
      "A merged PR in a repo that IMPLEMENTS a service marks the service CHANGED_BY the PR",
  },
  {
    key: "ownership_propagation",
    name: "R5 ownership propagation",
    produces: "OWNED_BY",
    tier: "inferred-high",
    description: "Propagate observed repo OWNED_BY to the service the repo IMPLEMENTS",
  },
  {
    key: "sg_correlation_connects",
    name: "R2 security-group correlation",
    produces: "CONNECTS_TO",
    tier: "inferred-high",
    description:
      "Security-group reachability on a datastore port implies a runtime CONNECTS_TO the datastore",
  },
  {
    key: "config_ref_connects",
    name: "R3 config reference",
    produces: "CONNECTS_TO",
    tier: "inferred-high",
    description:
      "An env var value referencing an RDS endpoint / DynamoDB table / S3 bucket implies CONNECTS_TO or STORES_IN",
  },
  {
    key: "iam_access_connects",
    name: "R8 IAM access",
    produces: "CONNECTS_TO",
    tier: "inferred-low",
    description:
      "An assumed role whose policy permits access to a resource ARN implies a low-confidence CONNECTS_TO/STORES_IN",
  },
];

const values = RULES.map(
  (r) => `('${r.key}', 1, '${r.name}', '${r.description}', '${r.produces}', '${r.tier}', true)`,
).join(",\n     ");

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, description, produces_type, confidence_tier, enabled)
   VALUES ${values}
   ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM inference_rules WHERE key IN (${RULES.map((r) => `'${r.key}'`).join(", ")}) AND version = 1`,
];
