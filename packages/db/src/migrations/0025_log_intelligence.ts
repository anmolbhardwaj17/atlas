// Log-intelligence layer (operational-intelligence "reverse-engineering"): CloudWatch
// log groups become support-data nodes (`aws.logs.group`, excluded from map/estate browse
// like external.package) whose names evidence what runs inside opaque compute; inference
// rule R10 (`log_workload_correlation`) correlates those workloads with repositories and
// the compute they run on → DEPLOYS_TO. Idempotent seeds.

export const up: string[] = [
  `INSERT INTO node_kinds (kind, provider, category, description)
     VALUES ('aws.logs.group', 'aws', 'observability', 'CloudWatch log group (workload evidence)')
     ON CONFLICT (kind) DO NOTHING`,
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('log_workload_correlation', 1, 'R10 log workload correlation', 'DEPLOYS_TO', 'inferred-low',
             'CloudWatch log-group names matched to repository slugs + the compute the group names (lambda/ecs exact; ec2 single-host heuristic)')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM inference_rules WHERE key = 'log_workload_correlation'`,
  `DELETE FROM node_kinds WHERE kind = 'aws.logs.group'`,
];
