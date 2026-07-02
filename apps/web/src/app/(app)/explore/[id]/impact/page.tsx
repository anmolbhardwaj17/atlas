import Link from "next/link";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { ImpactPanel } from "@/components/explore/impact-panel";
import type { NodeDetail, TraversalResult } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

/**
 * Impact analysis (docs/09 §5.4, US-4): blast-radius (what breaks if this changes) and
 * dependencies (what this needs to work), both with why-chains + path confidence.
 */
export default async function ImpactPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requireShell();
  const { id } = await params;
  const scope = { token: shell.token, orgId: shell.orgId };

  const [nodeRes, blastRes, depsRes] = await Promise.all([
    apiGet<ApiOk<NodeDetail>>(`/nodes/${id}`, scope),
    apiGet<ApiOk<TraversalResult>>(`/nodes/${id}/blast-radius`, scope),
    apiGet<ApiOk<TraversalResult>>(`/nodes/${id}/dependencies`, scope),
  ]);
  const node = nodeRes.body?.data ?? null;

  return (
    <>
      <div className="mb-5">
        <Link
          href={`/explore/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to node
        </Link>
      </div>

      {node ? (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold">Impact · {node.name ?? node.urn}</h1>
            <p className="text-sm text-muted-foreground">
              What changes if this resource does - and what it depends on. Every path shows its
              weakest-link confidence and the evidence behind each hop.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ImpactPanel
              title="Blast radius"
              subtitle="Resources impacted if this one changes or fails (downstream)."
              result={blastRes.body?.data ?? null}
            />
            <ImpactPanel
              title="Dependencies"
              subtitle="Resources this one relies on to function (upstream)."
              result={depsRes.body?.data ?? null}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border py-12 text-center">
          <p className="text-sm text-foreground">Resource not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It may have been removed, or it belongs to another organization.
          </p>
        </div>
      )}
    </>
  );
}
