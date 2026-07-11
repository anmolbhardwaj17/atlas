import Link from "next/link";
import { ChevronDown, Clock, Map as MapIcon, ExternalLink } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { AtlasAiMark } from "@/components/brand";
import { NodeConnections } from "@/components/explore/node-connections";
import { NodeRisks } from "@/components/explore/node-risks";
import { IntentCoverage } from "@/components/explore/intent-coverage";
import { CopyButton } from "@/components/explore/copy-button";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { PROVIDER_META } from "@/lib/taxonomy";
import { keyFacts, cloudwatchLink } from "@/lib/node-facts";
import { cn } from "@/lib/cn";
import type { NodeDetail, EdgeDto, NodeEvent, TraversalResult } from "@/lib/graph-types";

/** Pull-request node kinds — the ones that carry an intent-coverage review (IV-3). */
const PR_KINDS = new Set(["bitbucket.pullrequest", "github.pull_request"]);

/** The real logo for a node: its specific service logo (aws-ec2…) if we have one, else the
 *  provider's brand mark (aws / github / gcp…). Mirrors the Explore list. */
function nodeLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/** A pre-filled Ask Atlas question about this resource (grounded, cited answer). */
function askHref(node: NodeDetail, unhealthy: boolean): string {
  const label = node.name ?? node.kind;
  const q = unhealthy
    ? `Why is ${label} unhealthy right now? Diagnose the likely cause, what changed recently, and what depends on it.`
    : `Tell me about ${label} — what it is, what it connects to, what depends on it, and anything I should know.`;
  return `/ask?q=${encodeURIComponent(q)}`;
}

/**
 * Node detail (docs/09 §5.3) — answer-first: lead with what this IS and whether it's OK (health
 * hero + curated key facts + actions), then what changed (timeline) and what it touches
 * (connections). Raw attributes + provenance are demoted behind disclosure — trust plumbing on
 * demand, not the headline (P4 is still one click away).
 */
