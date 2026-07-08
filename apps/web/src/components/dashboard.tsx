import Link from "next/link";
import {
  Boxes,
  Database,
  Cloud,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  FolderGit2,
  Play,
  Users,
  Map as MapIcon,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
  Activity,
  ShieldCheck,
  ShieldAlert,
  HeartPulse,
  PlugZap,
  Waypoints,
  Clock,
  Sparkles,
  Package,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PostureRadar, type Posture } from "@/components/dashboard/posture-radar";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/cn";
import { Onboarding } from "@/components/onboarding";
import { AskLauncher } from "@/components/dashboard/ask-launcher";
import { RefreshLatest } from "@/components/dashboard/refresh-latest";
import { ContributorsDonut } from "@/components/dashboard/contributors-donut";
import { FindingsDonut } from "@/components/dashboard/findings-donut";
import { CountUp } from "@/components/dashboard/count-up";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO } from "@/lib/kind-visual";
import { PROVIDER_META } from "@/lib/taxonomy";
import { apiGet, type ApiOk } from "@/lib/api";

/** Connection provider → brand-logo key, split by the card each feeds. */
const CLOUD_LOGO: Record<string, string> = {
  aws: "aws",
  azure: "microsoft-azure",
  gcp: "google-cloud",
};
const CODE_LOGO: Record<string, string> = {
  github: "github-icon",
  bitbucket: "bitbucket",
  gitlab: "gitlab",
};
/** Any connectable provider → brand-logo key (for the Sources list). */
const PROVIDER_LOGO: Record<string, string> = {
  ...CLOUD_LOGO,
  ...CODE_LOGO,
  datadog: "datadog",
  jenkins: "jenkins",
  grafana: "grafana",
  circleci: "circleci",
  argocd: "argocd",
};
interface ConnectionLite {
  provider: string;
  displayName: string;
  status: string;
  demo: boolean;
}

interface Finding {
  id: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
}
interface ActivityItem {
  id: string | null;
  kind: string;
  category: "pull_request" | "repository" | "pipeline" | "resource";
  title: string;
  subtitle: string | null;
  at: string;
}
interface Summary {
  inventory: {
    resources: number;
    relationships: number;
    services: number;
    datastores: number;
    environments: number;
    clouds: number;
    accounts: number;
    repositories: number;
    projects: number;
    pipelines: number;
    contributors: number;
    pullRequests: number;
  };
  trust: { sources: number; healthySources: number; lastSyncAt: string | null };
  crossBoundary: { crossCloud: number; crossAccount: number };
  findings: Finding[];
  activity: ActivityItem[];
  insights: {
    topContributors: Array<{ name: string; count: number }>;
    mostActiveRepos: Array<{ name: string; count: number }>;
    pipelineCoverage: { withPipeline: number; total: number };
    posture: Posture;
    codeProvider: string | null;
  };
}

/** Consumer dashboard (docs/09 §5.2) - answers a user's real questions: what do I have, is it
 *  trustworthy, what needs attention, what changed. Graph-derived + cited, not graph internals. */
