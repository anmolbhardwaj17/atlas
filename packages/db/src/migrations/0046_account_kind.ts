// Seed the `aws.account` node kind (Security Phase 2b). One node per AWS account carries
// account-level security posture (root MFA, root access keys, password policy) — facts that don't
// belong to any single resource. Category `identity`. Idempotent.

export const up: string[] = [
  `INSERT INTO node_kinds (kind, provider, category, description)
     VALUES ('aws.account', 'aws', 'identity',
             'AWS account — account-level security posture (root MFA, password policy)')
     ON CONFLICT (kind) DO NOTHING`,
];

export const down: string[] = [`DELETE FROM node_kinds WHERE kind = 'aws.account'`];
