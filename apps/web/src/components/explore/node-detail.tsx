import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft, Zap } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import type { NodeDetail, EdgeDto } from "@/lib/graph-types";

/** Node detail (docs/09 §5.3): header + attributes + provenance disclosure + connections. */
export function NodeDetailView({ node, edges }: { node: NodeDetail; edges: EdgeDto[] }) {
  const outgoing = edges.filter((e) => e.from.id === node.id);
  const incoming = edges.filter((e) => e.to.id === node.id);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{node.name ?? "unnamed"}</h1>
          <ConfidenceBadge tier={node.confidence} />
          <FreshnessTag status={node.status} />
          <Link
            href={`/explore/${node.id}/impact`}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-fg"
          >
            <Zap size={13} /> Impact analysis
          </Link>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-muted">{node.urn}</p>
        <p className="mt-1 text-sm text-muted">
          {node.kind} · {node.provider}
          {node.region ? ` · ${node.region}` : ""} · seen {new Date(node.lastSeen).toLocaleString()}
        </p>
      </div>

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
                <Row label="Source" value={node.provenance.source ?? "—"} />
                <Row
                  label="Observed"
                  value={
                    node.provenance.observedAt
                      ? new Date(node.provenance.observedAt).toLocaleString()
                      : "—"
                  }
                />
                <Row label="Confidence" value={node.provenance.confidence ?? node.confidence} />
                <Row label="Sync run" value={node.provenance.syncRunId ?? "—"} mono />
                {node.provenance.rawSnapshotRef && (
                  <Row label="Raw snapshot" value={node.provenance.rawSnapshotRef} mono />
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">
                No provenance recorded — this node was derived, not directly observed.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Connections</CardTitle>
          <span className="text-xs text-muted">
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
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {icon} {title}
      </p>
      {edges.length === 0 ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {edges.map((e) => {
            const other = endpoint(e);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted">
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
  if (entries.length === 0) return <p className="text-sm text-muted">{empty}</p>;
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
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
