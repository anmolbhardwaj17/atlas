import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft, Zap, Stethoscope } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { PROVIDER_META } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";
import type { NodeDetail, EdgeDto, NodeEvent } from "@/lib/graph-types";

/** The real logo for a node: its specific service logo (aws-ec2…) if we have one, else the
 *  provider's brand mark (aws / github / gcp…). Mirrors the Explore list. */
function nodeLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

/** Node detail (docs/09 §5.3): header + attributes + provenance disclosure + connections. */
export function NodeDetailView({
  node,
  edges,
  events = [],
}: {
  node: NodeDetail;
  edges: EdgeDto[];
  events?: NodeEvent[];
}) {
  const outgoing = edges.filter((e) => e.from.id === node.id);
  const incoming = edges.filter((e) => e.to.id === node.id);
  const logo = nodeLogo(node.kind);
  const KindIcon = kindIcon(node.kind);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg",
              logo ? "bg-muted/60" : kindStyle(node.kind),
            )}
          >
            {logo ? <CloudIcon name={logo} className="size-5" /> : <KindIcon className="size-5" />}
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
                className="ml-auto flex items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white hover:bg-danger/90"
              >
                <Stethoscope size={13} /> Diagnose with AI
              </Link>
            );
          })()}
          <Link
            href={`/explore/${node.id}/impact`}
            className={`${node.attributes?.health && (node.attributes.health as { state?: string }).state !== "healthy" ? "" : "ml-auto"} flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground`}
          >
            <Zap size={13} /> Impact analysis
          </Link>
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
              <dl className="space-y-1.5 text-sm">
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
                  <Row label="Raw snapshot" value={node.provenance.rawSnapshotRef} mono />
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

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Connections</CardTitle>
          <span className="text-xs text-muted-foreground">
            {edges.length} edge{edges.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardBody className="space-y-4">
          <EdgeGroup
            title="Depends on / points to"
            icon={<ArrowUpRight size={14} />}
            edges={outgoing}
            endpoint={(e) => e.to}
            emptyText="No outgoing edges."
          />
          <EdgeGroup
            title="Depended on by / pointed to from"
            icon={<ArrowDownLeft size={14} />}
            edges={incoming}
            endpoint={(e) => e.from}
            emptyText="No incoming edges."
          />
        </CardBody>
      </Card>
    </div>
  );
}

function EdgeGroup({
  title,
  icon,
  edges,
  endpoint,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  edges: EdgeDto[];
  endpoint: (e: EdgeDto) => EdgeDto["from"];
  emptyText: string;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </p>
      {edges.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {edges.map((e) => {
            const other = endpoint(e);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {e.type}
                  </span>
                  <Link href={`/explore/${other.id}`} className="truncate hover:text-primary">
                    {other.name ?? other.urn}
                  </Link>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <ConfidenceBadge tier={e.confidence} evidence={`origin: ${e.origin}`} />
                  <Link
                    href={`/explore/edge/${e.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    why?
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function KeyValues({ data, empty }: { data: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <dl className="space-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <Row key={k} label={k} value={typeof v === "string" ? v : JSON.stringify(v)} mono />
      ))}
    </dl>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