export function NodeDetailView({
  orgId,
  node,
  edges,
  events = [],
  blast = null,
  deps = null,
}: {
  orgId: string;
  node: NodeDetail;
  edges: EdgeDto[];
  events?: NodeEvent[];
  blast?: TraversalResult | null;
  deps?: TraversalResult | null;
}) {
  const logo = nodeLogo(node.kind);
  const KindIcon = kindIcon(node.kind);
  const health = (node.attributes?.health ?? null) as {
    state?: string;
    reason?: string;
  } | null;
  const unhealthy = !!health?.state && health.state !== "healthy";
  const facts = keyFacts(node.kind, node.attributes);
  const metricsUrl = cloudwatchLink(node.kind, node.region, node.attributes);
  // "Since" for the health banner: the newest health transition we recorded.
  const healthSince = events.find((e) => e.kind === "health_transition")?.occurredAt ?? null;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-md",
                  logo ? "bg-muted/60" : kindStyle(node.kind),
                )}
              >
                {logo ? (
                  <CloudIcon name={logo} className="size-5" />
                ) : (
                  <KindIcon className="size-[18px]" />
                )}
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">{node.name ?? "unnamed"}</h1>
              <ConfidenceBadge tier={node.confidence} />
              <FreshnessTag status={node.status} />
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>
                {node.kind} · {node.provider}
                {node.region ? ` · ${node.region}` : ""}
              </span>
              <span className="inline-flex items-center gap-1" title="Last seen">
                <Clock className="size-3.5" />
                {new Date(node.lastSeen).toLocaleString()}
              </span>
            </p>
          </div>
          {/* Primary CTA: a general "ask about this resource". Urgent diagnosis lives in the health
              hero (below), so we don't duplicate a Diagnose button up here. */}
          <Link
            href={askHref(node, false)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <AtlasAiMark size={14} className="size-3.5" />
            Ask about this
          </Link>
        </div>

        {/* Action row + the URN as a quiet, copyable identifier (demoted from the headline). */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={`/map?node=${node.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <MapIcon className="size-3.5" />
            View on map
          </Link>
          {metricsUrl ? (
            <a
              href={metricsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              View metrics
            </a>
          ) : null}
          <CopyButton value={node.urn} label="Copy URN" />
          <code
            className="max-w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
            title={node.urn}
          >
            {node.urn}
          </code>
        </div>
      </div>

      {/* ── Health hero (only when not healthy) ────────────────── */}
      {unhealthy ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-4",
            health?.state === "degraded"
              ? "border-warning/30 bg-warning/10"
              : "border-danger/30 bg-danger/10",
          )}
        >
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              health?.state === "degraded" ? "bg-warning" : "bg-danger",
            )}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-semibold capitalize",
                health?.state === "degraded" ? "text-warning" : "text-danger",
              )}
            >
              {health?.state}
              {health?.reason ? (
                <span className="font-normal text-foreground"> — {health.reason}</span>
              ) : null}
            </p>
            {healthSince ? (
              <p className="text-xs text-muted-foreground">
                Since {new Date(healthSince).toLocaleString()}
              </p>
            ) : null}
          </div>
          <Link
            href={askHref(node, true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <AtlasAiMark size={14} className="size-3.5" /> Diagnose with AI
          </Link>
        </div>
      ) : null}

      {/* ── Risks (findings that name this node) ────────────────── */}
      <NodeRisks orgId={orgId} nodeId={node.id} />

      {/* ── Intent coverage (PRs only): did this PR build its linked ticket? (IV-3) ── */}
      {PR_KINDS.has(node.kind) ? <IntentCoverage orgId={orgId} prId={node.id} /> : null}

      {/* ── Key facts + Timeline — side by side, equal height ──── */}
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        {facts.length > 0 ? (
          <Card className={cn("h-full", events.length === 0 && "lg:col-span-2")}>
            <CardHeader>
              <CardTitle>Key facts</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-y divide-border text-sm">
                {facts.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(0,140px)_1fr] items-baseline gap-x-4 py-2 first:pt-0 last:pb-0"
                  >
                    <dt className="truncate text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        ) : null}

        {/* Timeline (what changed) */}
        {events.length > 0 ? (
          <Card className={cn("h-full", facts.length === 0 && "lg:col-span-2")}>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardBody>
              {/* What changed, when, by whom (Phase C): CloudTrail config changes, health
                transitions, deploys, merged PRs - newest first, the incident-story view. Rendered
                as a vertical timeline — dots threaded on a rail — so the sequence reads at a glance. */}
              <ol className="relative">
                {events.slice(0, 12).map((e, i, arr) => {
                  const dot =
                    e.kind === "health_transition"
                      ? "bg-danger"
                      : e.kind === "config_change"
                        ? "bg-warning"
                        : "bg-muted-foreground";
                  const last = i === arr.length - 1;
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {/* the rail connecting this dot to the next (ring-card on dots masks overlap) */}
                      {!last ? (
                        <span
                          aria-hidden
                          className="absolute left-[5px] top-4 h-full w-px bg-border"
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative z-10 mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-card",
                          dot,
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={e.title}>
                          {e.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(e.occurredAt).toLocaleString()} · {e.source}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>
        ) : null}
      </div>

      {/* ── Details on demand: all attributes + evidence/provenance ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Disclosure title="All attributes">
          <KeyValues data={node.attributes} empty="No attributes." />
        </Disclosure>
        <Disclosure title="Evidence & provenance">
          {node.provenance ? (
            <dl className="divide-y divide-border text-sm">
              <Row label="Source" value={node.provenance.source ?? "-"} />
              <Row
                label="Observed"
                value={
                  node.provenance.observedAt
                    ? new Date(node.provenance.observedAt).toLocaleString()
                    : "-"
                }
              />
              <Row label="Confidence" value={node.provenance.confidence ?? node.confidence} />
              <Row label="Sync run" value={node.provenance.syncRunId ?? "-"} mono />
              {node.provenance.rawSnapshotRef ? (
                <Row label="Raw snapshot" value={node.provenance.rawSnapshotRef} mono subtle />
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No provenance recorded - this node was derived, not directly observed.
            </p>
          )}
        </Disclosure>
      </div>

      <NodeConnections orgId={orgId} node={node} edges={edges} blast={blast} deps={deps} />
    </div>
  );
}

/** A collapsible section (native <details>) for secondary content that shouldn't compete with the
 *  primary read but must stay one click away. */
function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
        {title}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

function KeyValues({ data, empty }: { data: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <dl className="divide-y divide-border text-sm">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-[minmax(0,130px)_1fr] items-baseline gap-x-4 py-2 first:pt-0 last:pb-0"
        >
          <dt className="truncate text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-all">
            <AttrValue k={k} v={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Render one attribute value readably: health as a status, shallow objects as "k: v" pairs,
 *  everything else mono. Beats dumping raw JSON into the cell. */
function AttrValue({ k, v }: { k: string; v: unknown }) {
  if (k === "health" && v && typeof v === "object") {
    const h = v as { state?: string; reason?: string };
    if (h.state) {
      const tone =
        h.state === "healthy" ? "bg-success" : h.state === "degraded" ? "bg-warning" : "bg-danger";
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", tone)} />
          <span className="capitalize">{h.state}</span>
          {h.reason ? <span className="text-muted-foreground">· {h.reason}</span> : null}
        </span>
      );
    }
  }
  if (v !== null && typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>)
      .map(([kk, vv]) => `${kk}: ${typeof vv === "object" ? JSON.stringify(vv) : String(vv)}`)
      .join(", ");
    return <span className="font-mono text-xs">{pairs}</span>;
  }
  return <span className="font-mono text-xs">{String(v)}</span>;
}

function Row({
  label,
  value,
  mono,
  subtle,
}: {
  label: string;
  value: string;
  mono?: boolean;
  subtle?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,130px)_1fr] items-baseline gap-x-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-all",
          mono && "font-mono text-xs",
          subtle && "text-[11px] text-muted-foreground/70",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
