import Link from "next/link";
import {
  ArrowRight,
  Clock,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  Waypoints,
  Wrench,
} from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { kindIcon, kindShort, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { ENV_STYLE, PROVIDER_META, severityMeta } from "@/lib/taxonomy";
import { AtlasAiMark } from "@/components/brand";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { ErrorState } from "@/components/patterns/empty-state";
import { FindingActions } from "@/components/insights/finding-actions";
import { pillarMeta } from "@/components/insights/pillars";
import { type Finding, type Mute } from "@/components/insights/insights-view";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

/** One affected resource (evidence node enriched by the API with env + runtime health). */
interface Affected {
  id: string;
  label: string;
  kind: string;
  environment: string;
  health: { state: "healthy" | "degraded" | "unhealthy"; reason?: string } | null;
}
/** Blast-radius aggregate — what depends on the affected resources. */
interface Impact {
  downstream: number;
  sample: Array<{ id: string; label: string; kind: string }>;
  truncated: boolean;
}
interface FindingDetailData {
  finding: Finding | null;
  affected?: Affected[];
  impact?: Impact | null;
  lastSyncedAt?: string | null;
  mute?: Mute | null;
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). Server-safe (pure). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A real brand/service logo for a node kind, or null (→ fall back to a lucide kind icon). */
function nodeLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/** Split guidance.fix into steps when it reads as several sentences; else keep it as one block. */
function fixSteps(fix: string): string[] {
  const parts = fix
    .split(/(?<=\.)\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  return parts.length >= 2 ? parts : [fix.trim()];
}

/** Small square node glyph (real logo when we have one, else a tinted kind icon) — the same
 *  language the map / node detail / citations use, so a resource always reads the same way. */
function NodeGlyph({ kind, size = "md" }: { kind: string; size?: "sm" | "md" }) {
  const logo = nodeLogo(kind);
  const KindIcon = kindIcon(kind);
  const box = size === "sm" ? "size-6" : "size-8";
  const icon = size === "sm" ? "size-3.5" : "size-[18px]";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        box,
        logo ? "bg-muted/60" : kindStyle(kind),
      )}
    >
      {logo ? (
        <CloudIcon name={logo} className={size === "sm" ? "size-4" : "size-5"} />
      ) : (
        <KindIcon className={icon} />
      )}
    </span>
  );
}

/**
 * Finding detail (the row → detail drill-in) — answer → prove → act. Findings are derived live, so
 * we resolve the id against the current graph; if it's gone, it resolved on its own since you last
 * looked. Leads with a severity-accented hero + the primary actions, makes generic guidance THEIRS
 * with a blast-radius impact band, then the affected resources (prod / unhealthy first), the full
 * why/fix, a lifecycle timeline, and honest provenance.
 */
