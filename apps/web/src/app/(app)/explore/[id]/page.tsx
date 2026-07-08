import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { NodeDetailView } from "@/components/explore/node-detail";
import type { NodeDetail, EdgeDto, NodeEvent } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

export default async function NodePage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requireShell();
  const { id } = await params;

  const [nodeRes, edgesRes, eventsRes] = await Promise.all([
    apiGet<ApiOk<NodeDetail>>(`/nodes/${id}`, { token: shell.token, orgId: shell.orgId }),
    apiGet<ApiOk<EdgeDto[]>>(`/nodes/${id}/edges`, { token: shell.token, orgId: shell.orgId }),
    apiGet<ApiOk<NodeEvent[]>>(`/nodes/${id}/events`, { token: shell.token, orgId: shell.orgId }),
  ]);
  const node = nodeRes.body?.data ?? null;
  const edges = edgesRes.body?.data ?? [];
  const events = eventsRes.body?.data ?? [];

  return (
    <>
      <SetBreadcrumbs
        items={[{ label: "Explore", href: "/explore" }, { label: node?.name ?? "Resource" }]}
      />
      {node ? (
        <NodeDetailView node={node} edges={edges} events={events} />
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
