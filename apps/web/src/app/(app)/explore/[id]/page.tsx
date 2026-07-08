import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { NodeDetailView } from "@/components/explore/node-detail";
import type { NodeDetail, EdgeDto, NodeEvent, TraversalResult } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

export default async function NodePage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requireShell();
  const { id } = await params;
  const auth = { token: shell.token, orgId: shell.orgId };
  const trav = "?depth=3&nodeBudget=40";

  const [nodeRes, edgesRes, eventsRes, blastRes, depsRes] = await Promise.all([
    apiGet<ApiOk<NodeDetail>>(`/nodes/${id}`, auth),
    apiGet<ApiOk<EdgeDto[]>>(`/nodes/${id}/edges`, auth),
    apiGet<ApiOk<NodeEvent[]>>(`/nodes/${id}/events`, auth),
    apiGet<ApiOk<TraversalResult>>(`/nodes/${id}/blast-radius${trav}`, auth),
    apiGet<ApiOk<TraversalResult>>(`/nodes/${id}/dependencies${trav}`, auth),
  ]);
  const node = nodeRes.body?.data ?? null;
  const edges = edgesRes.body?.data ?? [];
  const events = eventsRes.body?.data ?? [];
  const blast = blastRes.body?.data ?? null;
  const deps = depsRes.body?.data ?? null;

  return (
    <>
      <SetBreadcrumbs
        items={[{ label: "Explore", href: "/explore" }, { label: node?.name ?? "Resource" }]}
      />
      {node ? (
        <NodeDetailView
          orgId={shell.orgId}
          node={node}
          edges={edges}
          events={events}
          blast={blast}
          deps={deps}
        />
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
