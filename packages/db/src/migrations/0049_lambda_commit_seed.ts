// Operational-intelligence Phase A (docs/plans/operational-intelligence.md): seed inference rule R17
// (`lambda_commit_provenance`). The Lambda sibling of R12 — a git SHA found on a Lambda (its container
// image tag, its Description, or a tag value) matched by prefix to a crawled PR commit hash → the repo
// DEPLOYS_TO the Lambda. Seeded before the engine runs so inferred edges can reference
// `inference_rule_id` (FK). Idempotent.

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('lambda_commit_provenance', 1, 'R17 lambda commit provenance', 'DEPLOYS_TO', 'inferred-high',
             'A git SHA on a Lambda (container image tag / Description / tag value) matched by prefix to a crawled PR commit hash → the repo DEPLOYS_TO the Lambda; a SHA matching several repos → inferred-low each (P3). CodeSha256 is ignored (it is a zip hash, not a git SHA).')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM inference_rules WHERE key = 'lambda_commit_provenance'`,
];
