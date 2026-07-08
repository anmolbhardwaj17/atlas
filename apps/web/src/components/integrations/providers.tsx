import { Hammer } from "lucide-react";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { cn } from "@/lib/cn";

export type ProviderStatus = "available" | "coming-soon";

export interface ProviderMeta {
  /** For available providers this is the connection `provider` value (aws/github). */
  id: string;
  name: string;
  category: "Cloud" | "Code" | "CI/CD" | "Observability" | "Alerts";
  status: ProviderStatus;
  blurb: string;
  /** Real brand logo key in CLOUD_ICONS (cloud-icons-data), or a key we fall back to a glyph for. */
  logo: string;
}

/** Renders a provider's brand logo, falling back to a lucide glyph when we have no bundled SVG
 *  (e.g. Jenkins — its detailed logo isn't in the CC0 set). */
export function ProviderLogo({
  provider,
  className,
}: {
  provider: ProviderMeta;
  className?: string;
}) {
  if (hasCloudIcon(provider.logo)) {
    return <CloudIcon name={provider.logo} className={className ?? ""} />;
  }
  return <Hammer className={cn("text-muted-foreground", className)} />;
}

/**
 * The integration catalog (docs/18 roadmap). AWS + GitHub are live (real connectors); the
 * rest are surfaced as "coming soon" so the roadmap is visible and the page reads as a real
 * hub. Adding a provider later = flip status + register a connector (docs/06 §3). Tiles use
 * the real provider brand logos.
 */
export const PROVIDERS: ProviderMeta[] = [
  // ── Cloud ──
  {
    id: "aws",
    name: "Amazon Web Services",
    category: "Cloud",
    status: "available",
    blurb: "EC2, ECS, Lambda, RDS, DynamoDB, VPC, IAM and more - via a read-only role.",
    logo: "aws",
  },
  {
    id: "azure",
    name: "Microsoft Azure",
    category: "Cloud",
    status: "available",
    blurb: "VMs, AKS, App Service, SQL - via a read-only service principal.",
    logo: "microsoft-azure",
  },
  {
    id: "gcp",
    name: "Google Cloud",
    category: "Cloud",
    status: "available",
    blurb: "Compute Engine, GKE, Cloud SQL, Pub/Sub - via a read-only service account.",
    logo: "google-cloud",
  },
  // ── Code ──
  {
    id: "github",
    name: "GitHub",
    category: "Code",
    status: "available",
    blurb: "Repositories, workflows, dependencies and ownership - via a read-only App.",
    logo: "github-icon",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    category: "Code",
    status: "available",
    blurb: "Repositories, Pipelines, and pull requests - via a read-only App password.",
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
  // ── CI/CD (the code↔infra keystone, docs/07c) ──
  {
    id: "jenkins",
    name: "Jenkins",
    category: "CI/CD",
    status: "available",
    blurb: "Jobs, pipelines, and deployments - links what ships to the infra it runs on.",
    logo: "jenkins",
  },
  {
    id: "circleci",
    name: "CircleCI",
    category: "CI/CD",
    status: "coming-soon",
    blurb: "Pipelines and deploy jobs - the code→infra deploy link.",
    logo: "circleci",
  },
  {
    id: "argocd",
    name: "Argo CD",
    category: "CI/CD",
    status: "coming-soon",
    blurb: "GitOps app deployments to clusters - declarative, high-signal targets.",
    logo: "argocd",
  },
  // ── Observability ──
  {
    id: "datadog",
    name: "Datadog",
    category: "Observability",
    status: "coming-soon",
    blurb: "Monitors, dashboards, and the service map - richer runtime signal.",
    logo: "datadog",
  },
  {
    id: "grafana",
    name: "Grafana",
    category: "Observability",
    status: "coming-soon",
    blurb: "Dashboards, alerts, and metrics - health signal on the graph.",
    logo: "grafana",
  },
  // ── Alerts (outbound channels — where Atlas sends findings/incidents) ──
  {
    id: "slack",
    name: "Slack",
    category: "Alerts",
    status: "coming-soon",
    blurb: "Send findings and incident alerts to a channel.",
    logo: "slack-icon",
  },
  {
    id: "discord",
    name: "Discord",
    category: "Alerts",
    status: "coming-soon",
    blurb: "Post findings and incident alerts to a server.",
    logo: "discord-icon",
  },
  {
    id: "msteams",
    name: "Microsoft Teams",
    category: "Alerts",
    status: "coming-soon",
    blurb: "Route findings and incident alerts to a Teams channel.",
    logo: "microsoft-teams",
  },
];
