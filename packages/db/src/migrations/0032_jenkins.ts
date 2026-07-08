// Jenkins / CI-CD connector vocabulary (docs/07c). Adds `jenkins` as a valid connection provider
// so the Integrations hub can add it, and seeds the `jenkins.job` node kind (category 'cicd' — the
// pipeline family) so its graph data can exist. The observed DEPLOYS_TO edges it enables are
// produced by inference (R1 from `jenkins.deploy` signals), not new edge types. Purely additive.

const JENKINS_KINDS = [
  {
    kind: "jenkins.job",
    provider: "jenkins",
    category: "cicd",
    description: "Jenkins job / pipeline",
  },
];

const kindValues = JENKINS_KINDS.map(
  (k) => `('${k.kind}', '${k.provider}', '${k.category}', '${k.description}')`,
).join(",\n     ");

const PROVIDERS = ["aws", "github", "azure", "gcp", "bitbucket", "gitlab", "datadog", "jenkins"];

export const up: string[] = [
  `ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_provider_check`,
  `ALTER TABLE connections ADD CONSTRAINT connections_provider_check
     CHECK (provider IN (${PROVIDERS.map((p) => `'${p}'`).join(", ")}))`,

  `INSERT INTO node_kinds (kind, provider, category, description)
   VALUES ${kindValues}
   ON CONFLICT (kind) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM node_kinds WHERE kind IN (${JENKINS_KINDS.map((k) => `'${k.kind}'`).join(", ")})`,
];
