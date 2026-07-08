import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { AtlasAiMark } from "@/components/brand";
import { NodeConnections } from "@/components/explore/node-connections";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { PROVIDER_META } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";
import type { NodeDetail, EdgeDto, NodeEvent, TraversalResult } from "@/lib/graph-types";

/** The real logo for a node: its specific service logo (aws-ec2…) if we have one, else the
 *  provider's brand mark (aws / github / gcp…). Mirrors the Explore list. */
function nodeLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/** Node detail (docs/09 §5.3): header + attributes + provenance + the unified connections/impact
 *  graph (neighborhood map + blast-radius/dependencies tabs). */
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

  return (
    <div className="space-y-6">
      <div>
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
          <h1 className="text-xl font-semibold">{node.name ?? "unnamed"}</h1>
          <ConfidenceBadge tier={node.confidence} />
          <FreshnessTag status={node.status} />
          {(() => {
            const h = node.attributes?.health as { state?: string } | undefined;
            if (!h || h.state === "healthy" || !h.state) return null;
            const q = `Why is ${node.name ?? node.kind} unhealthy right now? Diagnose the likely cause, what changed recently, and what depends on it.`;
            return (
              <Link
                href={`/ask?q=${encodeURIComponent(q)}`}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                <AtlasAiMark size={14} className="size-3.5" /> Diagnose with AI
              </Link>
            );
          })()}
        </div>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{node.urn}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {node.kind} · {node.provider}
          {node.region ? ` · ${node.region}` : ""} · seen {new Date(node.lastSeen).toLocaleString()}
        </p>
      </div>

      {events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardBody>
            {/* What changed, when, by whom (Phase C): CloudTrail config changes, health
                transitions, deploys, merged PRs - newest first, the incident-story view. */}
            <ol className="space-y-2 text-sm">
              {events.slice(0, 12).map((e) => (
                <li key={e.id} className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                      e.kind === "health_transition"
                        ? "bg-danger"
                        : e.kind === "config_change"
                          ? "bg-warning"
                          : "bg-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate" title={e.title}>
                      {e.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleString()} · {e.source}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Attributes</CardTitle>
          </CardHeader>
          <CardBody>
            <KeyValues data={node.attributes} empty="No attributes." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provenance</CardTitle>
          </CardHeader>
          <CardBody>
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
                {node.provenance.rawSnapshotRef && (
                  <Row label="Raw snapshot" value={node.provenance.rawSnapshotRef} mono subtle />
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No provenance recorded - this node was derived, not directly observed.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <NodeConnections orgId={orgId} node={node} edges={edges} blast={blast} deps={deps} />
    </div>
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
    <div className="grid grid-cols-[minmax(0,130px)_1fr] items-baseline gap-x-4">
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
