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
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PostureRadar, type Posture } from "@/components/dashboard/posture-radar";
import { cn } from "@/lib/cn";
import { Onboarding } from "@/components/onboarding";
import { AskLauncher } from "@/components/dashboard/ask-launcher";
import { RefreshLatest } from "@/components/dashboard/refresh-latest";
import { SeverityBadge } from "@/components/tags";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO } from "@/lib/kind-visual";
import { severityMeta, PROVIDER_META } from "@/lib/taxonomy";
import { apiGet, type ApiOk } from "@/lib/api";

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
  const res = await apiGet<ApiOk<Summary>>("/summary", { token, orgId });
  const s = res.body?.data;

  // Empty graph → the onboarding first-run experience.
  if (!s || s.inventory.resources === 0) {
    return <Onboarding orgId={orgId} canSeed={role === "Owner" || role === "Admin"} />;
  }

  const { inventory: inv, trust } = s;
  const canManage = role === "Owner" || role === "Admin";
  const health = estateHealth(s);
  const firstName = name?.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Hero band — a greeting with personality + the estate pulse, the way in. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <TrustPulse trust={trust} inv={inv} />
        </div>
        {canManage ? <RefreshLatest orgId={orgId} /> : null}
      </div>

      {/* Hero grid — one focal point (health, in Atlas green) + posture + sources. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HealthCard health={health} />
        <FindingsCard findings={s.findings} />
        <SourcesCard trust={trust} inv={inv} />
      </div>

      <PostureCard posture={s.insights.posture} />

      <AskLauncher />

      {/* At a glance - human inventory. Infrastructure and Code rows each show only when
          that side of the estate is connected, so a code-only or infra-only org isn't all zeros. */}
      {inv.services + inv.datastores + inv.clouds > 0 && (
        <StatGroup label="Infrastructure">
          <Stat icon={Boxes} label="Services" value={inv.services} />
          <Stat icon={Database} label="Datastores" value={inv.datastores} />
          <Stat
            icon={Cloud}
            label="Clouds"
            value={inv.clouds}
            sub={
              inv.accounts > 0 ? `${inv.accounts} account${inv.accounts > 1 ? "s" : ""}` : undefined
            }
          />
        </StatGroup>
      )}
      {inv.repositories > 0 && (
        <StatGroup label="Code">
          <Stat icon={GitBranch} label="Repositories" value={inv.repositories} />
          <Stat icon={FolderGit2} label="Projects" value={inv.projects} />
          <Stat
            icon={Play}
            label="Pipelines"
            value={inv.pipelines}
            sub={
              inv.pullRequests > 0
                ? `${inv.pullRequests} open PR${inv.pullRequests > 1 ? "s" : ""}`
                : undefined
            }
          />
          <Stat icon={Users} label="Contributors" value={inv.contributors} />
        </StatGroup>
      )}

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
      {trust.lastSyncAt ? (
        <>
          <span aria-hidden>·</span>
          <span>synced {timeAgo(trust.lastSyncAt)}</span>
        </>
      ) : null}
    </p>
  );
}

/** Posture by area — a compact square radar widget (where the estate is weak, by pillar). */
function PostureCard({ posture }: { posture: Posture }) {
  return (
    <Card className="w-full shadow-sm sm:max-w-sm">
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Posture by area
        </p>
        <div className="mt-1">
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
      <CardContent className="flex items-center gap-5 p-5">
        <HealthRing score={health.score} className={tone} />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Estate health
          </p>
          <p className={cn("mt-1 text-2xl font-semibold leading-none", tone)}>{health.label}</p>
          <p className="mt-2 max-w-[16rem] text-xs text-muted-foreground">
            A roll-up of open findings (by severity) and source health. Open Insights to act.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** SVG progress ring for the health score. `className` sets the ring color (currentColor). */
function HealthRing({ score, className }: { score: number; className?: string }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className={cn("relative grid size-[84px] shrink-0 place-items-center", className)}>
      <svg viewBox="0 0 84 84" className="size-[84px] -rotate-90">
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          opacity="0.2"
        />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <span className="absolute text-xl font-semibold tabular-nums text-foreground">{score}</span>
    </div>
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
          <h2 className="text-base font-semibold">Needs attention</h2>
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
        <h2 className="mb-3 text-base font-semibold">Recent activity</h2>
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
      <h2 className="text-base font-semibold">Insights</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Pull requests raised in the last 30 days (open or merged).
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Leaderboard
          title="Top contributors"
          subtitle="PRs raised · 30d"
          items={topContributors}
          href={userHref}
          logo={logo}
          emptyLabel="No PRs in the last 30 days yet."
        />
        <Leaderboard
          title="Most active repos"
          subtitle="PRs · 30d"
          items={mostActiveRepos}
          href={repoHref}
          logo={logo}
          emptyLabel="No PRs in the last 30 days yet."
        />
        <Card>
          <CardContent className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pipeline coverage
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {pipelineCoverage.withPipeline}/{pipelineCoverage.total} repos
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
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
 * A "tick meter" — a row of thin bars, filled to the value. A calmer, more data-instrument look
 * than a solid progress bar (the pattern the user flagged). Filled ticks use the foreground so it
 * stays mono; coverage isn't a status signal, so no hue. Purely decorative → aria-hidden.
 */
function TickMeter({ pct, ticks = 30 }: { pct: number; ticks?: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * ticks);
  return (
    <div className="flex h-7 items-stretch gap-[2px]" aria-hidden>
      {Array.from({ length: ticks }).map((_, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-full", i < filled ? "bg-foreground" : "bg-muted")}
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
  logo = null,
  emptyLabel = "None yet.",
}: {
  title: string;
  subtitle: string;
  items: Array<{ name: string; count: number }>;
  href: string;
  logo?: string | null;
  emptyLabel?: string;
}) {
  const max = items[0]?.count ?? 1;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {logo ? <CloudIcon name={logo} className="size-3.5" /> : null}
            {title}
          </div>
          <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
            {subtitle}
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.name} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate">{it.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/60"
                    style={{ width: `${Math.max(8, Math.round((it.count / max) * 100))}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
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

function StatGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  sub?: string | undefined;
}) {
  return (
    <Card className="shadow-sm transition-colors hover:border-foreground/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-1.5 text-2xl font-semibold tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
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
