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
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PostureRadar, type Posture } from "@/components/dashboard/posture-radar";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/cn";
import { Onboarding } from "@/components/onboarding";
import { AskLauncher } from "@/components/dashboard/ask-launcher";
import { RefreshLatest } from "@/components/dashboard/refresh-latest";
import { SeverityBadge } from "@/components/tags";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO } from "@/lib/kind-visual";
import { severityMeta, PROVIDER_META } from "@/lib/taxonomy";
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
    apiGet<ApiOk<Array<{ provider: string }>>>("/connections", { token, orgId }),
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

  // Logos of the connected sources feeding each card (shown top-right of Infrastructure / Code).
  const providers = (connRes.body?.data ?? []).map((c) => c.provider);
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
        <FindingsCard findings={s.findings} />
        <SourcesCard trust={trust} inv={inv} />
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsAttention findings={s.findings} />
        </div>
        <RecentActivity activity={s.activity} />
      </div>

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

/** Radial gauge for the health score — a half-donut filled to the score, with the number and its
 *  tier label ("At risk" / "Fair" / …) in the opening. Tone (currentColor) sets the arc + label. */
function HealthGauge({ score, label, tone }: { score: number; label: string; tone: string }) {
  const cx = 100;
  const cy = 100;
  const r = 80;
  const pt = (frac: number) => {
    const a = Math.PI * (1 - Math.max(0, Math.min(1, frac)));
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const end = pt(score / 100);
  return (
    <svg viewBox="0 0 200 124" className={cn("w-full max-w-[240px]", tone)} role="img">
      <path
        d="M 20 100 A 80 80 0 0 1 180 100"
        fill="none"
        className="stroke-muted"
        strokeWidth={16}
        strokeLinecap="round"
      />
      <path
        d={`M 20 100 A 80 80 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
      />
      <text
        x="100"
        y="90"
        textAnchor="middle"
        className="fill-foreground font-semibold tabular-nums"
        style={{ fontSize: 38 }}
      >
        {score}
      </text>
      <text
        x="100"
        y="115"
        textAnchor="middle"
        fill="currentColor"
        className="font-medium"
        style={{ fontSize: 15 }}
      >
        {label}
      </text>
    </svg>
  );
}

/** Open findings, as a scannable severity bar + counts. The bridge into Insights. */
function FindingsCard({ findings }: { findings: Finding[] }) {
  const sev = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity === "high" || f.severity === "medium" || f.severity === "low") {
      sev[f.severity] += 1;
    }
  }
  const total = findings.length;
  const seg = [
    { n: sev.high, color: "bg-red-500", label: "High" },
    { n: sev.medium, color: "bg-amber-500", label: "Medium" },
    { n: sev.low, color: "bg-blue-500", label: "Low" },
  ];
  return (
    <Card className="shadow-sm">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Open findings
          </p>
          <Link
            href="/insights"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Insights <ChevronRight className="size-3.5" />
          </Link>
        </div>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{total}</p>
        {total > 0 ? (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
              {seg.map((x) =>
                x.n > 0 ? (
                  <div
                    key={x.label}
                    className={x.color}
                    style={{ width: `${(x.n / total) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {seg.map((x) => (
                <span key={x.label} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", x.color)} />
                  <span className="tabular-nums">{x.n}</span>
                  <span className="text-muted-foreground">{x.label}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> Nothing needs attention.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Sources health pulse — how trustworthy the picture is, at a glance. */
function SourcesCard({ trust, inv }: { trust: Summary["trust"]; inv: Summary["inventory"] }) {
  const ratio = trust.sources > 0 ? trust.healthySources / trust.sources : 0;
  const pct = Math.round(ratio * 100);
  const barColor = ratio >= 1 ? "bg-emerald-500" : ratio > 0 ? "bg-amber-500" : "bg-red-500";
  return (
    <Card className="shadow-sm">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sources
          </p>
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Manage <ChevronRight className="size-3.5" />
          </Link>
        </div>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {trust.healthySources}
          <span className="text-lg text-muted-foreground">/{trust.sources}</span>
        </p>
        <p className="text-xs text-muted-foreground">healthy connections</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-auto pt-3 text-xs text-muted-foreground">
          {inv.clouds > 0 ? `${inv.clouds} cloud${inv.clouds === 1 ? "" : "s"}` : "Code sources"}
          {trust.lastSyncAt ? ` · synced ${timeAgo(trust.lastSyncAt)}` : ""}
        </p>
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
            <ul className="space-y-2">
              {shown.map((f) => (
                <FindingRow key={f.id} f={f} />
              ))}
            </ul>
            <Link
              href="/insights"
              className="mt-3 block text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {findings.length > shown.length
                ? `+${findings.length - shown.length} more · see how to fix in Insights →`
                : "See how to fix these in Insights →"}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const accent = severityMeta(f.severity).accent;
  const body = (
    <div className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/40">
      <span
        className={`mt-0.5 h-full w-0.5 shrink-0 self-stretch rounded-full ${accent}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {f.category}
          </span>
        </div>
        <div className="mt-1.5 text-sm font-medium">{f.title}</div>
        <div className="text-sm text-muted-foreground">{f.detail}</div>
      </div>
      {f.href ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
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
        <Leaderboard
          title="Top contributors"
          subtitle="PRs raised · 30d"
          items={topContributors}
          href={userHref}
          avatars
          emptyLabel="No PRs in the last 30 days yet."
        />
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
        <span key={i} className={cn("flex-1 rounded-full", i < filled ? fill : "bg-muted")} />
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
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[#2684ff]"
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
                  {r.value.toLocaleString()}
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
                    {r.value.toLocaleString()}
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
