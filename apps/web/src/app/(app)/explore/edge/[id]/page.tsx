import Link from "next/link";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/certainty";
import type { EdgeDetail } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

/**
 * Edge provenance — the "why?" behind a connection (docs/09 §5.3, P4). Shows the origin
 * (observed vs inferred), the rule that derived it, the evidence, and the raw source.
 */
export default async function EdgePage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requireShell();
  const { id } = await params;

  const res = await apiGet<ApiOk<EdgeDetail>>(`/edges/${id}`, {
    token: shell.token,
    orgId: shell.orgId,
  });
  const edge = res.body?.data ?? null;

  return (
    <>
      {edge ? (
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{edge.type}</h1>
              <ConfidenceBadge tier={edge.confidence} evidence={`origin: ${edge.origin}`} />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/explore/${edge.from.id}`} className="hover:text-primary">
                {edge.from.name ?? edge.from.urn}
              </Link>
              <span className="text-muted-foreground">→</span>
              <Link href={`/explore/${edge.to.id}`} className="hover:text-primary">
                {edge.to.name ?? edge.to.urn}
              </Link>
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Why this edge exists</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="space-y-1.5 text-sm">
                  <Row label="Origin" value={edge.origin} />
                  <Row label="Derived by rule" value={edge.rule ?? "— (directly observed)"} mono />
                  <Row label="Source" value={edge.provenance.source ?? "—"} />
                  <Row
                    label="Observed"
                    value={
                      edge.provenance.observedAt
                        ? new Date(edge.provenance.observedAt).toLocaleString()
                        : "—"
                    }
                  />
                  {edge.provenance.rawSnapshotRef && (
                    <Row label="Raw snapshot" value={edge.provenance.rawSnapshotRef} mono />
                  )}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
              </CardHeader>
              <CardBody>
                {Object.keys(edge.evidence ?? {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No structured evidence recorded.</p>
                ) : (
                  <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs text-foreground">
                    {JSON.stringify(edge.evidence, null, 2)}
                  </pre>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border py-12 text-center">
          <p className="text-sm text-foreground">Edge not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It may have been retired, or it belongs to another organization.
          </p>
        </div>
      )}
    </>
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
