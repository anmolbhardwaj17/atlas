// Seed inference rule R14 (`image_name_correlation`). When an ECS task-def image tag isn't a git
// SHA (`:latest`, `:v1.2.3`), R12 can't match a commit — but the ECR image NAME still names the code
// (`…/api-backend:latest` ← repo api-backend-provapt). This matches the image name to a crawled repo
// slug → repo DEPLOYS_TO the ECS service running the task-def. Uses the images the ECS module already
// captures (no crawl change). Seeded before the engine runs so edges can reference inference_rule_id.

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('image_name_correlation', 1, 'R14 image name correlation', 'DEPLOYS_TO', 'inferred-high',
             'An ECS task-def''s ECR image repository name matched to a crawled repo slug (exact or stem, non-generic) → repo DEPLOYS_TO the ECS service running it; several repos matching → inferred-low each (P3). Companion to R12 for non-SHA image tags.')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [`DELETE FROM inference_rules WHERE key = 'image_name_correlation'`];
