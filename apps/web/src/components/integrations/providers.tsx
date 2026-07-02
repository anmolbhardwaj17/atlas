import {
  Cloud,
  Github,
  Server,
  Boxes,
  GitBranch,
  Gitlab,
  Activity,
  type LucideIcon,
} from "lucide-react";

export type ProviderStatus = "available" | "coming-soon";

export interface ProviderMeta {
  /** For available providers this is the connection `provider` value (aws/github). */
  id: string;
  name: string;
  category: "Cloud" | "Code" | "Observability";
  status: ProviderStatus;
  blurb: string;
  icon: LucideIcon;
}

/**
 * The integration catalog (docs/18 roadmap). AWS + GitHub are live (real connectors);
 * the rest are surfaced as "coming soon" so the roadmap is visible and the page reads as a
 * real hub. Adding a provider later = flip status + register a connector (docs/06 §3).
 */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "aws",
    name: "Amazon Web Services",
    category: "Cloud",
    status: "available",
    blurb: "EC2, ECS, Lambda, RDS, DynamoDB, VPC, IAM and more — via a read-only role.",
    icon: Cloud,
  },
  {
    id: "github",
    name: "GitHub",
    category: "Code",
    status: "available",
    blurb: "Repositories, workflows, dependencies and ownership — via a read-only App.",
    icon: Github,
  },
  {
    id: "azure",
    name: "Microsoft Azure",
    category: "Cloud",
    status: "coming-soon",
    blurb: "VMs, AKS, App Service, and Azure SQL.",
    icon: Server,
  },
  {
    id: "gcp",
    name: "Google Cloud",
    category: "Cloud",
    status: "coming-soon",
    blurb: "Compute Engine, GKE, Cloud SQL, and Pub/Sub.",
    icon: Boxes,
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    category: "Code",
    status: "coming-soon",
    blurb: "Repositories and Pipelines (the connector abstraction is already proven).",
    icon: GitBranch,
  },
  {
    id: "gitlab",
    name: "GitLab",
    category: "Code",
    status: "coming-soon",
    blurb: "Projects, members, and CI/CD pipelines.",
    icon: Gitlab,
  },
  {
    id: "datadog",
    name: "Datadog",
    category: "Observability",
    status: "coming-soon",
    blurb: "Monitors, dashboards, and the service map — richer runtime signal.",
    icon: Activity,
  },
];
