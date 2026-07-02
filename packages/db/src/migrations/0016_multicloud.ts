// Multi-cloud foundation (docs/05 §3, docs/18). Adds the node-kind vocabulary for Azure and
// GCP so the graph can represent a multi-cloud, multi-account/subscription/project estate,
// and registers R9 `cross_boundary_connects` — the provider-agnostic rule that stitches a
// compute config reference to a datastore ANYWHERE in the org (any account/cloud), flagging
// cross-account / cross-cloud links. Purely additive (data inserts, docs/04 DD-1 / docs/06 §9).
//
// URN conventions mirror AWS (`aws:<region>:<account>:<type>:<key>`):
//   Azure → `azure:<region>:<subscription>:<type>:<key>`
//   GCP   → `gcp:<region>:<project>:<type>:<key>`
// so account/subscription/project is a first-class URN segment (+ `attributes.accountRef`).

interface KindSeed {
  kind: string;
  provider: "azure" | "gcp";
  category: string;
  description: string;
}

const AZURE_KINDS: KindSeed[] = [
  { kind: "azure.vm", provider: "azure", category: "compute", description: "Virtual Machine" },
  { kind: "azure.function", provider: "azure", category: "compute", description: "Function App" },
  {
    kind: "azure.appservice",
    provider: "azure",
    category: "compute",
    description: "App Service / Web App",
  },
  {
    kind: "azure.aks.cluster",
    provider: "azure",
    category: "compute",
    description: "AKS Kubernetes cluster",
  },
  {
    kind: "azure.sql.database",
    provider: "azure",
    category: "data",
    description: "Azure SQL Database",
  },
  {
    kind: "azure.postgres",
    provider: "azure",
    category: "data",
    description: "Azure Database for PostgreSQL",
  },
  { kind: "azure.cosmosdb", provider: "azure", category: "data", description: "Cosmos DB account" },
  {
    kind: "azure.storage.account",
    provider: "azure",
    category: "storage",
    description: "Storage Account",
  },
  { kind: "azure.vnet", provider: "azure", category: "network", description: "Virtual Network" },
  { kind: "azure.subnet", provider: "azure", category: "network", description: "VNet subnet" },
  {
    kind: "azure.loadbalancer",
    provider: "azure",
    category: "network",
    description: "Load Balancer",
  },
  { kind: "azure.keyvault", provider: "azure", category: "security", description: "Key Vault" },
];

const GCP_KINDS: KindSeed[] = [
  {
    kind: "gcp.gce.instance",
    provider: "gcp",
    category: "compute",
    description: "Compute Engine VM instance",
  },
  { kind: "gcp.cloudrun", provider: "gcp", category: "compute", description: "Cloud Run service" },
  {
    kind: "gcp.cloudfunction",
    provider: "gcp",
    category: "compute",
    description: "Cloud Function",
  },
  { kind: "gcp.gke.cluster", provider: "gcp", category: "compute", description: "GKE cluster" },
  {
    kind: "gcp.cloudsql.instance",
    provider: "gcp",
    category: "data",
    description: "Cloud SQL instance",
  },
  { kind: "gcp.spanner", provider: "gcp", category: "data", description: "Spanner instance" },
  { kind: "gcp.firestore", provider: "gcp", category: "data", description: "Firestore database" },
  {
    kind: "gcp.gcs.bucket",
    provider: "gcp",
    category: "storage",
    description: "Cloud Storage bucket",
  },
  { kind: "gcp.vpc", provider: "gcp", category: "network", description: "VPC network" },
  { kind: "gcp.subnet", provider: "gcp", category: "network", description: "Subnetwork" },
  {
    kind: "gcp.pubsub.topic",
    provider: "gcp",
    category: "messaging",
    description: "Pub/Sub topic",
  },
];

const KINDS = [...AZURE_KINDS, ...GCP_KINDS];
const kindValues = KINDS.map(
  (k) => `('${k.kind}', '${k.provider}', '${k.category}', '${k.description}')`,
).join(",\n     ");

export const up: string[] = [
  `INSERT INTO node_kinds (kind, provider, category, description)
   VALUES ${kindValues}
   ON CONFLICT (kind) DO NOTHING`,

  `INSERT INTO inference_rules (key, version, name, description, produces_type, confidence_tier, enabled)
   VALUES ('cross_boundary_connects', 1, 'R9 cross-boundary connects',
     'A compute config reference resolving to a datastore in another account/cloud implies a cross-boundary CONNECTS_TO/STORES_IN',
     'CONNECTS_TO,STORES_IN', 'inferred-high', true)
   ON CONFLICT (key, version) DO NOTHING`,
];

export const down: string[] = [
  `DELETE FROM inference_rules WHERE key = 'cross_boundary_connects' AND version = 1`,
  `DELETE FROM node_kinds WHERE kind IN (${KINDS.map((k) => `'${k.kind}'`).join(", ")})`,
];
