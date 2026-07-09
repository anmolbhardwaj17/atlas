// Signal-enrichment slice 3 (docs/plans/signal-enrichment.md): seed inference rule R13
// (`service_name_env_correlation`). A runtime's self-reported service name env var
// (OTEL_SERVICE_NAME / DD_SERVICE / SERVICE_NAME / OTEL resource attrs), matched by exact
// normalized equality to a crawled repo slug → the repo DEPLOYS_TO that runtime (Lambda, or
// the ECS service running the task-def). Reuses the existing env signals (no crawl change).
// Seeded before the engine runs so inferred edges can reference `inference_rule_id`. Idempotent.

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('service_name_env_correlation', 1, 'R13 service name env correlation', 'DEPLOYS_TO', 'inferred-high',
             'A runtime service-name env var (OTEL_SERVICE_NAME/DD_SERVICE/SERVICE_NAME/OTEL resource attrs) matched by exact normalized equality to a crawled repo slug → repo DEPLOYS_TO the runtime; a name matching several repos → inferred-low each (P3)')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM inference_rules WHERE key = 'service_name_env_correlation'`,
];
