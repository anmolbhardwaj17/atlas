export type ProviderStatus = "available" | "coming-soon";

export interface ProviderMeta {
  /** For available providers this is the connection `provider` value (aws/github). */
  id: string;
  name: string;
  category: "Cloud" | "Code" | "Observability";
  status: ProviderStatus;
  blurb: string;
  /** Real brand logo key in CLOUD_ICONS (cloud-icons-data). */
  logo: string;
}

/**
 * The integration catalog (docs/18 roadmap). AWS + GitHub are live (real connectors); the
 * rest are surfaced as "coming soon" so the roadmap is visible and the page reads as a real
 * hub. Adding a provider later = flip status + register a connector (docs/06 §3). Tiles use
 * the real provider brand logos.
 */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "aws",
    name: "Amazon Web Services",
    category: "Cloud",
    status: "available",
    blurb: "EC2, ECS, Lambda, RDS, DynamoDB, VPC, IAM and more — via a read-only role.",
    logo: "aws",
  },
  {
    id: "github",
    name: "GitHub",
    category: "Code",
    status: "available",
    blurb: "Repositories, workflows, dependencies and ownership — via a read-only App.",
    logo: "github-icon",
  },
  {
    id: "azure",
    name: "Microsoft Azure",
    category: "Cloud",
    status: "available",
    blurb: "VMs, AKS, App Service, SQL — via a read-only service principal.",
    logo: "microsoft-azure",
  },
  {
    id: "gcp",
    name: "Google Cloud",
    category: "Cloud",
    status: "available",
    blurb: "Compute Engine, GKE, Cloud SQL, Pub/Sub — via a read-only service account.",
    logo: "google-cloud",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    category: "Code",
    status: "available",
    blurb: "Repositories, Pipelines, and pull requests — via a read-only App password.",
    logo: "bitbucket",
  },
  {
    id: "gitlab",
    name: "GitLab",
    category: "Code",
    status: "coming-soon",
    blurb: "Projects, members, and CI/CD pipelines.",
    logo: "gitlab",
  },
  {
    id: "datadog",
    name: "Datadog",
    category: "Observability",
    status: "coming-soon",
    blurb: "Monitors, dashboards, and the service map — richer runtime signal.",
    logo: "datadog",
  },
];
