import { notFound } from "next/navigation";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { WarRoomView } from "@/components/war-room/war-room-view";
import type { Incident } from "@/lib/browser-api";
import type { MapData } from "@/lib/map-types";

export const dynamic = "force-dynamic";

/**
 * Incident War Room (docs/plans/war-room.md). Loads the persisted incident + the bounded graph, then
 * hands them to the client view which lights the broken node + its blast radius on the map and streams
 * the (real, cited) diagnosis beside it. Secrets stay server-side; a foreign/missing id → 404.
 */
export default async function WarRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { token, orgId } = await requireShell();

  const [incidentRes, mapRes] = await Promise.all([
    apiGet<ApiOk<Incident>>(`/incidents/${id}`, { token, orgId }),
    apiGet<ApiOk<MapData>>("/graph?limit=400", { token, orgId }),
  ]);

  const incident = incidentRes.body?.data ?? null;
  if (!incident) notFound();
  const map = mapRes.body?.data ?? { nodes: [], edges: [], truncated: false };

  return <WarRoomView incident={incident} map={map} orgId={orgId} />;
}