export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shell = await requireShell();
  const res = await apiGet<ApiOk<FindingDetailData>>(`/insights/${id}`, {
    token: shell.token,
    orgId: shell.orgId,
  });
  const data = res.body?.data;
  const finding = data?.finding ?? null;
  const mute = data?.mute ?? null;
  const affected = data?.affected ?? [];
  const impact = data?.impact ?? null;
  const lastSyncedAt = data?.lastSyncedAt ?? null;

  if (!finding) {
    return (
      <div className="w-full space-y-6">
        <SetBreadcrumbs items={[{ label: "Insights", href: "/insights" }, { label: "Finding" }]} />
        <ErrorState
          title="This finding cleared"
          description="It's no longer flagged in your latest graph - either it was fixed and auto-resolved, or the resource went away. Nice."
          actions={
            <Link
              href="/insights"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              Back to Insights
            </Link>
          }
        />
      </div>
    );
  }

  const sev = severityMeta(finding.severity);
  const SevIcon = sev.icon;
  const pillar = pillarMeta(finding.guidance?.pillar);
  const firstSeen = finding.firstSeenAt ?? null;
  const ageDays = firstSeen
    ? Math.floor((Date.now() - new Date(firstSeen).getTime()) / 86_400_000)
    : null;
  // The hero one-liner: the finding's own human sentence when it isn't just a "; "-joined resource
  // list (that list is shown, richer, in the Affected section — don't repeat it here).
  const detailIsList = (finding.detail?.split(";").filter((s) => s.trim()).length ?? 0) > 1;
  const subtitle = finding.detail && !detailIsList ? finding.detail : null;

  const askHref = `/ask?q=${encodeURIComponent(`How do I fix "${finding.title}"? What's affected, why does it matter, and what are the exact steps?`)}`;

  return (
    <div className="w-full space-y-6">
      <SetBreadcrumbs
        items={[{ label: "Insights", href: "/insights" }, { label: finding.title }]}
      />

      {/* ── Hero: severity accent · what + how bad · the primary actions ─────────── */}
      <div className="flex gap-4 rounded-xl border border-border bg-card p-5">
        <span className={cn("w-1 shrink-0 self-stretch rounded-full", sev.accent)} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                sev.className,
              )}
            >
              <SevIcon className="size-3.5" /> {sev.label}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                pillar.badge,
              )}
            >
              <pillar.icon className="size-3.5" /> {pillar.label}
            </span>
            {finding.count && finding.count > 1 ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {finding.count} affected
              </span>
            ) : null}
            {finding.regressedAt ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                <RotateCcw className="size-3" /> Came back
              </span>
            ) : null}
            {mute ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Muted
              </span>
            ) : null}
          </div>

          <h1 className="text-2xl font-semibold leading-snug tracking-tight">{finding.title}</h1>
          {subtitle ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}

          {/* Freshness / lifecycle — a quiet strip. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {firstSeen ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" /> Detected {timeAgo(firstSeen)}
              </span>
            ) : null}
            {ageDays !== null && ageDays >= 1 ? <span>Open {ageDays}d</span> : null}
          </div>

          {/* Actions — up top, where a stuck reader reaches for them. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={askHref}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <AtlasAiMark size={15} className="size-4" /> Ask Atlas how to fix this
            </Link>
            <FindingActions orgId={shell.orgId} findingId={finding.id} muted={mute !== null} />
          </div>
        </div>
      </div>

      {/* ── Impact: makes the generic guidance THEIR risk ───────────────────────── */}
      {impact ? (
        <div className="rounded-lg border border-warning/30 bg-warning/[0.06] p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
            <Waypoints className="size-3.5" /> If left unfixed
          </p>
          <p className="mt-1.5 text-sm text-foreground/90">
            <span className="font-semibold">
              {impact.downstream} {impact.downstream === 1 ? "resource" : "resources"}
            </span>{" "}
            {impact.downstream === 1 ? "depends" : "depend"} on the affected{" "}
            {affected.length === 1 ? "resource" : "resources"} — so this reaches further than the{" "}
            {finding.count ?? affected.length} named below.
          </p>
          {impact.sample.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {impact.sample.map((n) => (
                <Link
                  key={n.id}
                  href={`/explore/${n.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground/90 transition-colors hover:border-foreground/40"
                  title={`${n.label} · ${kindShort(n.kind)}`}
                >
                  <NodeGlyph kind={n.kind} size="sm" />
                  <span className="max-w-[14rem] truncate font-mono text-[11px]">{n.label}</span>
                </Link>
              ))}
              {impact.truncated || impact.downstream > impact.sample.length ? (
                <span className="inline-flex items-center px-1 text-xs text-muted-foreground">
                  +{impact.downstream - impact.sample.length} more
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Why it matters · How to fix ─────────────────────────────────────────── */}
      {finding.guidance ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldAlert className="size-3.5" /> Why it matters
              </p>
              <p className="text-sm leading-relaxed text-foreground/90">{finding.guidance.why}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Wrench className="size-3.5" /> How to fix
              </p>
              {(() => {
                const steps = fixSteps(finding.guidance.fix);
                return steps.length > 1 ? (
                  <ol className="space-y-2">
                    {steps.map((s, i) => (
                      <li
                        key={i}
                        className="flex gap-2.5 text-sm leading-relaxed text-foreground/90"
                      >
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {finding.guidance.fix}
                  </p>
                );
              })()}
              <p className="text-[11px] text-muted-foreground/70">
                General guidance — ask Atlas above for the exact steps on your resources.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Affected resources: the proof, prioritised (prod / unhealthy first) ──── */}
      {affected.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ScanSearch className="size-3.5" /> Affected resources
              <span className="font-normal normal-case text-muted-foreground/70">
                · {affected.length}
              </span>
            </p>
            {finding.href ? (
              <Link
                href={finding.href}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Open in Explore <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {affected.map((n) => {
              const env = ENV_STYLE[n.environment];
              const unhealthy = n.health && n.health.state !== "healthy";
              return (
                <li key={n.id}>
                  <Link
                    href={`/explore/${n.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
                  >
                    <NodeGlyph kind={n.kind} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13px] text-foreground/90">{n.label}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {kindShort(n.kind)}
                      </p>
                    </div>
                    {n.environment && n.environment !== "unknown" && env ? (
                      <span
                        className={cn(
                          "hidden items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex",
                          env.chip,
                        )}
                      >
                        <span className={cn("size-1.5 rounded-full", env.dot)} />
                        {n.environment}
                      </span>
                    ) : null}
                    {unhealthy ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                          n.health?.state === "degraded"
                            ? "bg-warning/10 text-warning"
                            : "bg-danger/10 text-danger",
                        )}
                        title={n.health?.reason}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            n.health?.state === "degraded" ? "bg-warning" : "bg-danger",
                          )}
                        />
                        {n.health?.state}
                      </span>
                    ) : null}
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : finding.detail ? (
        // No structured evidence nodes — show the finding's own detail text as the proof.
        <div className="space-y-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ScanSearch className="size-3.5" /> Evidence
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
        </div>
      ) : null}

      {/* ── Lifecycle timeline ──────────────────────────────────────────────────── */}
      {firstSeen ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lifecycle
          </p>
          <div className="flex items-center gap-2 text-xs">
            <TimelineDot className={sev.accent} />
            <span className="text-muted-foreground">
              First seen{" "}
              <span className="text-foreground/80" suppressHydrationWarning>
                {new Date(firstSeen).toLocaleDateString()}
              </span>
            </span>
            {finding.regressedAt ? (
              <>
                <span className="h-px w-6 bg-border" />
                <TimelineDot className="bg-warning" />
                <span className="text-muted-foreground">
                  Came back{" "}
                  <span className="text-foreground/80" suppressHydrationWarning>
                    {new Date(finding.regressedAt).toLocaleDateString()}
                  </span>
                </span>
              </>
            ) : null}
            <span className="h-px w-6 bg-border" />
            <TimelineDot className="bg-foreground/60" />
            <span className="font-medium text-foreground/80">Still open</span>
          </div>
        </div>
      ) : null}

      {/* ── Provenance — where/when Atlas observed this (trust is visible) ───────── */}
      <p className="border-t border-border pt-4 text-xs text-muted-foreground/70">
        Observed from your latest sync
        {lastSyncedAt ? ` · ${timeAgo(lastSyncedAt)}` : ""}
        {finding.guidance?.source ? ` · guidance: ${finding.guidance.source}` : ""}
      </p>
    </div>
  );
}

function TimelineDot({ className }: { className: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", className)} />;
}
