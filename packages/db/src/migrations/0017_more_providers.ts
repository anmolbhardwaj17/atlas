// Widen the connection provider set + seed Bitbucket vocabulary (docs/07b, docs/18). Makes
// Azure / GCP / Bitbucket (and GitLab / Datadog) valid connection providers so the
// Integrations hub can add them, and seeds Bitbucket node kinds so its graph data can exist.
// Purely additive (a widened CHECK + data inserts).

interface KindSeed {
  kind: string;
  provider: "bitbucket";
  category: string;
  description: string;
}

const BITBUCKET_KINDS: KindSeed[] = [
  {
    kind: "bitbucket.project",
    provider: "bitbucket",
    category: "code",
    description: "Bitbucket project (repo group)",
  },
  {
    kind: "bitbucket.repository",
    provider: "bitbucket",
    category: "code",
    description: "Bitbucket repository",
  },
  {
    kind: "bitbucket.pipeline",
    provider: "bitbucket",
    category: "code",
    description: "Bitbucket Pipeline (CI/CD)",
  },
  {
    kind: "bitbucket.pullrequest",
    provider: "bitbucket",
    category: "code",
    description: "Bitbucket pull request",
  },
  {
    kind: "bitbucket.user",
    provider: "bitbucket",
    category: "code",
    description: "Bitbucket user",
  },
];

const kindValues = BITBUCKET_KINDS.map(
  (k) => `('${k.kind}', '${k.provider}', '${k.category}', '${k.description}')`,
).join(",\n     ");

const PROVIDERS = ["aws", "github", "azure", "gcp", "bitbucket", "gitlab", "datadog"];

export const up: string[] = [
  `ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_provider_check`,
  `ALTER TABLE connections ADD CONSTRAINT connections_provider_check
     CHECK (provider IN (${PROVIDERS.map((p) => `'${p}'`).join(", ")}))`,

  `INSERT INTO node_kinds (kind, provider, category, description)
   VALUES ${kindValues}
   ON CONFLICT (kind) DO NOTHING`,
];

export const down: string[] = [
  `ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_provider_check`,
  `ALTER TABLE connections ADD CONSTRAINT connections_provider_check CHECK (provider IN ('aws','github'))`,
  `DELETE FROM node_kinds WHERE kind IN (${BITBUCKET_KINDS.map((k) => `'${k.kind}'`).join(", ")})`,
];
