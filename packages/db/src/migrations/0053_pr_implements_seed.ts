// Intent Verification (docs/plans/intent-verification.md): seed inference rule R18
// (`pr_implements_issue`). An explicit Jira key (PROJ-123) in a PR's title or source branch matching a
// crawled jira.issue → the PR IMPLEMENTS that issue (inferred-high — the author named the ticket).
// Seeded before the engine runs so inferred edges can reference `inference_rule_id` (FK). Idempotent.

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('pr_implements_issue', 1, 'R18 PR implements Jira issue', 'IMPLEMENTS', 'inferred-high',
             'An explicit Jira key in a PR title/branch matching a crawled jira.issue → the PR IMPLEMENTS that issue (deterministic tier); fuzzy no-key linking is a later low-tier slice.')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [`DELETE FROM inference_rules WHERE key = 'pr_implements_issue'`];
