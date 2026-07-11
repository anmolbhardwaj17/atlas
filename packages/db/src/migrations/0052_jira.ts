// Jira connector vocabulary (Intent Verification, docs/plans/intent-verification.md). Adds `jira` as a
// valid connection provider so the Integrations hub can add it, and seeds the `jira.project` /
// `jira.issue` node kinds (category 'project' — the work-tracking family) so its graph data can exist.
// PR↔issue IMPLEMENTS edges are produced later by inference, not new edge types. Purely additive.

const JIRA_KINDS = [
  { kind: "jira.project", provider: "jira", category: "project", description: "Jira project" },
  {
    kind: "jira.issue",
    provider: "jira",
    category: "project",
    description: "Jira issue (story / task / bug / subtask)",
  },
];

const kindValues = JIRA_KINDS.map(
  (k) => `('${k.kind}', '${k.provider}', '${k.category}', '${k.description}')`,
).join(",\n     ");

const PROVIDERS = [
  "aws",
  "github",
  "azure",
  "gcp",
  "bitbucket",
  "gitlab",
  "datadog",
  "jenkins",
  "jira",
];

export const up: string[] = [
  `ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_provider_check`,
  `ALTER TABLE connections ADD CONSTRAINT connections_provider_check
     CHECK (provider IN (${PROVIDERS.map((p) => `'${p}'`).join(", ")}))`,

  `INSERT INTO node_kinds (kind, provider, category, description)
   VALUES ${kindValues}
   ON CONFLICT (kind) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM node_kinds WHERE kind IN (${JIRA_KINDS.map((k) => `'${k.kind}'`).join(", ")})`,
];
