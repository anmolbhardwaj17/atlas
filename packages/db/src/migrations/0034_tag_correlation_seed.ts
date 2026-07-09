// Signal-enrichment slice 1 (docs/plans/signal-enrichment.md): seed inference rule R11
// (`tag_code_correlation`). AWS resource tags naming the owning code (repository / service /
// application / CloudFormation stack) are matched by exact normalized equality to a crawled
// repo slug → DEPLOYS_TO(repo→compute). Seeded before the engine runs so inferred edges can
// reference `inference_rule_id` (FK). Idempotent. No new node kind (reuses existing kinds).

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('tag_code_correlation', 1, 'R11 tag code correlation', 'DEPLOYS_TO', 'inferred-high',
             'AWS resource tags (repository/service/application/CloudFormation stack) matched by exact normalized equality to a crawled repo slug → DEPLOYS_TO(repo→compute); a value matching several repos → inferred-low each (P3)')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [`DELETE FROM inference_rules WHERE key = 'tag_code_correlation'`];
