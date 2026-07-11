// Seed inference rules R15 (`alb_routes_to_service`) and R16 (`internet_exposure`) — the cloud-posture
// half of the "exposed AND vulnerable" toxic combination (docs/plans/security-vulnerabilities.md,
// docs/05 §6.4). R15 joins an ALB and an ECS service by shared target-group ARN → ROUTES_TO; R16
// derives EXPOSED_VIA(resource→sg|elb) from a world-open SG or an internet-facing LB. Seeded before
// the engine runs so edges can reference inference_rule_id. Idempotent (ON CONFLICT (key, version)).

export const up: string[] = [
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('alb_routes_to_service', 1, 'R15 ALB routes to service', 'ROUTES_TO', 'inferred-high',
             'A load balancer and an ECS service that share a target-group ARN are wired together (ALB forwards to the target group; the service registers into it). Matched from the aws.elb.targetgroups and aws.ecs.targetgroups signals by shared ARN → ELB ROUTES_TO the service.')
     ON CONFLICT (key, version) DO NOTHING`,
  `INSERT INTO inference_rules (key, version, name, produces_type, confidence_tier, description)
     VALUES ('internet_exposure', 1, 'R16 internet exposure', 'EXPOSED_VIA', 'inferred-high',
             'A compute resource is internet-exposed when it is protected by a security group open to 0.0.0.0/0 or ::/0, or routed to by an internet-facing load balancer → EXPOSED_VIA(resource→sg|elb). Precision-first: public IPs / public subnets / S3 public-access are not inferred (uncrawled).')
     ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM inference_rules WHERE key IN ('alb_routes_to_service', 'internet_exposure')`,
];
