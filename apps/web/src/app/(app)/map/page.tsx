import { Waypoints } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { InfraMap } from "@/components/map/infra-map";
import { EmptyState } from "@/components/patterns/empty-state";
import type { MapData } from "@/lib/map-types";

export const dynamic = "force-dynamic";

/**
 * Infrastructure map (docs/09 §5.4). Server-fetches the bounded graph (secrets stay
 * server-side) and hands it to the client canvas. Empty graph → the onboarding CTA.
 */
export default async function MapPage() {
  const shell = await requireShell();
  const data =
    (await apiGet<ApiOk<MapData>>("/graph?limit=400", { token: shell.token, orgId: shell.orgId }))
      .body?.data ?? null;

  if (!data || data.nodes.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Infrastructure map</h1>
          <p className="text-sm text-muted-foreground">
            Your infrastructure and code, wired together, from entry points through compute into
            your data stores.
          </p>
        </div>
        <EmptyState
          icon={Waypoints}
          title="Nothing to map yet"
          description="Connect a source or load sample data from the dashboard, and your infrastructure will appear here as a live map."
        />
      </div>
    );
  }

  return <InfraMap data={data} orgId={shell.orgId} />;
}