export async function Dashboard({
  orgId,
  token,
  role,
  name,
}: {
  orgId: string;
  token: string;
  role: string;
  name?: string | null;
}) {
  const [summaryRes, connRes] = await Promise.all([
    apiGet<ApiOk<Summary>>("/summary", { token, orgId }),
    apiGet<ApiOk<ConnectionLite[]>>("/connections", { token, orgId }),
  ]);
  const s = summaryRes.body?.data;

  // Empty graph → the onboarding first-run experience.
  if (!s || s.inventory.resources === 0) {
    return <Onboarding orgId={orgId} canSeed={role === "Owner" || role === "Admin"} />;
  }

  const { inventory: inv, trust } = s;
  const canManage = role === "Owner" || role === "Admin";
  const health = estateHealth(s);
  const firstName = name?.trim().split(/\s+/)[0] ?? null;
  const hasInfra = inv.services + inv.datastores + inv.clouds > 0;
  const hasCode = inv.repositories > 0;
  const inventoryCols = 1 + (hasInfra ? 1 : 0) + (hasCode ? 1 : 0);

  // Real (non-demo) connections drive both the connected-source logos and the Sources card.
  const connections = (connRes.body?.data ?? []).filter((c) => !c.demo);
  const providers = connections.map((c) => c.provider);
  const isStr = (x: string | undefined): x is string => Boolean(x);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const cloudLogos = uniq(providers.map((p) => CLOUD_LOGO[p]).filter(isStr));
  const codeLogos = uniq(providers.map((p) => CODE_LOGO[p]).filter(isStr));

  return (
    <div className="space-y-6">
      {/* Hero band — a greeting with personality + the estate pulse, the way in. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <TrustPulse trust={trust} inv={inv} />
        </div>
        <div className="flex items-center gap-2.5">
          {trust.lastSyncAt ? (
            <span className="text-xs text-muted-foreground">
              synced {timeAgo(trust.lastSyncAt)}
            </span>
          ) : null}
          {canManage ? <RefreshLatest orgId={orgId} /> : null}
        </div>
      </div>

      {/* Hero grid — one focal point (health, in Atlas green) + posture + sources. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HealthCard health={health} />
        <FindingsDonut findings={s.findings} />
        <SourcesCard
          connections={connections}
          syncedLabel={trust.lastSyncAt ? timeAgo(trust.lastSyncAt) : null}
        />
      </div>

      {/* What needs action sits high — right under the pulse — paired with what just changed.
          gap-4 matches the KPI row above so the columns line up. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsAttention findings={s.findings} />
        </div>
        <RecentActivity activity={s.activity} />
      </div>

      <AskLauncher />

      {/* Three equal cards: the posture radar, then Infrastructure and Code, each listing their
          counts as rows. Infra/Code only appear when that side is connected. */}
      <div className={cn("grid gap-4", inventoryCols >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {hasInfra ? (
          <InventoryCard
            title="Infrastructure"
            columns={1}
            icons={cloudLogos}
            rows={[
              { icon: Boxes, label: "Services", value: inv.services },
              { icon: Database, label: "Datastores", value: inv.datastores },
              {
                icon: Cloud,
                label: "Clouds",
                value: inv.clouds,
                sub:
                  inv.accounts > 0
                    ? `${inv.accounts} account${inv.accounts > 1 ? "s" : ""}`
                    : undefined,
              },
            ]}
          />
        ) : null}
        {hasCode ? (
          <InventoryCard
            title="Code"
            columns={2}
            icons={codeLogos}
            rows={[
              { icon: GitBranch, label: "Repositories", value: inv.repositories },
              { icon: FolderGit2, label: "Projects", value: inv.projects },
              {
                icon: Play,
                label: "Pipelines",
                value: inv.pipelines,
                sub:
                  inv.pullRequests > 0
                    ? `${inv.pullRequests} open PR${inv.pullRequests > 1 ? "s" : ""}`
                    : undefined,
              },
              { icon: Users, label: "Contributors", value: inv.contributors },
            ]}
          />
        ) : null}
        <PostureCard posture={s.insights.posture} />
      </div>

      <Insights insights={s.insights} />

      <MapPreview inv={inv} cross={s.crossBoundary} />
    </div>
  );
}

/** Time-of-day greeting (server-rendered). Kept simple; personality without gimmicks. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Estate health — a single 0-100 posture summary derived from REAL signals (open findings,
 * weighted by severity, + source health). It's a heuristic roll-up, not a fabricated metric:
 * the number always traces back to findings you can open and sources you can see.
 */
function estateHealth(s: Summary): { score: number; label: string } {
  const sev = { high: 0, medium: 0, low: 0 };
  for (const f of s.findings) {
    if (f.severity === "high" || f.severity === "medium" || f.severity === "low") {
      sev[f.severity] += 1;
    }
  }
  let score = 100 - (sev.high * 9 + sev.medium * 4 + sev.low * 1);
  if (s.trust.sources > 0) {
    score -= Math.round((1 - s.trust.healthySources / s.trust.sources) * 20);
  }
  score = Math.max(0, Math.min(100, score));
  const label =
    score >= 85 ? "Strong" : score >= 65 ? "Fair" : score >= 40 ? "Needs work" : "At risk";
  return { score, label };
}

function TrustPulse({ trust, inv }: { trust: Summary["trust"]; inv: Summary["inventory"] }) {
  const allHealthy = trust.sources > 0 && trust.healthySources === trust.sources;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        {inv.resources.toLocaleString()} resources · {inv.relationships.toLocaleString()}{" "}
        relationships
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${allHealthy ? "bg-emerald-500" : "bg-amber-500"}`}
          aria-hidden
        />
        {trust.healthySources}/{trust.sources} sources healthy
      </span>
    </p>
  );
}

/** Posture by area — a compact square radar widget (where the estate is weak, by pillar). */
function PostureCard({ posture }: { posture: Posture }) {
  return (
    <Card className="w-full shadow-sm">
      <CardContent className="flex h-full flex-col p-4">
        <p className="text-sm font-medium text-muted-foreground">Posture by area</p>
        <div className="flex flex-1 items-center justify-center py-1">
          <PostureRadar posture={posture} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Estate health — a plain card with a score ring tinted by the health tier (red→amber→green). */
function HealthCard({ health }: { health: { score: number; label: string } }) {
  const tone =
    health.score >= 85
      ? "text-emerald-500"
      : health.score >= 65
        ? "text-foreground"
        : health.score >= 40
          ? "text-amber-500"
          : "text-red-500";
  return (
    <Card className="shadow-sm">
      <CardContent className="flex h-full flex-col p-5">
        <p className="text-sm font-medium text-muted-foreground">Estate health</p>
        <div className="flex flex-1 items-center justify-center">
          <HealthGauge score={health.score} label={health.label} tone={tone} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Radial tick gauge for the health score — a semicircle of dashes filled to the score (tone),
 *  with the number and its tier label ("At risk" / "Fair" / …) centred inside the arc. */
function HealthGauge({ score, label, tone }: { score: number; label: string; tone: string }) {
  const cx = 100;
  const cy = 100;
  const rIn = 62;
  const rOut = 82;
  const N = 36;
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * N);
  const ticks = Array.from({ length: N }, (_, i) => {
    const a = Math.PI * (1 - i / (N - 1));
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
      x1: (cx + rIn * cos).toFixed(1),
      y1: (cy - rIn * sin).toFixed(1),
      x2: (cx + rOut * cos).toFixed(1),
      y2: (cy - rOut * sin).toFixed(1),
      on: i < filled,
    };
  });
  return (
    <svg viewBox="0 0 200 112" className={cn("w-full max-w-[240px]", tone)} role="img">
      {ticks.map((t, i) => {
        // Speedometer gradient: each filled tick is coloured by its position (red → amber → green),
        // so the arc reads red at a low score and greens up as it climbs. Unfilled ticks are muted.
        const v = (i / (N - 1)) * 100;
        const cls = !t.on
          ? "stroke-muted"
          : v >= 66
            ? "stroke-emerald-500"
            : v >= 40
              ? "stroke-amber-500"
              : "stroke-red-500";
        return (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            strokeWidth={4}
            strokeLinecap="round"
            className={cn(cls, "chart-tick")}
            style={{ animationDelay: `${i * 18}ms` }}
          />
        );
      })}
      <text
        x="100"
        y="82"
        textAnchor="middle"
        className="fill-foreground font-semibold tabular-nums"
        style={{ fontSize: 34 }}
      >
        {score}
      </text>
      <text
        x="100"
        y="102"
        textAnchor="middle"
        fill="currentColor"
        className="font-medium"
        style={{ fontSize: 12 }}
      >
        {label}
      </text>
    </svg>
  );
}

/** Connected sources — a compact list: brand logo, name, and a health dot. */
function SourcesCard({
  connections,
  syncedLabel,
}: {
  connections: ConnectionLite[];
  syncedLabel: string | null;
}) {
  const dot = (status: string) =>
    status === "connected"
      ? "bg-emerald-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-red-500";
  const label = (status: string) =>
    status === "connected" ? "Healthy" : status === "degraded" ? "Degraded" : "Error";
  // Keep the card compact: show a handful (unhealthy first, so problems surface) and roll the
  // rest into a "+N more" link — no unbounded growth / scroll.
  const rank = (s: string) => (s === "connected" ? 2 : s === "degraded" ? 1 : 0);
  const sorted = [...connections].sort((a, b) => rank(a.status) - rank(b.status));
  const MAX = 4;
  const shown = sorted.slice(0, MAX);
  const more = connections.length - shown.length;
  return (
    <Card className="shadow-sm">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-muted-foreground">Sources</p>
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Manage <ChevronRight className="size-3.5" />
          </Link>
        </div>
        {connections.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No sources connected yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {shown.map((c) => {
              const logo = PROVIDER_LOGO[c.provider];
              return (
                <li key={c.displayName} className="flex items-center gap-2.5 py-2.5 text-sm">
                  {/* White chip keeps dark brand marks (AWS) legible in dark mode. */}
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white ring-1 ring-black/5">
                    {logo ? <CloudIcon name={logo} className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.displayName}</span>
                  <span
                    className={cn("size-2 shrink-0 rounded-full", dot(c.status))}
                    title={label(c.status)}
                  />
                </li>
              );
            })}
            {more > 0 ? (
              <li className="py-2">
                <Link
                  href="/integrations"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  +{more} more source{more === 1 ? "" : "s"}
                </Link>
              </li>
            ) : null}
          </ul>
        )}
        {syncedLabel ? (
          <p className="mt-auto pt-3 text-xs text-muted-foreground">Synced {syncedLabel}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NeedsAttention({ findings }: { findings: Finding[] }) {
  // The dashboard only teases the top findings; the full advisory treatment (why/how‑to‑fix,
  // Ask Atlas) lives in Insights.
  const shown = findings.slice(0, 3);
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <TriangleAlert className="size-4 text-muted-foreground" />
            Needs attention
          </h2>
          {findings.length > 0 ? (
            <Link
              href="/insights"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View in Insights <ChevronRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
        {findings.length === 0 ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-6 text-sm">
            <CheckCircle2 className="size-5 text-success" />
            <div>
              <div className="font-medium">Nothing needs attention</div>
              <div className="text-muted-foreground">
                Your graph looks healthy - no risks, drift, or unhealthy sources right now.
              </div>
            </div>
          </div>
        ) : (
          <>
            <ul className="-mx-2 divide-y divide-border">
              {shown.map((f) => (
                <FindingRow key={f.id} f={f} />
              ))}
            </ul>
            {findings.length > shown.length ? (
              <Link
                href="/insights"
                className="mt-2 flex items-center justify-center gap-1 rounded-lg py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                Show more <ChevronRight className="size-3.5" />
              </Link>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Presentation for each finding category — a tasteful tinted chip (10% bg + inset ring), mirroring
// the Insights "Category" column so the two surfaces read the same. Not identical, just consistent.
const CATEGORY_META: Record<string, { icon: LucideIcon; badge: string }> = {
  "Security posture": {
    icon: ShieldCheck,
    badge: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  },
  Vulnerabilities: {
    icon: ShieldAlert,
    badge: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  },
  "Service health": {
    icon: HeartPulse,
    badge: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  },
  "Source health": {
    icon: PlugZap,
    badge: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
  },
  "Cross-boundary": {
    icon: Waypoints,
    badge: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
  },
  "Blast radius": {
    icon: Waypoints,
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  },
  Freshness: {
    icon: Clock,
    badge: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  },
  "Code hygiene": {
    icon: Sparkles,
    badge: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
  },
  "Dependency sprawl": {
    icon: Package,
    badge: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
  },
};
const GENERAL_CATEGORY = {
  icon: TriangleAlert,
  badge: "bg-muted text-muted-foreground ring-border",
};
const categoryMeta = (c: string) => CATEGORY_META[c] ?? GENERAL_CATEGORY;

const SEV_DOT: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-inferred-low",
};
const SEV_TEXT: Record<string, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-inferred-low",
};

function FindingRow({ f }: { f: Finding }) {
  const cat = categoryMeta(f.category);
  const body = (
    <div className="group flex items-start gap-3 px-2 py-3 transition-colors hover:bg-muted/50">
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          SEV_DOT[f.severity] ?? "bg-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground group-hover:underline">{f.title}</div>
        <div className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{f.detail}</div>
      </div>
      {/* Severity + category + scope sit on the right, aligned as a compact meta stack. */}
      <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
            cat.badge,
          )}
        >
          <cat.icon className="size-3" /> {f.category}
        </span>
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            SEV_TEXT[f.severity] ?? "text-muted-foreground",
          )}
        >
          {f.severity}
          {f.count && f.count > 1 ? (
            <span className="ml-1.5 font-normal normal-case tabular-nums text-muted-foreground">
              · {f.count} affected
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
  return <li>{f.href ? <Link href={f.href}>{body}</Link> : body}</li>;
}

function RecentActivity({ activity }: { activity: ActivityItem[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Activity className="size-4 text-muted-foreground" />
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent changes.</p>
        ) : (
          <ul className="space-y-3">
            {activity.map((a, i) => (
              <ActivityRow key={i} a={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ACTIVITY_META = {
  pull_request: { Icon: GitPullRequest, label: "Pull request" },
  repository: { Icon: FolderGit2, label: "New repository" },
  pipeline: { Icon: Play, label: "New pipeline" },
  resource: { Icon: Boxes, label: "New resource" },
} as const;

/** The provider/service brand logo for an activity item - a service logo (e.g. an AWS service)
 *  if one is known, else the provider brand (Bitbucket, GitHub, AWS…); null when there's no
 *  brand icon and we fall back to the category glyph. Mirrors the Explore row logic. */
function activityLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

function ActivityRow({ a }: { a: ActivityItem }) {
  const { Icon, label } = ACTIVITY_META[a.category];
  const logo = activityLogo(a.kind);
  const href = a.id ? `/explore/${a.id}` : null;

  const inner = (
    <div className="flex items-start gap-2.5 text-sm">
      {logo ? (
        <CloudIcon name={logo} className="mt-0.5 size-4 shrink-0" />
      ) : (
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div>
          <span className="text-muted-foreground">{label}: </span>
          <span className="font-medium">{a.title}</span>
        </div>
        {a.subtitle ? <div className="text-xs text-muted-foreground">{a.subtitle}</div> : null}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span>
    </div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block hover:opacity-80">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

function MapPreview({
  inv,
  cross,
}: {
  inv: Summary["inventory"];
  cross: Summary["crossBoundary"];
}) {
  const crossTotal = cross.crossCloud + cross.crossAccount;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/40">
            <MapIcon className="size-5" />
          </div>
          <div>
            <div className="text-sm font-medium">Your infrastructure map</div>
            <div className="text-sm text-muted-foreground">
              {inv.resources} resources across {inv.clouds} cloud{inv.clouds === 1 ? "" : "s"}
              {crossTotal > 0
                ? ` · ${crossTotal} cross-boundary connection${crossTotal > 1 ? "s" : ""}`
                : ""}
            </div>
          </div>
        </div>
        <Link
          href="/map"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:border-foreground/40"
        >
          Open map <ArrowRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

function Insights({ insights }: { insights: Summary["insights"] }) {
  const { topContributors, mostActiveRepos, pipelineCoverage, codeProvider } = insights;
  if (pipelineCoverage.total === 0) return null;
  const pct =
    pipelineCoverage.total > 0
      ? Math.round((pipelineCoverage.withPipeline / pipelineCoverage.total) * 100)
      : 0;

  // Brand the PR leaderboards by the connected code host (Bitbucket today, GitHub/GitLab later) -
  // the data literally comes from there, so the icon comes with it dynamically.
  const brandLogo = codeProvider ? PROVIDER_META[codeProvider]?.logo : undefined;
  const logo = brandLogo && hasCloudIcon(brandLogo) ? brandLogo : null;
  const userHref = codeProvider ? `/explore?kind=${codeProvider}.user` : "/explore";
  const repoHref = codeProvider ? `/explore?kind=${codeProvider}.repository` : "/explore";

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          {logo ? <CloudIcon name={logo} className="size-4" /> : null}
          <h2 className="text-base font-semibold">Insights</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Delivery activity over the last 30 days — who&apos;s shipping, what&apos;s active, and
          CI/CD coverage.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ContributorsDonut items={topContributors} subtitle="PRs raised · 30d" href={userHref} />
        <Leaderboard
          title="Most active repos"
          subtitle="PRs · 30d"
          items={mostActiveRepos}
          href={repoHref}
          emptyLabel="No PRs in the last 30 days yet."
        />
        <Card>
          <CardContent className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium">Pipeline coverage</div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {pipelineCoverage.withPipeline}/{pipelineCoverage.total} repos
              </span>
            </div>
            <div className="mt-5 flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              {pct}%
              {pct >= 80 ? (
                <TrendingUp className="size-4 text-success" />
              ) : pct < 50 ? (
                <TrendingDown className="size-4 text-red-500" />
              ) : null}
            </div>
            <div className="mt-3">
              <TickMeter pct={pct} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">repos with a CI/CD pipeline</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * A "tick meter" — a row of thin bars, filled to the value (a calmer, data-instrument look than a
 * solid progress bar). Filled ticks are colored by coverage level (green good → amber → red).
 */
function TickMeter({ pct, ticks = 30 }: { pct: number; ticks?: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * ticks);
  const fill = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex h-7 items-stretch gap-[2px]" aria-hidden>
      {Array.from({ length: ticks }).map((_, i) => (
        <span
          key={i}
          className={cn("chart-tick flex-1 rounded-full", i < filled ? fill : "bg-muted")}
          style={{ animationDelay: `${i * 16}ms` }}
        />
      ))}
    </div>
  );
}

function Leaderboard({
  title,
  subtitle,
  items,
  href,
  avatars = false,
  emptyLabel = "None yet.",
}: {
  title: string;
  subtitle: string;
  items: Array<{ name: string; count: number }>;
  href: string;
  avatars?: boolean;
  emptyLabel?: string;
}) {
  const max = items[0]?.count ?? 1;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-sm font-medium">{title}</div>
          <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
            {subtitle}
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.name} className="flex items-center gap-3 text-sm">
                {avatars ? (
                  <UserAvatar name={it.name} email={it.name} size={24} className="shrink-0" />
                ) : null}
                <span className="w-28 shrink-0 truncate" title={it.name}>
                  {it.name}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm bg-[#2684ff]"
                    style={{ width: `${Math.max(6, Math.round((it.count / max) * 100))}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-semibold tabular-nums">
                  {it.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface InventoryRow {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string | undefined;
}

/** One inventory card (Infrastructure / Code): a titled card whose counts are a grid of mini
 *  tiles — Infrastructure as 3-in-a-row, Code as a 2×2 — that fill the card. */
function InventoryCard({
  title,
  rows,
  columns,
  icons = [],
}: {
  title: string;
  rows: InventoryRow[];
  columns: 1 | 2 | 3;
  /** Logo keys of the connected sources feeding this card (shown top-right). */
  icons?: string[];
}) {
  const single = columns === 1;
  const gridCls = columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <Card className="flex h-full flex-col shadow-sm">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {icons.length ? (
            <div className="flex items-center gap-1.5">
              {icons.map((l) => (
                // White chip so brand marks (e.g. AWS's dark wordmark) stay legible in dark mode.
                <span
                  key={l}
                  className="grid size-6 place-items-center rounded-md bg-white ring-1 ring-black/5"
                >
                  <CloudIcon name={l} className="size-4" />
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className={cn("mt-3 grid flex-1 gap-3", gridCls)}>
          {rows.map((r) =>
            single ? (
              // Full-width row tile: icon + label on the left, big value on the right.
              <div
                key={r.label}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-4"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <r.icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.label}</div>
                    {r.sub ? <div className="text-xs text-muted-foreground">{r.sub}</div> : null}
                  </div>
                </div>
                <div className="shrink-0 text-2xl font-semibold tabular-nums">
                  <CountUp value={r.value} />
                </div>
              </div>
            ) : (
              // Compact grid tile: label on top, value below.
              <div
                key={r.label}
                className="flex flex-col justify-between gap-3 rounded-lg bg-muted/50 p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <r.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{r.label}</span>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    <CountUp value={r.value} />
                  </div>
                  {r.sub ? <div className="text-[11px] text-muted-foreground">{r.sub}</div> : null}
                </div>
              </div>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
