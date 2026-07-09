// Signal-enrichment slice 2 (docs/plans/signal-enrichment.md): seed inference rule R12
// (`image_commit_provenance`). An ECS image tag's git short-SHA, matched by prefix to a
// crawled PR's commit hash, means the running image was built from that commit → its repo
// DEPLOYS_TO the ECS service (inferred-high — near-observed provenance). Seeded before the
// engine runs so inferred edges can reference `inference_rule_id` (FK). Idempotent.

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('image_commit_provenance', 1, 'R12 image commit provenance', 'DEPLOYS_TO', 'inferred-high',
             'A git short-SHA in an ECS image tag matched (by prefix) to a crawled PR commit hash → the repo DEPLOYS_TO the ECS service running that image; a SHA matching several repos → inferred-low each (P3)')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [`DELETE FROM inference_rules WHERE key = 'image_commit_provenance'`];
