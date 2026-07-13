import { Suspense } from "react";
import { Waypoints } from "lucide-react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { InfraMapLazy } from "@/components/map/infra-map-lazy";
import { EmptyState } from "@/components/patterns/empty-state";
import type { MapData } from "@/lib/map-types";
import MapLoading from "./loading";

export const dynamic = "force-dynamic";

/** The data-bound part: the bounded `/graph` fetch + the empty-state/canvas branch. Split out so the
 *  heaviest fetch in the app streams behind <Suspense> instead of blocking the RSC flush (perf P3). */
async function MapContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, orgId } = await getPageAuth();
  const params = await searchParams;
  const focusRaw = params.node;
  const focusId = (Array.isArray(focusRaw) ? focusRaw[0] : focusRaw) || undefined;
  const lensRaw = params.lens;
  const lens = (Array.isArray(lensRaw) ? lensRaw[0] : lensRaw) || undefined;
  // "Load full map" (?full=1) raises the node budget to the server max; the default keeps the
  // canvas fast on the most-recent slice. React Flow can't usefully render tens of thousands of
  // nodes, so "full" is the 1000-node cap, which covers the whole estate for typical orgs.
  const full = (Array.isArray(params.full) ? params.full[0] : params.full) === "1";
  const limit = full ? 1000 : 400;

  const data =
    (await apiGet<ApiOk<MapData>>(`/graph?limit=${limit}`, { token, orgId })).body?.data ?? null;

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

  return (
    <InfraMapLazy
      data={data}
      orgId={orgId}
      full={full}
      {...(focusId ? { focusId } : {})}
      {...(lens ? { lens } : {})}
    />
  );
}

/**
 * Infrastructure map (docs/09 §5.4). Server-fetches the bounded graph (secrets stay
 * server-side) and hands it to the client canvas. Empty graph → the onboarding CTA.
 */
export default function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<MapLoading />}>
      <MapContent searchParams={searchParams} />
    </Suspense>
  );
}
